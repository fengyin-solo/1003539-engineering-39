import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import {
  SNAPSHOT_KEY,
  invalidateCache,
  listRows,
  readMeta,
  readPersistedEntries,
  saveRows,
  seedMissingEntries,
  seedVersion,
} from '@/data/local-store'
import { MODULE_NAV_ENTRIES } from '@/data/nav'
import { SEED_ROWS } from '@/data/seed'
import type { CheckSnapshot } from '@/data/meta-types'
import type { EntryRow, ModuleMeta } from '@/data/types'

// 运营概览的「本地运行检查」，按顺序跑三步：
// 1. 核对数据版本：首次运行播种示例数据；旧版本只做加法迁移，已有业务数据不覆盖；
// 2. 核对页面入口：每个业务模块的侧边栏入口和路由都必须登记；
// 3. 核对各模块台账：台账缺失/损坏就停在该模块等重试；示例初始化后与种子快照逐项
//    比对，保证台账量、待处理量、异常量稳定复现。
// 任何一步失败都停下来，用户点「重试」时先做该步的修复再从头重跑。

export type CheckStepState = 'pending' | 'running' | 'passed' | 'failed'

export type CheckStep = {
  key: 'version' | 'entries' | 'ledgers'
  title: string
  state: CheckStepState
  detail: string
}

export type ModuleCount = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

const STEP_ORDER: { key: CheckStep['key']; title: string }[] = [
  { key: 'version', title: '核对数据版本' },
  { key: 'entries', title: '核对页面入口' },
  { key: 'ledgers', title: '核对各模块台账' },
]

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(resolve, ms)
    } else {
      resolve()
    }
  })

export function createSteps(): CheckStep[] {
  return STEP_ORDER.map((item) => ({
    key: item.key,
    title: item.title,
    state: 'pending' as CheckStepState,
    detail: '',
  }))
}

// ---- 校验快照：只追加，不覆盖；旧快照永久保留，最新一份作为下次复现基准 ----

function readSnapshots(): CheckSnapshot[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(SNAPSHOT_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as CheckSnapshot[]) : []
  } catch {
    return []
  }
}

function latestSnapshot(): CheckSnapshot | null {
  const all = readSnapshots()
  return all.length > 0 ? all[all.length - 1] : null
}

// 结果指纹与最新快照一致就不再追加：连续执行两次不产生重复事项。
function appendSnapshotIfChanged(snapshot: CheckSnapshot): boolean {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false
  }
  const all = readSnapshots()
  const last = all.length > 0 ? all[all.length - 1] : null
  if (last && last.fingerprint === snapshot.fingerprint) {
    return false
  }
  all.push(snapshot)
  window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(all))
  return true
}

// ---- 统计 ----

export function countModule(meta: ModuleMeta, rows: EntryRow[]): ModuleCount {
  return {
    key: meta.key,
    name: meta.name,
    created: rows.length,
    pending: rows.filter((row) => row.pending).length,
    abnormal: rows.filter((row) => row.abnormal).length,
  }
}

// 示例数据初始化后的权威基准：直接由种子常量算出，台账/待处理/异常必须与它一致。
const SEED_MODULE_COUNTS: ModuleCount[] = MODULES.map((meta) =>
  countModule(meta, SEED_ROWS[meta.key] ?? []),
)

