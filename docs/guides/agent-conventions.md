# Agent 提示备忘

会话内优先遵循以下约定。完整编码规范见 `.cursor/skills/coding-conventions/`；本文件只收高频、易忘的约束。

## 协作方式

- 动手前先说明改动方案并等我确认，避免理解偏差造成无效改动。

## 文件组织

- 文件粒度适中：既不过度拆分，也不过度聚合。
- 按模块划分；导出名与文件名、职责一致；模块末尾 `export { ... }`。
- **一个域多个文件就开目录**（目录名即域，内部用短名）；单文件域平铺。
- 目录内默认不建 barrel；仅当该域需要对外统一入口时才放 `index.ts`。

### 导入路径（studio）

- **同目录 `./x`；其余一切跨目录 `@/...`** —— 不写 `../../`，需要时直接用别名。
- `@/` → `src/`；`src` 之外的构建期产物用专用别名：`@schema`（Drizzle schema）、
  `@manifest`（在线工具清单）、`@generated`。
- 三条进程边界由 eslint 机器把关（不是口头约定）：
  | 进程        | 允许                                               | 禁止                                            |
  | ----------- | -------------------------------------------------- | ----------------------------------------------- |
  | renderer    | `@/` 全量（不含 `@/host/**`）                      | `@/host/**`、`@schema`、`@manifest`、`electron` |
  | host / main | `@/shared/**`、`@/host/**`、`@schema`、`@manifest` | `@/` 下的渲染目录、跨目录相对（`../`）          |
  | preload     | `@/shared/**`、同目录 `./preload*`                 | 其余 `@/`、`../` 与其它 `./`                    |
- `src/shared/` 内部保持层内相对（它是三进程共用的自包含层）。

## 改动审查

- 优先合并进现有逻辑，不要每次改动都叠一层补丁。
- 重复打补丁会让实现变复杂、难维护；能删旧路径就删，避免双轨并存。
- 只改任务所需代码，不做无关重构或顺手「清理」。
- 实现优先保证**可长期维护、易扩展**：结构清晰、职责单一，后续改动能落在局部。
- 整段算法/行为需按场景整体替换时，用**策略模式**拆出可互换的策略，便于扩展与复用。
- 单纯按输入取值/取处理器的逻辑判断，用**对象映射**表驱动实现，让数据代替分支。

## 架构

- IPC 是**契约单一事实源**：新增或修改一个频道要同时动 `shared/ipc/{channels,specs,api}`、
  `host/ipc/handlers`、`preload.ts` —— **缺一处就编译不过**（这套断言是刻意设计的，不要绕过）。
  完整规范见 [IPC 契约规范](../apps/studio/ipc-contract.md)。

## 命名

### 通用

- 简洁优雅，避免过长；超过约 20 字符应拆分。
- 有明确命名空间（模块 / 包）时可极致精简，不必重复前缀。
- 语义无法一眼看清时，用注释补充说明。

### 大小写

- 常量、枚举键、API 名：全大写下划线（如 `POST_SIGNIN`、`BASE_URL`）。
- 接口与类型：PascalCase（如 `ChannelSpec`、`IpcFailure`），不用下划线。

### 语义

- 同一概念用词一致，不同概念不复用同一个名字。
- 禁止 `get` 前缀 → 用 `find` / `fetch`；解析用 `parse` / `parsed`。
- 布尔用 `is` / `has` / `can`；非 `useState` 不用 `set`；集合用复数，避免包含 `list`。

## 结构与样式

### HTML / JSX

- 结构保持简洁，避免无用嵌套。
- 每一层容器都要有明确作用。

### 装饰

- 充分利用图标和图片做层次与点缀，避免纯文字堆砌的空界面。
- 装饰服务于信息层级，不抢主内容、不堆砌无意义图标。

## UI 组件库

各应用 UI 栈不同，**不要跨应用套用约定**：

| 应用             | UI 栈                                           |
| ---------------- | ----------------------------------------------- |
| `apps/studio`    | shadcn/ui + Tailwind v4（`@i-thinking/design`） |
| `apps/extension` | 同上                                            |
| `apps/client`    | 同上（Tauri；窗口装饰自绘）                     |
| `apps/devtools`  | 纯 Vue 3，无组件库                              |

### shadcn（studio / extension / client）

- 组件一律从 `@i-thinking/design/{components,assistant}/*` 引入；**不要手写 `<button>` / `<dialog>`，也不要在 app 内造一次性组件**。
- 按压反馈用色阶，**不用位移/缩放**：`hover:bg-primary-hover`、`active:bg-primary-active`（`--*-hover` / `--*-active` 已在 `globals.css` 定义并暴露为 `bg-*-hover` / `bg-*-active`，hover 提亮、active 下沉，与 antd 一致）。`active:translate-y-px` / `active:scale-*` 这类会改变布局盒子或引起抖动的写法不要再用。
- 设计 token 唯一源：`packages/design/src/styles/globals.css`；**app 侧不得另定义同名变量**。
- 用语义 token 的工具类（`bg-primary`、`text-muted-foreground`）；不写硬编码色值，不用任意值（`bg-[#4080ff]`）。
- 新增组件走 registry：`pnpm --filter @i-thinking/design registry:add <items>`。

