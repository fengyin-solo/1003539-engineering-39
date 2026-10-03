/** 本地运行检查相关的持久化结构：版本信息与历次校验快照。 */

// 示例数据的当前版本。示例数据结构调整时递增；旧版本本地数据走加法迁移，不覆盖已有业务数据。
export const SEED_VERSION = '2026.10.1'

export type LocalMeta = {
  version: string
}

// 一次校验完成时各模块的台账统计，作为下一次「稳定复现」的对照基准。
export type CheckSnapshot = {
  version: string
  checkedAt: string
  baseline: 'seed' | 'snapshot'
  fingerprint: string
  totals: { created: number; pending: number; abnormal: number }
  modules: { key: string; name: string; created: number; pending: number; abnormal: number }[]
}