function fingerprintCounts(counts: ModuleCount[]): string {
  const body = counts
    .map((item) => `${item.key}:${item.created}/${item.pending}/${item.abnormal}`)
    .join('|')
  let hash = 0
  for (let i = 0; i < body.length; i += 1) {
    hash = (hash * 31 + body.charCodeAt(i)) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function sameCount(a: ModuleCount, b: ModuleCount): boolean {
  return a.created === b.created && a.pending === b.pending && a.abnormal === b.abnormal
}

function sumCounts(counts: ModuleCount[]) {
  return counts.reduce(
    (sum, item) => ({
      created: sum.created + item.created,
      pending: sum.pending + item.pending,
      abnormal: sum.abnormal + item.abnormal,
    }),
    { created: 0, pending: 0, abnormal: 0 },
  )
}

// ---- 第一步：数据版本 ----

function checkVersion(isRetry: boolean): { ok: boolean; detail: string } {
  const expected = seedVersion()
  const meta = readMeta()
  const persisted = readPersistedEntries()
  const hasBusinessData = persisted !== null
  const firstRun = meta === null && !hasBusinessData

  if (firstRun) {
    // 首次运行：初始化示例数据属于正常启动流程，直接播种并通过；不涉及任何旧数据。
    const merged = seedMissingEntries()
    return {
      ok: true,
      detail: `首次运行，已初始化示例数据（数据版本 ${expected}，${Object.keys(merged).length} 个模块）`,
    }
  }

  if (isRetry) {
    // 重试即修复：旧版本业务数据全部保留，只补齐缺失模块，再写入当前版本号；
    // 校验快照存在独立的键里，迁移过程不会触碰。
    const previous = meta?.version ?? '未知'
    const merged = seedMissingEntries()
    return {
      ok: true,
      detail: `已完成加法迁移：已有业务数据原样保留，仅补齐缺失模块（当前 ${Object.keys(merged).length} 个），数据版本 ${previous} → ${expected}，旧校验快照未覆盖`,
    }
  }

  if (!meta) {
    return {
      ok: false,
      detail: `检测到已有业务数据但未登记数据版本（页面期望 ${expected}）。点「重试」执行加法迁移：保留全部已有数据，仅补齐缺失模块`,
    }
  }
  if (meta.version !== expected) {
    return {
      ok: false,
      detail: `本地数据版本为 ${meta.version}，页面期望 ${expected}。点「重试」执行加法迁移：已有业务数据原样保留，仅补齐缺失模块，旧快照不覆盖`,
    }
  }
  return { ok: true, detail: `数据版本 ${expected}，与页面一致` }
}

// ---- 第二步：页面入口 ----

async function checkEntries(): Promise<{ ok: boolean; detail: string }> {
  // 动态取路由表，避免检查模块与路由初始化互相耦合。
  const routerModule = await import('@/router')
  const router = routerModule.default
  const registered = new Set(router.getRoutes().map((route) => String(route.name)))
  const navByKey = new Map(MODULE_NAV_ENTRIES.map((item) => [item.key, item]))

  for (const meta of MODULES) {
    const nav = navByKey.get(meta.key)
    if (!nav) {
      return { ok: false, detail: `模块「${meta.name}」缺少侧边栏入口，已停在该模块，补齐后请重试` }
    }
    if (!registered.has(meta.key)) {
      return {
        ok: false,
        detail: `模块「${meta.name}」的侧边栏入口存在，但路由 /${meta.key} 未注册，已停在该模块`,
      }
    }
    if (nav.path !== `/${meta.key}`) {
      return {
        ok: false,
        detail: `模块「${meta.name}」入口地址 ${nav.path} 与路由 /${meta.key} 不一致，已停在该模块`,
      }
    }
  }
  return { ok: true, detail: `${MODULES.length} 个模块的侧边栏入口与路由均已登记` }
}

// ---- 第三步：各模块台账 ----

type LedgerResult = {
  ok: boolean
  detail: string
  counts: ModuleCount[]
  baseline: 'seed' | 'snapshot'
}

function rowStructuralValid(meta: ModuleMeta, row: unknown): boolean {
  if (typeof row !== 'object' || row === null) {
    return false
  }
  const candidate = row as EntryRow
  return (
    typeof candidate.id !== 'undefined' &&
    typeof candidate.status === 'string' &&
    typeof candidate.pending === 'boolean' &&
    typeof candidate.abnormal === 'boolean' &&
    meta.statuses.includes(candidate.status)
  )
}

function checkLedgers(): LedgerResult {
  invalidateCache()
  const persisted = readPersistedEntries()
  if (persisted === null) {
    return {
      ok: false,
      detail: '业务台账不存在，版本步骤的初始化未生效，请重试',
      counts: [],
      baseline: 'seed',
    }
  }

  const counts: ModuleCount[] = []
  // 缺失模块即停：严格按模块登记顺序，第一个缺失/空台账就是停止点。
  for (const meta of MODULES) {
    const rows = persisted[meta.key]
    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        ok: false,
        detail: `模块「${meta.name}」台账缺失或为空，已停在该模块。点「重试」仅补齐该模块示例数据，其它模块业务数据不动`,
        counts,
        baseline: 'seed',
      }
    }
    const broken = rows.find((row) => !rowStructuralValid(meta, row))
    if (broken) {
      return {
        ok: false,
        detail: `模块「${meta.name}」台账存在结构损坏的记录（编号 ${String(
          (broken as EntryRow).id ?? '未知',
        )}，状态不在登记范围内），已停在该模块，请修复本地数据后重试`,
        counts,
        baseline: 'seed',
      }
    }
    counts.push(countModule(meta, rows))
  }

  // 复现基准：
  // - 首次校验（无历史快照）：必须与种子数据逐项一致，确保初始化后稳定复现；
  // - 已有快照：以最近一次快照为基准，业务数据的正常流转只提示漂移、不算失败，
  //   巡检待办、站房维护等台账在检查之后仍可继续使用。
  const snapshot = latestSnapshot()
  const baseline: 'seed' | 'snapshot' = snapshot ? 'snapshot' : 'seed'
  const expectedCounts = snapshot
    ? snapshot.modules.map((item) => ({
        key: item.key,
        name: MODULE_BY_KEY.get(item.key)?.name ?? item.name,
        created: item.created,
        pending: item.pending,
        abnormal: item.abnormal,
      }))
    : SEED_MODULE_COUNTS

  const expectedByKey = new Map(expectedCounts.map((item) => [item.key, item]))
  const drifted: ModuleCount[] = []
  for (const current of counts) {
    const expected = expectedByKey.get(current.key)
    if (!expected || !sameCount(current, expected)) {
      if (baseline === 'seed') {
        const name = MODULE_BY_KEY.get(current.key)?.name ?? current.key
        return {
          ok: false,
          detail: `模块「${name}」台账量与示例数据基准不一致（当前 ${current.created}/${current.pending}/${current.abnormal}，期望 ${
            expected ? `${expected.created}/${expected.pending}/${expected.abnormal}` : '缺失'
          }），已停在该模块`,
          counts,
          baseline,
        }
      }
      drifted.push(current)
    }
  }

  const totals = sumCounts(counts)
  let detail: string
  if (baseline === 'seed') {
    detail = `示例数据基准复现成功：${MODULES.length} 个模块，登记总量 ${totals.created}、待处理 ${totals.pending}、异常量 ${totals.abnormal}`
  } else if (drifted.length > 0) {
    detail = `台账结构完整，相对上次校验有 ${drifted.length} 个模块发生业务流转（${drifted
      .map((item) => item.name)
      .join('、')}），属正常变化；登记总量 ${totals.created}、待处理 ${totals.pending}、异常量 ${totals.abnormal}`
  } else {
    detail = `与上次校验结果完全一致，台账量、待处理量、异常量稳定复现；登记总量 ${totals.created}、待处理 ${totals.pending}、异常量 ${totals.abnormal}`
  }
  return { ok: true, detail, counts, baseline }
}

