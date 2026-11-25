# Backend Console — 产品设计

## 1. 定位与用户

| 项 | 定义 |
| -- | ---- |
| 产品 | cogito **平台运维控制台**（管理 `client` 所依赖的 cogito 能力面） |
| 用户 | 平台角色 `ADMIN`（JWT + 库内角色双检） |
| 非目标 | 终端用户产品、桌面壳、Studio、内容 CMS、YAML 密钥可视化编辑（密钥仅「是否已托管」） |

市场常见后台（Retool / AdminJS / Cloudflare / Stripe / Vercel 类控制台）的痛点：

1. **导航僵硬** — 模块多却不可重组，高频操作埋在三级菜单  
2. **表单坟场** — 供应商/模型/价格彼此孤立，改完不知影响面  
3. **表格过载** — 筛选弱、批量弱、跨实体跳转靠复制 ID  
4. **视觉噪音** — 卡片套卡片、紫渐变、无意义 glow，降低信噪比  
5. **偏好丢失** — 布局与书签不跨设备  

本产品以 **可编排工作区 + 关系优先列表 + 轻量动效** 回应上述痛点。

## 2. 信息架构（IA）

```
登录（ADMIN 门禁）
└── Shell（56px 顶栏 + 无背景文字分组 + 命令面板）
    ├── 概览 Overview          — 健康信号、用量火花线、待办审批
    ├── 身份 Identity
    │   ├── 用户 Users
    │   └── 租户 Tenants（含成员）
    ├── 网关 Gateway
    │   ├── 供应商 Providers   — 拖拽排序展示优先级（本地序 → 同步）
    │   ├── 模型 Models        — 按供应商分组 / 能力标签
    │   ├── 用量 Usage
    │   └── 审计 Audit         — 时间线 + 导出
    ├── 商业 Billing
    │   ├── 价目 Prices
    │   └── 对账 Reconciliation
    ├── 接入 Access
    │   └── SSO 连接
    ├── 运行时 Runtime
    │   ├── Agent 任务
    │   └── RAG 索引任务
    └── 控制台 Console
        └── 偏好（导航序 / 钉选 / 看板小部件 / 书签）
```

顶栏不画背景侧轨。当前分组的页面是文字链接，当前项只用主色字重。钉选进顶栏快捷项；排序在偏好页，持久化到 `console_preference`。

## 3. 模块职责（对照 API）

| 模块 | 主要 API | 交互要点 |
| ---- | -------- | -------- |
| 用户 | `/users` | 表格 + 抽屉编辑；角色/状态快切；禁止自降权自毁 |
| 租户 | `/tenants`、members | 主从：租户列表 → 成员 sortable |
| 供应商 | `/gateway/providers` | 卡片轨可拖排序；密钥只写不读 |
| 模型 | `/gateway/admin/models` | 按供应商折叠；能力 chip；配额内联 |
| 用量 | `/gateway/usage` | 筛选条 + 分页；跳转租户/模型 |
| 审计 | `/gateway/audit` (+ export) | 时间线；导出 CSV/NDJSON |
| 价目 | `/billing/prices` | 平台默认 vs 租户专属 |
| 对账 | `/billing/reconciliation` | 报表 + 导出 |
| SSO | `/sso/connections` | 连接 CRUD；secret 只写 |
| Agent / RAG | `/agent/tasks`、`/rag/index-tasks` | 详情只读运维；审批动作 |
| 偏好 | `/console/preference` | upsert JSON 布局 |

## 4. 视觉与动效原则

对齐仓库 design token（`@cogito/design`）与 client 外观：主色 `#4080ff`，圆角 10px，明暗跟随系统。登录 shader 与 client 共用「思 · 台」（`packages/brand`），不用 Swirl / CursorRipples。

| 层 | 做法 |
| -- | ---- |
| 登录 | 海军蓝桌面 + 薰衣草线框 + 慢速粒子 + 静态 FilmGrain |
| 壳层 | 一根顶栏加一行文字导航，铺在 `bg-background` 上，没有侧栏面 |
| 表格 | 筛选进 URL；列显隐；实体 ID 可跳转 |
| 主题 | `.dark` + `--primary` / `--radius`，选择写入偏好 |
| 动效 | 路由淡入；尊重 reduced-motion；按压用色阶 |

## 5. 体验原则（专业 PM）

1. **一屏一事** — 每个路由一个主任务；详情用 Sheet/Dialog，不新开「设置迷宫」  
2. **关系可跳** — 任意 `tenantID` / `modelID` / `userID` 可一键深链  
3. **危险可逆或二次确认** — 删用户、关供应商、改角色  
4. **失败可追踪** — 展示 `traceID`（与 cogito 信封一致）  
5. **偏好随身** — 导航序与书签进库；本地 debounce 写入防抖（lodash-es）  
6. **键盘优先** — `⌘K` 命令面板跳转模块与实体  

## 6. 成功指标（产品）

- ADMIN 完成「新建供应商 → 挂模型 → 看今日用量」≤ 3 分钟、≤ 8 次点击  
- 侧栏自定义后跨设备一致（偏好表同步）  
- 非 ADMIN 无法进入任何业务路由（前端门禁 + 服务端 300006）
