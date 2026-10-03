import { MODULES } from './modules'

// 侧边栏入口的唯一登记处：页面入口校验拿这份清单和路由表逐项核对，
// App.vue 与启动检查共用，避免导航和路由各写一份后悄悄分叉。
export type NavEntry = {
  key: string
  label: string
  path: string
}

export const NAV_ENTRIES: NavEntry[] = [
  { key: 'dashboard', label: '运营概览', path: '/' },
  ...MODULES.map((meta) => ({ key: meta.key, label: meta.name, path: `/${meta.key}` })),
]

export const MODULE_NAV_ENTRIES: NavEntry[] = NAV_ENTRIES.filter((item) => item.key !== 'dashboard')