// ---- 站房维护台账：登记启动校验结果（同一天同一条，幂等更新，不产生重复事项） ----

const CHECK_RECORD_CODE_PREFIX = 'CHK-'

function upsertStationhouseCheckRecord(snapshot: CheckSnapshot): { inserted: boolean } {
  const rows = listRows('stationhouse').map((row) => ({ ...row }))
  const totals = snapshot.totals
  const today = snapshot.checkedAt.slice(0, 10)
  const code = `${CHECK_RECORD_CODE_PREFIX}${today.replace(/-/g, '')}`
  const content = `启动校验通过：数据版本 ${snapshot.version}，${
    snapshot.modules.length
  } 个模块台账齐备；业务台账 登记总量 ${totals.created}、待处理 ${totals.pending}、异常量 ${
    totals.abnormal
  }；基准=${snapshot.baseline === 'seed' ? '示例数据' : '上次校验快照'}；结果指纹 ${
    snapshot.fingerprint
  }`

  // 同一天已有启动校验记录就更新该条；跨天再追加新记录。连续两次执行不会重复登记。
  const index = rows.findIndex(
    (row) => typeof row['记录编号'] === 'string' && String(row['记录编号']).startsWith(code),
  )
  if (index >= 0) {
    rows[index] = { ...rows[index], 维护内容: content, 维护日期: today }
    saveRows('stationhouse', rows)
    return { inserted: false }
  }

  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  rows.push({
    id: nextId,
    status: '已验收',
    pending: false,
    abnormal: false,
    记录编号: code,
    站点编号: 'SYSTEM',
    维护类型: '启动校验',
    维护内容: content,
    维护单位: '本地运行检查',
    维护日期: today,
    费用支出: 0,
    维护状态: '已验收（系统登记）',
  })
  saveRows('stationhouse', rows)
  return { inserted: true }
}

