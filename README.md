# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

可重复的本地运行检查（建议改完示例数据后跑一遍）：

```bash
cd frontend
npm test        # vitest：初始化复现 / 缺失模块停住重试 / 幂等 / 旧数据保留
```

进入「运营概览」页面会自动执行一次启动检查，也可以点页面上的「运行启动检查 /
重试（补齐缺失模块）」手动触发。检查内容：

1. **初始化复现**：本机无数据时按示例数据初始化全部 18 个模块，台账量、待处理量、
   异常量逐模块与内置基线（`src/data/startup-check.ts` 的 `seedBaseline()`）核对。
2. **数据版本**：版本戳存在 `hydrology-monitor-station:data-version`。版本落后只补缺失模块，
   **已有业务数据和旧快照一律保留，不会被新示例覆盖**。
3. **页面入口**：运营概览与全部模块路由逐一核对，缺入口直接报出路径。
4. **缺失模块停住 + 可重试**：发现模块台账缺失时检查停在该模块；点「重试」只补这一个
   模块的示例台账后继续核对。
5. **结果落台账且幂等**：每次检查在「站房维护」台账 upsert 一条本数据版本的校验结果
   （编号 `SH-CHECK-<版本>`，通过/未通过可在站房维护页面正常流转）；模块缺失时在
   「巡检记录」生成一条待办（编号 `INSP-CHECK-<模块>`，补齐后保留待人工复核）。
   系统事项按稳定负号 ID + 批次标记 upsert，**连续执行两次不生成重复事项**，
   且系统事项不参与基线比对，重复检查仍逐模块显示一致。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries` 这一项，或调用 `resetModule(模块)`。
- 调整示例数据后，把 `frontend/src/data/startup-check.ts` 里的 `DATA_VERSION` 抬一位，
  并运行 `npm test` 确认基线复现；老用户本机数据不会被覆盖，只会补齐新增模块。
