import { SEED_VERSION } from './meta-types'
import type { LocalMeta } from './meta-types'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：业务数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
// 版本与校验快照单独存放，避免和业务数据互相覆盖。
const META_KEY = 'hydrology-monitor-station:meta'
const SNAPSHOT_KEY = 'hydrology-monitor-station:check-snapshots'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedFallback(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function readRawEntries(): Record<string, EntryRow[]> | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as Record<string, EntryRow[]>
  } catch {
    return null
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedFallback()
  const parsed = readRawEntries()
  if (parsed === null) {
    return fallback
  }
  // 仓库里新增的模块（旧快照没有该键）在这里补齐，但已有的业务模块一个字节都不覆盖。
  return { ...fallback, ...parsed }
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
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// ---- 启动校验专用：直接读持久层，绕过「缺失模块用示例补齐」的合并，缺了就是缺了 ----

export function readPersistedEntries(): Record<string, EntryRow[]> | null {
  return readRawEntries()
}

export function readMeta(): LocalMeta | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(META_KEY)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as LocalMeta
  } catch {
    return null
  }
}

export function writeMeta(meta: LocalMeta): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
  }
}

export function seedVersion(): string {
  return SEED_VERSION
}

// 加法迁移：已有业务数据原样保留，只把缺失的模块用示例数据补上，并刷新内存缓存。
// 旧快照（check-snapshots）不在这个键里，任何时候都不会被示例数据覆盖。
export function seedMissingEntries(): Record<string, EntryRow[]> {
  const current = readRawEntries() ?? {}
  let changed = false
  const merged: Record<string, EntryRow[]> = { ...current }
  for (const [key, rows] of Object.entries(SEED_ROWS)) {
    if (!Array.isArray(merged[key])) {
      merged[key] = clone(rows)
      changed = true
    }
  }
  if (changed || !readRawEntries()) {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    }
  }
  writeMeta({ version: SEED_VERSION })
  cache = merged
  return merged
}

// 让内存缓存与持久层重新对齐（外部直接改了 localStorage 后调用）。
export function invalidateCache(): void {
  cache = null
}

export function storageKey(): string {
  return STORAGE_KEY
}

export { META_KEY, SNAPSHOT_KEY }