// ---- 主流程 ----

export type RunUpdate = {
  steps: CheckStep[]
  passed: boolean
  snapshot: CheckSnapshot | null
}

export async function runStartupCheck(
  isRetry: boolean,
  emit: (update: RunUpdate) => void,
): Promise<boolean> {
  const steps = createSteps()
  let snapshotOut: CheckSnapshot | null = null
  const publish = (passed: boolean) => {
    emit({ steps: steps.map((step) => ({ ...step })), passed, snapshot: snapshotOut })
  }

  for (const step of steps) {
    step.state = 'running'
    publish(false)
    await delay(80)

    if (step.key === 'version') {
      const result = checkVersion(isRetry)
      step.state = result.ok ? 'passed' : 'failed'
      step.detail = result.detail
      if (!result.ok) {
        publish(false)
        return false
      }
      publish(false)
      continue
    }

    if (step.key === 'entries') {
      const result = await checkEntries()
      step.state = result.ok ? 'passed' : 'failed'
      step.detail = result.detail
      if (!result.ok) {
        publish(false)
        return false
      }
      publish(false)
      continue
    }

    // ledgers：重试时先做修复——只给缺失模块补示例数据，已有业务数据一律保留。
    if (isRetry) {
      const persisted = readPersistedEntries() ?? {}
      for (const meta of MODULES) {
        if (!Array.isArray(persisted[meta.key]) || persisted[meta.key].length === 0) {
          saveRows(meta.key, JSON.parse(JSON.stringify(SEED_ROWS[meta.key])) as EntryRow[])
        }
      }
    }

    const result = checkLedgers()
    step.state = result.ok ? 'passed' : 'failed'
    step.detail = result.detail
    if (!result.ok) {
      publish(false)
      return false
    }

    // 全部通过：把本次校验结果写进站房维护台账（幂等），再按写台账后的真实数据生成快照。
    const businessTotals = sumCounts(result.counts)
    const audited: CheckSnapshot = {
      version: seedVersion(),
      checkedAt: new Date().toISOString(),
      baseline: result.baseline,
      fingerprint: fingerprintCounts(result.counts),
      totals: businessTotals,
      modules: result.counts.map((item) => ({ ...item })),
    }
    upsertStationhouseCheckRecord(audited)

    invalidateCache()
    const finalCounts = MODULES.map((meta) =>
      countModule(meta, readPersistedEntries()?.[meta.key] ?? []),
    )
    const snapshot: CheckSnapshot = {
      version: seedVersion(),
      checkedAt: new Date().toISOString(),
      baseline: result.baseline,
      fingerprint: fingerprintCounts(finalCounts),
      totals: sumCounts(finalCounts),
      modules: finalCounts.map((item) => ({ ...item })),
    }
    const appended = appendSnapshotIfChanged(snapshot)
    snapshotOut = snapshot

    step.detail = `${result.detail}；${
      appended ? '已在站房维护台账登记本次启动校验结果' : '与上次校验结果一致，未重复登记事项'
    }`
    publish(true)
    return true
  }

  publish(false)
  return false
}
