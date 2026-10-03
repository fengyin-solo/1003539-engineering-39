/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; key?: string; created: number; pending: number; abnormal: number }[]
}

/** 单个模块台账的可复现基线：初始化示例数据后必须稳定等于这份数字。 */
export type ModuleBaseline = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

/** 启动检查里一个模块的核对结果。 */
export type ModuleCheckResult = {
  key: string
  name: string
  expected: ModuleBaseline
  actual: { created: number; pending: number; abnormal: number }
  state: 'matched' | 'mismatch' | 'missing'
  detail: string
}

/** 一次启动检查的完整结果。 */
export type StartupCheckResult = {
  ok: boolean
  repaired: boolean
  /** 检查在哪个模块停下（缺失模块直接中断，修掉后可重试）。 */
  stoppedAt: string | null
  dataVersion: {
    expected: string
    actual: string | null
    state: 'current' | 'stale' | 'missing'
    detail: string
  }
  pageEntries: {
    total: number
    missing: string[]
    state: 'matched' | 'missing'
    detail: string
  }
  modules: ModuleCheckResult[]
  /** 本次检查在巡检台账里落下/复用的待办记录编号（人类可读）。 */
  inspectionTodos: string[]
  /** 本次检查在站房维护台账里落下/复用的校验结果记录编号。 */
  stationhouseRecord: string | null
  /** 本次检查写入的业务事项数：幂等重跑应为 0。 */
  generatedItems: number
  messages: string[]
}
