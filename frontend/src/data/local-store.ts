import { SEED_ROWS } from './seed'
import { MODULES } from './modules'
import type { EntryRow } from './types'

// 本地持久化：业务数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
// 数据版本单独存一个键：版本不匹配只补不覆盖，旧快照不会被新示例顶掉。
const VERSION_KEY = 'hydrology-monitor-station:data-version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function storage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  return window.localStorage
}

/** 示例快照的全量台账（深拷贝，调用方改不到种子）。 */
export function seedSnapshot(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

/** 浏览器里真实保存的业务台账；没有 localStorage（如测试/SSR）时回落到空表。 */
export function rawStoredRows(): Record<string, EntryRow[]> {
  const ls = storage()
  if (!ls) {
    return {}
  }
  const raw = ls.getItem(STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    return {}
  }
}

/**
 * 页面日常使用的台账：种子只给缺失模块兜底，绝不覆盖已有业务数据。
 * 读不到或解析失败时，仍沿用首次播种逻辑把完整示例写进本机。
 */
function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedSnapshot()
  const ls = storage()
  if (!ls) {
    return fallback
  }
  const raw = ls.getItem(STORAGE_KEY)
  if (!raw) {
    ls.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    ls.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  const ls = storage()
  if (ls) {
    // 以浏览器里已有的真实数据为底合并，避免把别的模块的本地改动冲掉。
    const stored = rawStoredRows()
    ls.setItem(STORAGE_KEY, JSON.stringify({ ...stored, [key]: rows }))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 只读：该模块的业务台账是否已在本机存在（含空台账）。 */
export function hasModuleData(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(rawStoredRows(), key)
}

/**
 * 只补一个缺失模块的示例台账，已有的业务数据一行不动。
 * 返回 true 表示这次确实补了（可据此继续后续检查/重试）。
 */
export function seedMissingModule(key: string): boolean {
  if (!SEED_ROWS[key] || hasModuleData(key)) {
    return false
  }
  saveRows(key, clone(SEED_ROWS[key]))
  return true
}

/** 把全部模块里还缺台账的一次性补齐，返回被补的模块键。 */
export function seedMissingModules(keys: string[] = MODULES.map((item) => item.key)): string[] {
  const seeded: string[] = []
  for (const key of keys) {
    if (seedMissingModule(key)) {
      seeded.push(key)
    }
  }
  return seeded
}

export function readDataVersion(): string | null {
  return storage()?.getItem(VERSION_KEY) ?? null
}

export function writeDataVersion(version: string): void {
  storage()?.setItem(VERSION_KEY, version)
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function versionKey(): string {
  return VERSION_KEY
}

/** 测试辅助：清掉内存缓存，保证下一次读取重新走 localStorage。 */
export function invalidateCache(): void {
  cache = null
}
