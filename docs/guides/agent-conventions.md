# Agent 提示备忘

高频、易忘的约束。完整编码规范见 `.cursor/skills/coding-conventions/`。

## 协作

- 动手前先说明改动方案，等我确认再改。

## 文件组织

- 粒度适中：不过度拆分 / 聚合。
- 按模块划分；导出名 = 文件名 = 职责；模块末尾 `export { ... }`。
- 一个域多个文件 → 开目录（目录名即域）；单文件域平铺。
- 默认不建 barrel；仅对外需统一入口时才放 `index.ts`。

### 导入路径（studio）

- 同目录 `./x`；跨目录一律 `@/...`，不写 `../../`。
- 别名：`@/` → `src/`；`@schema` / `@manifest` / `@generated` → 构建期产物。
- 进程边界（eslint 机器把关，非口头约定）：

| 进程        | 允许                                               | 禁止                                        |
| ----------- | -------------------------------------------------- | ------------------------------------------- |
| renderer    | `@/` 全量（不含 `@/host/**`）                      | `@/host/**`、`@schema`、`@manifest`、`electron` |
| host / main | `@/shared/**`、`@/host/**`、`@schema`、`@manifest` | `@/` 渲染目录、跨目录 `../`                 |
| preload     | `@/shared/**`、同目录 `./preload*`                 | 其余 `@/`、`../`、其它 `./`                 |

- `src/shared/` 内部保持层内相对（三进程共用的自包含层）。

## 改动审查

- 优先合并进现有逻辑，别叠补丁；能删旧路径就删，避免双轨并存。
- 只改任务所需代码，不做无关重构。
- 保证可维护、易扩展：结构清晰、职责单一。
- 整段行为按场景替换 → 策略模式；按输入取值 → 对象映射表驱动。

## 架构

- IPC 是契约单一事实源：改一个频道要同时动 `shared/ipc/{channels,specs,api}`、`host/ipc/handlers`、`preload.ts`（缺一处编译不过，勿绕过）。详见 [IPC 契约规范](../apps/studio/ipc-contract.md)。

## 命名

- 简洁，>20 字符应拆分；有命名空间时可精简，不必重复前缀；看不清时加注释。
- 常量 / 枚举键 / API：全大写蛇形（`POST_SIGNIN`）；接口 / 类型：PascalCase（`ChannelSpec`）。
- 同概念用词一致，不同概念不复用同名。
- 禁 `get` 前缀 → 用 `find` / `fetch`；解析用 `parse`。
- 布尔 `is` / `has` / `can`；非 `useState` 不用 `set`；集合用复数、不含 `list`。

## 结构与样式

- 结构简洁，无无用嵌套；每层容器有明确作用。
- 图标 / 图片做层次点缀，不堆砌、不抢主内容。

## UI 组件库

| 应用             | UI 栈                                           |
| ---------------- | ----------------------------------------------- |
| `apps/studio`    | shadcn/ui + Tailwind v4（`@i-thinking/design`） |
| `apps/extension` | 同上                                            |
| `apps/client`    | 同上（Tauri，窗口装饰自绘）                     |
| `apps/devtools`  | 纯 Vue 3，无组件库                              |

### shadcn（studio / extension / client）

- 组件一律 `@i-thinking/design/{components,assistant}/*`；不手写 `<button>` / `<dialog>`，不在 app 造一次性组件。
- 按压反馈用色阶，不用位移 / 缩放：`hover:bg-primary-hover` / `active:bg-primary-active`；禁 `active:translate-y-px` / `active:scale-*`。
- 设计 token 唯一源 `packages/design/src/styles/globals.css`；app 不得另定义同名变量。
- 用语义 token 工具类（`bg-primary`、`text-muted-foreground`）；不写硬编码色值 / 任意值。
- 新组件走 registry：`pnpm --filter @i-thinking/design registry:add <items>`。

### Tauri 窗口（仅 `apps/client`）

- 一律 `decorations: false`，自绘：`Caption` = 拖拽区 + 窗口键；`Decorations` = 窗口容器（标题栏 + flex 列）。不用裸 `Caption` + 自建布局。
- 拖拽：槽位容器 `data-region="true"`；槽位内交互元素必须 `data-region="false"`，否则被吃掉点击。`data-tauri-drag-region` 需子树任意位置触发时写 `"deep"`。
- 每窗口都要自绘标题栏，`/overlay` 例外；`Decorations` 根节点透明，材质由窗口承担。
- 磁贴不用 Dialog：双击开独立窗口（`activateTile` → `views/<component>`），label `component:id`。
- 磁贴两层：`views/<tile>/` = 窗口页；`features/magnetic-tiles/<tile>/` = 磁贴表面；别把窗口逻辑塞回 features。
- 窗口 UI 归 `views/`：agent 部件 `views/agent/chat/components/**`；`features/agent/` 只留 `acp/`、`model/`、领域类型。
- 分屏用布局路由 + 子页，不用 Dialog / 页内开关：出口 `views/agent/agent.tsx`，子页 `views/agent/{chat,settings}/`，URL 只有 `/agent/chat` 与 `/agent/settings`。

### 已废弃

- `--ith-*`（antd cssVar）已迁到设计 token；不再写 `var(--ith-…)` / `var(--ant-*)`。

## Git 提交

1. 先看 `status` / `diff` / `log`，再生成提交信息。
2. 按主题分批；一条提交一个意图。
3. 信息简洁、说明「为什么」；对齐近期风格（`fix(...)` / `chore()`）。
4. 未经要求：不 `push`、不改 config、不跳 hooks。
5. 按文件逐个 `git add`，不 `git add .`；commit 前 `git diff --cached --name-only` 复核。

## 版本发布

- client 升级用 `bump:client`；仓库升级按既有发版流程，均触发 tag release。

## 本地工具（corex）

需要桌面 UI 证据（对照 Qoder / 验收 Studio 窗口）时用 corex，不要臆测界面。

### 推荐流程

1. 查能力：`corex actions --bucket ui`（另有 `data` / `system`）。
2. 找窗口：`corex ui window list`，按标题过滤（`Qoder` / `i thinking`）。
3. 写 YAML 到 `.cache/corex/directives/` → `corex validate <path>` → `corex run <path>`。
4. 读产物：截图 `.cache/corex/captures/{qoder,studio}/`，OCR / 探测 `.cache/corex/probes/`（已 gitignore）。别把指令 / 截图留 `apps/studio/scripts/`，别提交 `.cache/`。

典型链：`ui.window.focus`（`title_contains` + `prefer_largest`）→ `ui.wait` → `capture.screenshot`（需要时 +`ui.click` / `capture.crop` / `capture.ocr`）。

### 踩坑

- Electron / Chromium 的 UIA 几乎只有标题栏，React 内容树进不了 `ui element tree` —— 以截图验收，别死磕控件树。
- PowerShell 不用 heredoc；YAML 写文件，路径正斜杠（`d:/.../out.png`）。
- 先 `corex actions capture.screenshot` / focus / click / crop / ocr 确认参数，再写 YAML。