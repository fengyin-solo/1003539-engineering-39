<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="running" @click="runCheck(false)">
          运行启动检查
        </button>
        <button
          v-if="check && !check.ok"
          class="btn"
          type="button"
          :disabled="running"
          @click="runCheck(true)"
        >
          重试（补齐缺失模块）
        </button>
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>

    <article class="check-panel" :class="panelClass" v-if="check">
      <div class="check-head">
        <strong>本地运行检查：{{ check.ok ? '通过' : '未通过' }}</strong>
        <span v-if="check.repaired" class="check-tag">已重试补齐</span>
        <span v-if="check.ok && check.generatedItems === 0" class="check-tag">幂等：未生成重复事项</span>
      </div>
      <ul class="check-messages">
        <li v-for="(line, index) in check.messages" :key="index">{{ line }}</li>
      </ul>
      <div class="check-grid">
        <div class="check-item">
          <span class="check-label">数据版本</span>
          <span :class="['check-state', versionClass]">{{ versionText }}</span>
          <span class="check-detail">{{ check.dataVersion.detail }}</span>
        </div>
        <div class="check-item">
          <span class="check-label">页面入口</span>
          <span :class="['check-state', check.pageEntries.state === 'matched' ? 'ok' : 'bad']">
            {{ check.pageEntries.state === 'matched' ? '齐全' : '缺失' }}
          </span>
          <span class="check-detail">{{ check.pageEntries.detail }}</span>
        </div>
        <div class="check-item">
          <span class="check-label">模块台账</span>
          <span class="check-state" :class="moduleStateClass">{{ matchedCount }}/{{ check.modules.length || totalModules }} 复现一致</span>
          <span class="check-detail" v-if="check.stoppedAt">停在：{{ stoppedModuleName }}（重试可继续）</span>
        </div>
        <div class="check-item">
          <span class="check-label">校验台账</span>
          <span class="check-state ok">站房维护 {{ check.stationhouseRecord ?? '—' }}</span>
          <span class="check-detail" v-if="check.inspectionTodos.length">
            巡检待办：{{ check.inspectionTodos.join('、') }}
          </span>
        </div>
      </div>
      <table class="data-table check-table" v-if="check.modules.length">
        <thead>
          <tr><th>模块</th><th>台账（实际/基线）</th><th>待处理（实际/基线）</th><th>异常（实际/基线）</th><th>核对</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in check.modules" :key="row.key" :class="{ 'row-stopped': row.key === check.stoppedAt }">
            <td>{{ row.name }}</td>
            <td>{{ row.actual.created }} / {{ row.expected.created }}</td>
            <td>{{ row.actual.pending }} / {{ row.expected.pending }}</td>
            <td>{{ row.actual.abnormal }} / {{ row.expected.abnormal }}</td>
            <td>
              <span :class="['check-state', row.state === 'matched' ? 'ok' : row.state === 'missing' ? 'bad' : 'warn']">
                {{ row.state === 'matched' ? '一致' : row.state === 'missing' ? '缺失中断' : '量值出入（保留业务数据）' }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </article>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key ?? row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；启动检查只补缺失模块，不覆盖已有业务数据。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { loadOverview } from '@/api/local-service'
import { runStartupCheck } from '@/data/startup-check'
import { MODULES } from '@/data/modules'
import type { OverviewResult, StartupCheckResult } from '@/data/types'

const router = useRouter()
const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const check = ref<StartupCheckResult | null>(null)
const running = ref(false)
const totalModules = MODULES.length

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

function entryPaths(): string[] {
  return router.getRoutes().map((route) => route.path)
}

async function runCheck(repair: boolean) {
  running.value = true
  try {
    // 让按钮的禁用态先渲染，再跑同步检查，体验上能看到「正在检查」。
    await new Promise((resolve) => setTimeout(resolve, 0))
    check.value = runStartupCheck({ entryPaths: entryPaths(), repair })
    refresh()
  } finally {
    running.value = false
  }
}

const panelClass = computed(() => {
  if (!check.value) {
    return ''
  }
  return check.value.ok ? (check.value.repaired ? 'panel-warn' : 'panel-ok') : 'panel-bad'
})

const versionClass = computed(() => {
  const state = check.value?.dataVersion.state
  return state === 'current' ? 'ok' : state === 'stale' ? 'warn' : 'bad'
})

const versionText = computed(() => {
  const info = check.value?.dataVersion
  if (!info) {
    return ''
  }
  if (info.state === 'current') {
    return info.actual ? `当前 ${info.actual}` : '首次初始化'
  }
  return info.state === 'stale' ? '版本落后（保留数据）' : '无版本戳'
})

const matchedCount = computed(
  () => check.value?.modules.filter((item) => item.state === 'matched').length ?? 0,
)

const moduleStateClass = computed(() => {
  if (!check.value?.stoppedAt) {
    return matchedCount.value === (check.value?.modules.length ?? 0) ? 'ok' : 'warn'
  }
  return 'bad'
})

const stoppedModuleName = computed(
  () => MODULES.find((item) => item.key === check.value?.stoppedAt)?.name ?? check.value?.stoppedAt,
)

onMounted(() => {
  // 进运营概览先自动跑一次检查（只检查不修复），缺失模块会停住等手动重试。
  void runCheck(false)
  refresh()
})
</script>

<style scoped>
.check-panel {
  border: 1px solid var(--border-color, #d8dee8);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: #fafbfd;
}
.panel-ok { border-left: 4px solid #2f9e44; }
.panel-warn { border-left: 4px solid #e8a13a; }
.panel-bad { border-left: 4px solid #d64545; }
.check-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.check-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: #eef2f7;
  color: #4a5568;
}
.check-messages {
  margin: 4px 0 10px;
  padding-left: 18px;
  color: #4a5568;
  font-size: 13px;
  line-height: 1.7;
}
.check-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 10px;
}
.check-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: #fff;
  border: 1px solid #e4e8ef;
  border-radius: 6px;
  padding: 8px 10px;
}
.check-label { font-size: 12px; color: #8a94a6; }
.check-detail { font-size: 12px; color: #5b6577; }
.check-state { font-weight: 600; font-size: 13px; }
.check-state.ok { color: #2f9e44; }
.check-state.warn { color: #c07a12; }
.check-state.bad { color: #d64545; }
.check-table th, .check-table td { font-size: 13px; }
.row-stopped { background: #fdeeee; }
</style>
