import { beforeEach, describe, expect, it } from 'vitest'

import { MODULES } from '@/data/modules'
import {
  DATA_VERSION,
  expectedEntryPaths,
  runStartupCheck,
  seedBaseline,
} from '@/data/startup-check'
import {
  invalidateCache,
  readDataVersion,
  rawStoredRows,
  storageKey,
  versionKey,
} from '@/data/local-store'
import { SEED_ROWS } from '@/data/seed'

const ALL_PATHS = expectedEntryPaths()
const SH_MARKER = '启动校验批次'
const INSP_MARKER = '启动校验事项'

function clearLocal() {
  window.localStorage.clear()
  invalidateCache()
}

function rowsOf(key: string) {
  invalidateCache()
  return rawStoredRows()[key] ?? []
}

function systemStationhouse() {
  return rowsOf('stationhouse').filter((row) => String(row[SH_MARKER] ?? '') !== '')
}

function systemInspection() {
  return rowsOf('inspection').filter((row) => String(row[INSP_MARKER] ?? '') !== '')
}

describe('运营概览启动检查', () => {
  beforeEach(() => {
    clearLocal()
  })

  it('首次运行初始化示例数据，18 个模块台账/待处理/异常量全部与基线一致，且版本与入口核对通过', () => {
    const result = runStartupCheck({ entryPaths: ALL_PATHS })

    expect(result.ok).toBe(true)
    expect(result.stoppedAt).toBeNull()
    expect(result.pageEntries.state).toBe('matched')
    expect(result.dataVersion.state).toBe('current')
    expect(readDataVersion()).toBe(DATA_VERSION)
    expect(result.modules).toHaveLength(MODULES.length)

    const baseline = seedBaseline()
    for (const expected of baseline) {
      const item = result.modules.find((row) => row.key === expected.key)
      expect(item?.state).toBe('matched')
      expect(item?.actual).toEqual({
        created: expected.created,
        pending: expected.pending,
        abnormal: expected.abnormal,
      })
    }

    // 本机落盘的示例台账必须与快照一致（启动检查自身写入的系统事项除外），
    // 刷新页面后基线数字照样复现。
    const stored = rawStoredRows()
    for (const expected of baseline) {
      const rows = stored[expected.key] ?? []
      const systemRows = rows.filter(
        (row) =>
          String(row[SH_MARKER] ?? '') !== '' || String(row[INSP_MARKER] ?? '') !== '',
      )
      const businessRows = rows.filter(
        (row) =>
          String(row[SH_MARKER] ?? '') === '' && String(row[INSP_MARKER] ?? '') === '',
      )
      expect(systemRows.length + businessRows.length).toBe(rows.length)
      expect(businessRows).toHaveLength(expected.created)
      expect(businessRows.filter((row) => row.pending)).toHaveLength(expected.pending)
      expect(businessRows.filter((row) => row.abnormal)).toHaveLength(expected.abnormal)
    }
  })

  it('连续执行两次：第二次不新增任何事项，台账记录、编号、数量保持不变（幂等）', () => {
    const first = runStartupCheck({ entryPaths: ALL_PATHS })
    expect(first.generatedItems).toBe(1) // 首次只产生站房校验记录，巡检待办只在异常时产生

    const shAfterFirst = systemStationhouse()
    expect(shAfterFirst).toHaveLength(1)
    const inspAfterFirst = systemInspection()
    expect(inspAfterFirst).toHaveLength(0)

    const second = runStartupCheck({ entryPaths: ALL_PATHS })
    expect(second.ok).toBe(true)
    expect(second.generatedItems).toBe(0)
    expect(second.stationhouseRecord).toBe(first.stationhouseRecord)

    // 检查自身写入的系统事项不参与基线比对：第二次逐模块仍然全部复现一致。
    expect(second.modules.every((row) => row.state === 'matched')).toBe(true)

    expect(systemStationhouse()).toEqual(shAfterFirst)
    expect(systemInspection()).toEqual(inspAfterFirst)
  })

  it('模块台账缺失时检查停在该模块，可重试补齐后续检通过；已补模块之外的业务数据不被覆盖', () => {
    // 先初始化，再模拟「老版本本地数据缺一个模块」：删掉 discharge 的台账。
    runStartupCheck({ entryPaths: ALL_PATHS })
    const stored = rawStoredRows()
    delete stored.discharge
    window.localStorage.setItem(storageKey(), JSON.stringify(stored))
    window.localStorage.removeItem(versionKey())
    invalidateCache()

    const failed = runStartupCheck({ entryPaths: ALL_PATHS })
    expect(failed.ok).toBe(false)
    expect(failed.stoppedAt).toBe('discharge')
    // 停在缺失模块：后面的模块不再继续核对。
    expect(failed.modules.map((row) => row.key)).not.toContain('rainfall')
    // 站房台账先记一条未通过结果，巡检台账落下待办。
    expect(systemStationhouse()).toHaveLength(1)
    expect(systemStationhouse()[0].维护状态).toBe('未通过')
    expect(systemInspection()).toHaveLength(1)
    expect(systemInspection()[0].status).toBe('待巡检')

    // 点重试：补齐 discharge，后续模块继续核对并全绿。
    const retried = runStartupCheck({ entryPaths: ALL_PATHS, repair: true })
    expect(retried.ok).toBe(true)
    expect(retried.repaired).toBe(true)
    expect(retried.stoppedAt).toBeNull()
    expect(retried.modules).toHaveLength(MODULES.length)

    // 示例台账补齐；巡检待办与站房记录都仍是同一条（没有重复造）。
    expect(rowsOf('discharge')).toHaveLength(SEED_ROWS.discharge.length)
    expect(systemInspection()).toHaveLength(1)
    expect(systemInspection()[0].记录编号).toBe('INSP-CHECK-DISCHARGE')
    expect(systemStationhouse()).toHaveLength(1)
    expect(systemStationhouse()[0].维护状态).toBe('通过')
    // 重试总共只新插过：未通过站房记录 + 巡检待办（重试通过时两条都只更新）。
    expect(retried.generatedItems).toBe(0)
  })

  it('存在已有业务数据时一律保留：版本落后只补缺失模块，旧快照和业务改动不被新示例覆盖', () => {
    // 老版本数据：模块台账都在，station 被用户改过、加过；版本戳停留在旧版。
    const oldSnapshot = JSON.parse(JSON.stringify(SEED_ROWS)) as typeof SEED_ROWS
    oldSnapshot.station[0].站点名称 = '用户改过的站名'
    oldSnapshot.station.push({
      ...oldSnapshot.station[0],
      id: 999,
      站点编号: 'STAT-0999',
      站点名称: '用户新增的站点',
    })
    window.localStorage.setItem(storageKey(), JSON.stringify(oldSnapshot))
    window.localStorage.setItem(versionKey(), '2020-01-01.1')
    invalidateCache()

    // 台账齐全：检查直接通过并盖新版本戳，用户数据一行不动（station 量值与基线出入只告警）。
    const result = runStartupCheck({ entryPaths: ALL_PATHS })
    expect(result.ok).toBe(true)
    expect(result.dataVersion.state).toBe('stale')
    const stations = rowsOf('station')
    expect(stations.find((row) => row.id === 1)?.站点名称).toBe('用户改过的站名')
    expect(stations.find((row) => row.id === 999)?.站点名称).toBe('用户新增的站点')
    expect(stations).toHaveLength(SEED_ROWS.station.length + 1)
    expect(readDataVersion()).toBe(DATA_VERSION)

    // 再模拟老快照缺模块：先停住，重试只补缺失模块，其他业务数据仍原样保留。
    const stored = rawStoredRows()
    delete stored.sediment
    window.localStorage.setItem(storageKey(), JSON.stringify(stored))
    window.localStorage.setItem(versionKey(), '2020-01-01.1')
    invalidateCache()

    const stopped = runStartupCheck({ entryPaths: ALL_PATHS })
    expect(stopped.ok).toBe(false)
    expect(stopped.stoppedAt).toBe('sediment')

    const repaired = runStartupCheck({ entryPaths: ALL_PATHS, repair: true })
    expect(repaired.ok).toBe(true)
    expect(repaired.repaired).toBe(true)
    expect(rowsOf('sediment')).toHaveLength(SEED_ROWS.sediment.length)
    expect(rowsOf('station').find((row) => row.id === 999)?.站点名称).toBe('用户新增的站点')
    expect(readDataVersion()).toBe(DATA_VERSION)
  })

  it('页面入口缺失时明确报出缺哪些入口', () => {
    const result = runStartupCheck({ entryPaths: ['/'] }) // 没有任何模块入口
    expect(result.ok).toBe(false)
    expect(result.pageEntries.state).toBe('missing')
    expect(result.pageEntries.missing).toContain('/station')
    expect(result.pageEntries.missing).toContain('/stationhouse')
    expect(result.pageEntries.missing).toHaveLength(MODULES.length)
  })

  it('检查完成后巡检待办和站房校验记录仍是可正常流转的业务数据', () => {
    runStartupCheck({ entryPaths: ALL_PATHS })
    // 造一个缺失模块，让检查同时生成巡检待办和未通过站房记录。
    const stored = rawStoredRows()
    delete stored.rainfall
    window.localStorage.setItem(storageKey(), JSON.stringify(stored))
    window.localStorage.removeItem(versionKey())
    invalidateCache()
    runStartupCheck({ entryPaths: ALL_PATHS })

    const todo = systemInspection()[0]
    expect(todo.记录编号).toBe('INSP-CHECK-RAINFALL')
    expect(todo.pending).toBe(true)
    // 巡检待办能被正常动作流转（与页面 runAction 同样的字段约定：statuses 最后一个为终态）。
    expect(['待巡检', '已巡检', '发现故障', '已处置']).toContain(todo.status)

    const sh = systemStationhouse()[0]
    expect(sh.维护类型).toBe('启动校验')
    expect(['待安排', '已安排', '施工中', '已完成', '已验收']).toContain(sh.status)
    expect(sh.记录编号).toMatch(/^SH-CHECK-/)
  })
})