### Tauri 窗口（仅 `apps/client`）

- 窗口一律 `decorations: false`，桌面壳自绘：`Caption`（`src/components/caption/`）负责拖拽区 + 窗口键，`Decorations`（`src/components/decorations/`）**是窗口容器**（标题栏 + 撑满内容 + 纵向 flex 列），不要用裸 `Caption` + 自建布局。
- 拖拽区：槽位容器带 `data-region="true"`（CSS `-webkit-app-region: drag`，WebView2 生效）；**槽位里的交互元素必须带 `data-region="false"`**，否则会被拖拽区吃掉点击（窗口键即如此处理）。`data-tauri-drag-region` 是 Tauri 自带的拖拽处理，其裸值只在直接点中该元素时触发，需要子树任意位置触发时写 `"deep"`。
- 每个窗口都要有自绘标题栏；只有刻意的无装饰浮层（`/overlay`）例外。`Decorations` 根节点透明，材质由窗口自身（mica / 透明）承担。
- 磁贴**不再用 Dialog**：双击开独立窗口（`activateTile` → `views/<component>`），按磁贴记录建窗（label `component:id`）。
- 磁贴分两层，**别把窗口逻辑塞回 features**：`views/<tile>/` 是窗口页（双击后开的整个界面，含 `workspace/**` 这类窗口专属实现）；`features/magnetic-tiles/<tile>/` 只放磁贴表面（板上那块磁贴：`<tile>.tsx` / `marker.tsx` / 尺寸 scss）与两侧共用件。
- 窗口 UI 一律归 `views/`：agent 窗口的部件在 `views/agent/chat/components/**`，子页共用件在 `views/agent/components/**`；`features/agent/` 只留 `acp/`、`model/` 与领域类型。
- 窗口内要分屏时用**布局路由 + 子页**，不要用 Dialog 或页内开关：`views/agent/agent.tsx` 是出口，
  `views/agent/{chat,settings}/` 是子页，URL 只有 `/agent/chat`（默认）与 `/agent/settings`（对齐 studio 的 `/agent`）。

### 旧约定（已废弃）

- `--ith-*`（antd cssVar）已全量迁到设计 token（`--primary` / `--foreground` / `--border` …）；不要再写 `var(--ith-…)` 或 `var(--ant-*)`。

## Git 提交

1. 先查看当前 git 改动（`status` / `diff` / 近期 `log`），再生成提交信息。
2. 需要时按主题分批提交；一条提交只表达一个意图。
3. 提交信息简洁、说明「为什么」；风格对齐仓库近期 commit（如 `fix(……): …`、`chore(): …`）。
4. 未经明确要求：不 `push`、不改 git config、不跳过 hooks。
5. **按文件逐个 `git add`**，不要 `git add <目录>` 或 `git add .` —— 工作树里常有未提交的 WIP，
   宽泛 add 会把它一起夹带进提交。commit 前用 `git diff --cached --name-only` 复核一遍。

## 版本发布

- client 版本升级使用 `bump:client`，以触发 client tag release 发布。
- 仓库版本升级按既有发版流程，以触发 tag release 发布。

## 本地工具（corex）

需要桌面 UI 证据（对照 Qoder、验收 Studio 窗口）时用 **corex**，不要臆测界面。完整 CLI：`corex help` / `corex help <cmd>`；动作参数以 `corex actions <id>` 为准。

### 推荐流程

1. **查能力**：`corex actions --bucket ui`（另有 `data` / `system`）；给 id 看参数表。
2. **找窗口**：`corex ui window list`，按标题过滤（如 `Qoder`、`i thinking`）。
3. **写指令 YAML** 到仓库根 `.cache/corex/directives/`（本仓库的 corex MCP `--directives` 指向这里）→ `corex validate <path>` → `corex run <path>`。
4. **读产物**：截图在 `.cache/corex/captures/qoder/` 与 `captures/studio/`，OCR 和窗口探测文本在 `.cache/corex/probes/`。这些都已 gitignore。用 Read 打开后再改代码。**不要把指令或截图留在 `apps/studio/scripts/`，也不要提交 `.cache/`。**

典型步骤链：`ui.window.focus`（`title_contains` + `prefer_largest`）→ `ui.wait` → `capture.screenshot`；需要时再加 `ui.click`、`capture.crop`、`capture.ocr`。

### 踩坑（会话实操）

- **Electron / Chromium 的 UIA 几乎只有标题栏**（最小化 / 最大化 / 关闭），React 内容树进不了 `ui element tree` —— UI 验收以截图为主，不要死磕控件树。
- PowerShell 下不要用 bash heredoc；用文件写入 YAML，路径写成正斜杠（`d:/.../out.png`）。
- 先 `corex actions capture.screenshot`（及 focus / click / crop / ocr）确认参数，再写 YAML，避免跑通后才发现字段名不对。
