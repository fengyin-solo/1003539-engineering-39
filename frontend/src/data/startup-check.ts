import { MODULES, MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import {
  allRows,
  hasModuleData,
  invalidateCache,
  rawStoredRows,
  readDataVersion,
  saveRows,
  seedMissingModule,
  seedSnapshot,
  writeDataVersion,
} from './local-store'
import type {
  EntryRow,
  ModuleBaseline,
  ModuleCheckResult,
  StartupCheckResult,
} from './types'

/**
 * 示例数据版本。调整 seed.ts 后要顺手抬一位：
 * 本机版本落后时只补缺失模块，已有业务数据和旧快照一律保留。
 */
export const DATA_VERSION = '2026-10-03.1'

// 启动检查写进业务台账的标记字段：靠它做幂等，连跑两次不会重复造事项。
const INSP_MARKER = '启动校验事项'
const SH_MARKER = '启动校验批次'
const SH_RESULT = '启动校验结果'

const SYSTEM_OPERATOR = '运营概览启动检查'
const SYSTEM_STATION = 'SYSTEM'

export function expectedEntryPaths(): string[] {
  return ['/', ...MODULES.map((item) => `/${item.key}`)]
}

function tally(rows: EntryRow[]): Pick<ModuleBaseline, 'created' | 'pending' | 'abnormal'> {
  return {
    created: rows.length,
    pending: rows.filter((row) => row.pending).length,
    abnormal: rows.filter((row) => row.abnormal).length,
  }
}

/** 示例数据基线：初始化后每个模块的台账量、待处理量、异常量必须稳定复现成这份数字。 */
export function seedBaseline(): ModuleBaseline[] {
  return MODULES.map((meta) => {
    const rows = SEED_ROWS[meta.key] ?? []
    return { key: meta.key, name: meta.name, ...tally(rows) }
  })
}

function sameTally(
  actual: ModuleCheckResult['actual'],
  expected: ModuleBaseline,
): boolean {
  return (
    actual.created === expected.created &&
    actual.pending === expected.pending &&
    actual.abnormal === expected.abnormal
  )
}

/** 给系统事项取跨运行稳定的负号编号：同批次重跑只做 upsert，不会新插一行。 */
function stableId(ref: string): number {
  let hash = 0
  for (let i = 0; i < ref.length; i += 1) {
    hash = (hash * 31 + ref.charCodeAt(i)) | 0
  }
  return -100000 - (Math.abs(hash) % 800000)
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function versionSlug(version: string): string {
  return version.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase()
}

function upsertRow(key: string, markerField: string, markerValue: string, row: EntryRow): boolean {
  const rows = [...allRows()[key]]
  const index = rows.findIndex((item) => String(item[markerField] ?? '') === markerValue)
  if (index >= 0) {
    // 已存在同批次记录：只更新内容与结论，保留编号，不新增事项。
    rows[index] = { ...rows[index], ...row, id: rows[index].id }
    saveRows(key, rows)
    return false
  }
  rows.push(row)
  saveRows(key, rows)
  return true
}

/** 缺失模块对应的巡检待办；同一模块多次检查只生成一条，可在巡检页正常流转。 */
function upsertInspectionTodo(
  metaKey: string,
  repaired: boolean,
): { created: boolean; code: string } {
  const meta = MODULE_BY_KEY.get(metaKey)
  if (!meta) {
    return { created: false, code: '' }
  }
  const ref = `missing-module:${metaKey}`
  const code = `INSP-CHECK-${metaKey.toUpperCase()}`
  const row: EntryRow = {
    id: stableId(`inspection:${ref}`),
    status: '待巡检',
    pending: true,
    abnormal: false,
    记录编号: code,
    站点编号: SYSTEM_STATION,
    巡检日期: today(),
    巡检人员: SYSTEM_OPERATOR,
    检查项目: '运营概览启动校验',
    发现问题: `模块「${meta.name}」台账缺失，未在本机初始化`,
    处理措施: repaired
      ? '重试已补齐示例台账，请人工巡检确认后流转'
      : '在运营概览点击「重试」补齐该模块示例台账',
    巡检状态: repaired ? '已补齐待复核' : '待补齐',
    [INSP_MARKER]: ref,
  }
  const created = upsertRow('inspection', INSP_MARKER, ref, row)
  return { created, code }
}

/** 站房维护台账里的启动校验结果记录：任何入口跑检查都会落到这里。 */
function upsertStationhouseRecord(passed: boolean, detail: string): { created: boolean; code: string } {
  const slug = versionSlug(DATA_VERSION)
  const ref = DATA_VERSION
  const code = `SH-CHECK-${slug}`
  const row: EntryRow = {
    id: stableId(`stationhouse:${ref}`),
    status: passed ? '已验收' : '待安排',
    pending: !passed,
    abnormal: !passed,
    记录编号: code,
    站点编号: SYSTEM_STATION,
    维护类型: '启动校验',
    维护内容: detail,
    维护单位: SYSTEM_OPERATOR,
    维护日期: today(),
    费用支出: 0,
    维护状态: passed ? '通过' : '未通过',
    [SH_MARKER]: ref,
    [SH_RESULT]: passed ? '通过' : '未通过',
  }
  const created = upsertRow('stationhouse', SH_MARKER, ref, row)
  return { created, code }
}

export type StartupCheckOptions = {
  /** 已注册的页面入口（路由 path 列表），与全部模块入口逐个核对。 */
  entryPaths: string[]
  /** 重试模式：遇到缺失模块直接补示例台账后续检，已有业务数据不动。 */
  repair?: boolean
}

/**
 * 运营概览的可重复本地运行检查：
 * 1) 首次无数据时初始化示例数据，并逐模块复现台账/待处理/异常量基线；
 * 2) 已有业务数据一律保留，版本落后只补缺失模块，旧快照不被新示例覆盖；
 * 3) 核对数据版本与页面入口；模块台账缺失时停在该模块，repair 重试补齐；
 * 4) 结果幂等写入巡检待办与站房维护台账，连跑两次不产生重复事项。
 */
export function runStartupCheck(options: StartupCheckOptions): StartupCheckResult {
  const repair = options.repair ?? false
  const messages: string[] = []
  const moduleResults: ModuleCheckResult[] = []
  const inspectionTodoCodes: string[] = []
  let generatedItems = 0
  let repaired = false

  invalidateCache()
  const storedBefore = rawStoredRows()
  const freshInit = Object.keys(storedBefore).length === 0

  if (freshInit) {
    // 首次运行：初始化完整示例数据。这不是覆盖——本机此前没有任何业务台账。
    const snapshot = seedSnapshot()
    for (const key of Object.keys(snapshot)) {
      saveRows(key, snapshot[key] as EntryRow[])
    }
    messages.push('本机无业务数据，已按示例数据初始化全部模块台账')
  }

  // —— 1. 数据版本核对 ——
  const actualVersion = readDataVersion()
  let versionState: StartupCheckResult['dataVersion']['state']
  let versionDetail: string
  if (actualVersion === DATA_VERSION) {
    versionState = 'current'
    versionDetail = `数据版本 ${DATA_VERSION}，与当前示例一致`
  } else if (actualVersion === null) {
    versionState = freshInit ? 'current' : 'missing'
    versionDetail = freshInit
      ? `首次初始化，写入数据版本 ${DATA_VERSION}`
      : '已有业务数据（无版本戳），保留不动，仅按当前版本补齐缺失模块'
  } else {
    versionState = 'stale'
    versionDetail = `数据版本 ${actualVersion} 落后于 ${DATA_VERSION}：已有业务数据保留，仅补齐缺失模块`
  }
  messages.push(versionDetail)

  // —— 2. 页面入口核对 ——
  const registered = new Set(options.entryPaths)
  const missingEntries = expectedEntryPaths().filter((path) => !registered.has(path))
  const entryState = missingEntries.length === 0 ? 'matched' : 'missing'
  const entryDetail =
    missingEntries.length === 0
      ? `运营概览与 ${MODULES.length} 个模块页面入口全部已注册`
      : `页面入口缺失：${missingEntries.join('、')}`
  messages.push(entryDetail)

  const baseline = seedBaseline()
  let stoppedAt: string | null = null
  const repairedKeys: string[] = []

  // —— 3. 逐模块台账核对：缺失即停（重试时补齐），量值不符按场景判定 ——
  if (entryState === 'matched') {
    for (const expected of baseline) {
      if (!hasModuleData(expected.key)) {
        if (repair) {
          seedMissingModule(expected.key)
          repaired = true
          repairedKeys.push(expected.key)
          messages.push(`重试补齐模块「${expected.name}」的示例台账（已有业务数据未改动）`)
        } else {
          stoppedAt = expected.key
          moduleResults.push({
            key: expected.key,
            name: expected.name,
            expected,
            actual: { created: 0, pending: 0, abnormal: 0 },
            state: 'missing',
            detail: '模块台账缺失，检查在此中断；点击「重试」补齐示例台账',
          })
          break
        }
      }
      invalidateCache()
      const actualRows = allRows()[expected.key] ?? []
      const actual = tally(actualRows)
      // 基线只约束示例业务台账；本检查写入的系统事项按标记剔除后再比，
      // 这样校验记录落进站房台账不会把基线"顶歪"，重复运行始终显示一致。
      const businessRows = actualRows.filter(
        (row) =>
          String(row[SH_MARKER] ?? '') === '' && String(row[INSP_MARKER] ?? '') === '',
      )
      const matched = sameTally(tally(businessRows), expected)
      moduleResults.push({
        key: expected.key,
        name: expected.name,
        expected,
        actual,
        state: matched ? 'matched' : 'mismatch',
        detail: matched
          ? `业务台账 ${businessRows.length}、待处理 ${tally(businessRows).pending}、异常 ${tally(businessRows).abnormal}，与基线一致`
          : `台账 ${businessRows.length}（基线 ${expected.created}）、待处理 ${tally(businessRows).pending}（基线 ${expected.pending}）、异常 ${tally(businessRows).abnormal}（基线 ${expected.abnormal}）`,
      })
    }
  }

  const mismatchResults = moduleResults.filter((item) => item.state === 'mismatch')
  // 刚初始化完却复现不出基线 = 示例数据不稳定，按失败处理；老业务数据导致的出入只告警。
  const mismatchIsFailure = freshInit && mismatchResults.length > 0
  const passed = stoppedAt === null && entryState === 'matched' && !mismatchIsFailure

  // —— 4. 结果落台账：巡检待办 + 站房维护校验记录，全部按批次幂等 ——
  let stationhouseCode: string | null = null
  if (!passed) {
    if (stoppedAt) {
      const todo = upsertInspectionTodo(stoppedAt, false)
      inspectionTodoCodes.push(todo.code)
      generatedItems += todo.created ? 1 : 0
      const stoppedName = MODULE_BY_KEY.get(stoppedAt)?.name ?? stoppedAt
      const sh = upsertStationhouseRecord(
        false,
        `启动校验未通过：模块「${stoppedName}」台账缺失，检查中断待重试`,
      )
      stationhouseCode = sh.code
      generatedItems += sh.created ? 1 : 0
    }
  } else {
    if (repairedKeys.length > 0) {
      for (const key of repairedKeys) {
        const todo = upsertInspectionTodo(key, true)
        inspectionTodoCodes.push(todo.code)
        generatedItems += todo.created ? 1 : 0
      }
    }
    const sh = upsertStationhouseRecord(
      true,
      `启动校验通过：${MODULES.length} 个模块台账齐全，待处理量/异常量复现一致` +
        (repairedKeys.length > 0 ? `（重试补齐 ${repairedKeys.length} 个缺失模块）` : ''),
    )
    stationhouseCode = sh.code
    generatedItems += sh.created ? 1 : 0
    // 全绿后才盖版本戳；中断或量值复现失败时保持原状，下轮继续核对。
    writeDataVersion(DATA_VERSION)
  }

  invalidateCache()
  if (!passed && stoppedAt) {
    messages.push(`检查停在缺失模块「${MODULE_BY_KEY.get(stoppedAt)?.name ?? stoppedAt}」，可点击重试`)
  } else if (passed) {
    messages.push(
      generatedItems === 0
        ? '巡检待办与站房维护台账已存在本批次记录，未生成重复事项'
        : `本次新增 ${generatedItems} 条启动校验事项（巡检待办/站房维护台账）`,
    )
  }

  return {
    ok: passed,
    repaired,
    stoppedAt,
    dataVersion: {
      expected: DATA_VERSION,
      actual: actualVersion,
      state: versionState,
      detail: versionDetail,
    },
    pageEntries: {
      total: expectedEntryPaths().length,
      missing: missingEntries,
      state: entryState,
      detail: entryDetail,
    },
    modules: moduleResults,
    inspectionTodos: inspectionTodoCodes,
    stationhouseRecord: stationhouseCode,
    generatedItems,
    messages,
  }
}
