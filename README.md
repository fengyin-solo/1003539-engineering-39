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

## 运营概览的本地运行检查

打开「运营概览」时会自动执行一次**本地运行检查**，按顺序跑三步，任一步失败即停在该步，
修复后点步骤旁的「重试」继续：

1. **核对数据版本**：首次运行自动播种示例数据；检测到旧版本本地数据时停下，点重试做
   **加法迁移**——已有业务数据原样保留，只补齐缺失模块。
2. **核对页面入口**：逐个业务模块核对侧边栏入口与路由是否都已登记，缺失就停在该模块。
3. **核对各模块台账**：台账缺失/损坏即停；首次校验必须与示例数据基准逐项一致（18 个模块、
   登记总量 54、待处理 36、异常 18），保证台账量、待处理量、异常量稳定复现；之后以最近一次
   校验快照为基准，正常业务流转只提示漂移、不阻断使用。

约定与持久化：

- 业务数据键 `hydrology-monitor-station:entries`；版本键
  `hydrology-monitor-station:meta`；校验快照键
  `hydrology-monitor-station:check-snapshots`（只追加，旧快照永远不会被示例数据覆盖）。
- 检查通过后会在**站房维护台账**里幂等登记一条 `维护类型=启动校验` 的记录（记录编号
  `CHK-YYYYMMDD`，同一天更新原记录），连续执行多次不会产生重复事项；从侧边栏
  「站房维护」入口即可查看每次启动校验的结果。
- 检查只读业务台账、不改动原有事项；巡检待办、站房维护等页面在检查后照常使用。
- 已有业务数据时默认选择「保留 + 加法迁移」，不存在重置或覆盖入口。

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`；本地运行检查逻辑在 `frontend/src/api/startup-check.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`；侧边栏入口统一登记在 `frontend/src/data/nav.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries`、
  `hydrology-monitor-station:meta`、`hydrology-monitor-station:check-snapshots` 三项，
  或调用 `resetModule(模块)`。
