<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">先完成本地运行检查，再汇总各业务模块的关键指标。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" :disabled="running" @click="run(false)">
          {{ running ? '检查执行中…' : '重新执行本地检查' }}
        </button>
        <button class="btn" type="button" :disabled="running" @click="refresh">重新统计</button>
      </div>
    </header>

    <article class="check-panel" :class="`check-panel--${panelTone}`">
      <header class="check-head">
        <strong>本地运行检查</strong>
        <span class="check-state">{{ panelStateText }}</span>
      </header>
      <ol class="check-steps">
        <li v-for="step in steps" :key="step.key" class="check-step" :data-state="step.state">
          <span class="check-step__icon">{{ stateIcon(step.state) }}</span>
          <div class="check-step__body">
            <span class="check-step__title">{{ step.title }}</span>
            <span v-if="step.detail" class="check-step__detail">{{ step.detail }}</span>
          </div>
          <button
            v-if="canRetry(step)"
            class="btn btn--retry"
            type="button"
            :disabled="running"
            @click="run(true)"
          >
            重试
          </button>
        </li>
      </ol>
      <footer v-if="passed && snapshot" class="check-foot">
        最近一次通过：{{ formatTime(snapshot.checkedAt) }} · 登记总量 {{ snapshot.totals.created }} ·
        待处理 {{ snapshot.totals.pending }} · 异常量 {{ snapshot.totals.abnormal }} ·
        结果指纹 {{ snapshot.fingerprint }}
      </footer>
    </article>

    <template v-if="passed">
      <div class="stat-row">
        <article v-for="card in cards" :key="card.label" class="stat-card">
          <span class="stat-label">{{ card.label }}</span>
          <strong class="stat-value">{{ card.value }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>业务模块</th><th>台账量</th><th>待处理</th><th>异常量</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in moduleRows" :key="row.name">
            <td>{{ row.name }}</td>
            <td>{{ row.created }}</td>
            <td>{{ row.pending }}</td>
            <td>{{ row.abnormal }}</td>
          </tr>
        </tbody>
      </table>
      <p class="check-hint">
        启动校验结果已登记到「站房维护」台账（维护类型：启动校验），可从侧边栏
        <RouterLink to="/stationhouse">站房维护</RouterLink> 入口查看；巡检待办不受检查影响，可继续在
        <RouterLink to="/inspection">巡检记录</RouterLink> 处理。
      </p>
    </template>

    <section v-else-if="!running" class="check-blocked">
      <p>本地运行检查未通过，运营概览暂不汇总，避免展示不可复现的数字。</p>
      <p class="page-desc">按上面停住的步骤处理后点「重试」；已有业务数据在迁移与修复时都会原样保留。</p>
    </section>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会重新初始化示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import {
  createSteps,
  runStartupCheck,
  type CheckStep,
  type RunUpdate,
} from '@/api/startup-check'
import type { CheckSnapshot } from '@/data/meta-types'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const steps = ref<CheckStep[]>(createSteps())
const running = ref(false)
const passed = ref(false)
const snapshot = ref<CheckSnapshot | null>(null)

const panelTone = computed(() => {
  if (running.value) return 'running'
  if (passed.value) return 'passed'
  return steps.value.some((step) => step.state === 'failed') ? 'failed' : 'idle'
})

const panelStateText = computed(() => {
  if (running.value) return '执行中'
  if (passed.value) return '全部通过'
  if (steps.value.some((step) => step.state === 'failed')) return '未通过，可重试'
  return '待执行'
})

function stateIcon(state: CheckStep['state']): string {
  switch (state) {
    case 'running':
      return '…'
    case 'passed':
      return '✓'
    case 'failed':
      return '✕'
    default:
      return '○'
  }
}

function canRetry(step: CheckStep): boolean {
  return step.state === 'failed'
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function run(isRetry: boolean) {
  if (running.value) {
    return
  }
  running.value = true
  passed.value = false
  steps.value = createSteps()
  const ok = await runStartupCheck(isRetry, (update: RunUpdate) => {
    steps.value = update.steps
    if (update.snapshot) {
      snapshot.value = update.snapshot
    }
  })
  running.value = false
  passed.value = ok
  if (ok) {
    refresh()
  }
}

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(() => {
  void run(false)
})
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.check-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--muted);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 14px;
}
.check-panel--running {
  border-left-color: var(--brand);
}
.check-panel--passed {
  border-left-color: #15803d;
}
.check-panel--failed {
  border-left-color: #b42318;
}
.check-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 14px;
}
.check-state {
  font-size: 12px;
  color: var(--muted);
}
.check-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.check-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
}
.check-step__icon {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: #eef2f7;
  color: var(--muted);
  flex: none;
}
.check-step[data-state='running'] .check-step__icon {
  background: #dbeafe;
  color: var(--brand);
}
.check-step[data-state='passed'] .check-step__icon {
  background: #dcfce7;
  color: #15803d;
}
.check-step[data-state='failed'] .check-step__icon {
  background: #fee4e2;
  color: #b42318;
}
.check-step__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.check-step__title {
  font-weight: 600;
}
.check-step__detail {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.check-step[data-state='failed'] .check-step__detail {
  color: #b42318;
}
.btn--retry {
  padding: 2px 10px;
  font-size: 12px;
  border-color: #b42318;
  color: #b42318;
}
.check-foot {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
  font-size: 12px;
  color: var(--muted);
}
.check-blocked {
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 8px;
  padding: 12px 14px;
  font-size: 13px;
}
.check-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--muted);
}
.check-hint a {
  color: var(--brand);
}
</style>
