/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// 测试专用配置：只跑 src/test 下的纯逻辑用例，用 jsdom 提供 localStorage。
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/test/**/*.spec.ts'],
  },
})
