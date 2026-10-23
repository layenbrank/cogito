# @cogito/design

设计系统：**shadcn/ui 原子组件** + **assistant-ui elements** + 设计 token。被 `apps/studio`（Electron）与 `apps/extension`（MV3）共用。

## 结构

```text
packages/design/
├── components.json          # shadcn 配置（style/baseColor/iconLibrary 必须与各 app 一致）
├── src/
│   ├── components/          # shadcn 原子组件（CLI 安装）
│   ├── assistant/           # assistant-ui registry 组件（CLI 安装）
│   ├── hooks/
│   └── styles/globals.css   # Tailwind v4 入口 + 全部设计 token（唯一源）
└── tsconfig.json            # paths 把包名映射到 ./src/*，供 CLI 解析别名
```

对齐官方 monorepo 模板（`packages/ui`）的形态：**目录名即子路径**，`src/components` / `src/hooks` /
`src/styles` 三件套，没有通配包根这一类后门。

## 导入路径

| 导入写法                                         | 实际文件                             |
| ------------------------------------------------ | ------------------------------------ |
| `@cogito/design/components/button`           | `src/components/button.tsx`          |
| `@cogito/design/assistant/thread.aui`        | `src/assistant/thread.aui.tsx`       |
| `@cogito/design/hooks/use-copy-to-clipboard` | `src/hooks/use-copy-to-clipboard.ts` |
| `@cogito/design/globals.css`                 | `src/styles/globals.css`             |

`package.json` 里 **`exports`（对外）与 `imports`（包内自引用）两张表并存** —— 官方模板同款：

| 表        | 前缀                                        | 用途                 |
| --------- | ------------------------------------------- | -------------------- |
| `exports` | `@cogito/design/*`                      | 各 app 消费          |
| `imports` | `#components/*`、`#assistant/*`、`#hooks/*` | 本包组件之间互相引用 |

新增一类组件 = 在 `src/` 建目录，并同时补 `exports` 与 `imports` 两张表。

## 约束

- **token 只在 `src/styles/globals.css` 定义**；app 侧通过 `@import "@cogito/design/globals.css"` 引入，不要再定义同名变量。
- 类名合并统一用 `cn`，直接从 `cn` 包导入（`import { cn } from 'cn'`）；不要再包一层 re-export。
- **包内互相引用用 `#components/*`、`#hooks/*`**（`package.json` 的 `imports` 表），不要用 `@/...`：
  app 的 `resolve.tsconfigPaths` 会用 app 自己的 tsconfig 解析**所有 importer** 的 `@/*`，
  会把本包的内部导入解析到 `apps/<app>/src`（Vite 插件也拦不住，因为改写发生在插件之前）。
  `#` 前缀是 Node 的子路径导入语法，**不与 app 的 `@/*` 冲突**，这正是官方模板用它做包内自引用的原因。
- 新增组件走 CLI，不要手写目录结构：

```bash
# 在本包目录下执行（CLI 读本包的 components.json）
pnpm --filter @cogito/design registry:add @assistant-ui/thread @assistant-ui/thread-list
```

CLI 靠本包 `tsconfig.json` 的 `paths`（`@cogito/design/*` → `./src/*`）解析 `components.json` 里的别名，
产物因此**直接落到** `src/components/`、`src/assistant/`，不需要任何后处理脚本。

> **覆盖策略（2026-10 起）**：组件保持 registry 原样 —— 需要更新时用 `--overwrite` 覆盖，
> 不要在本包手改组件代码（改了就再也追不上上游）。覆盖后有三个本仓固定动作：
>
> 1. **图标**：registry 按 `components.json` 的 `iconLibrary: lucide` 生成 `lucide-react` 导入，
>    但本包**不依赖 `lucide-react`** —— 渲染统一走 `@iconify/react/offline` 的 `Icon`，图标名保留
>    lucide 名：`ChevronDownIcon` → `<Icon icon="lucide:chevron-down" />`。
>    即 `iconLibrary: lucide` 只声明「图标名用 lucide」，不声明渲染库。
> 2. `pnpm exec prettier --write <file>` 把文件归一到本仓格式。
> 3. **核对 Base UI 的名字**：base-nova 的 registry 产物是 Base UI，radix 的一批 prop / 属性名
>    **在 Base UI 里不存在**，传进去类型不报错、运行时静默失效。覆盖后按
>    `node_modules/@base-ui/react/**/*.d.ts` 与 `*DataAttributes.d.ts` 逐个对一遍，至少包括：
>    `onSelect` → `onClick`（**菜单项点不点得动就看这条**）、`data-state=on` → `data-pressed`、
>    `data-state=open|closed` → `data-open|data-closed`、`data-state=checked` → `data-checked`、
>    `--radix-*` → `--anchor-width` / `--available-height` / `--collapsible-panel-height`。
>    另外两条**类型检查抓不到**的坑（都是踩过的）：
>    - Base UI 的**事件处理器从右往左执行**（`render.props` 在最右 = 最先跑）。所以调用点不要再手写
>      `Enter`/`Space` → `click()` 这类激活逻辑：会抢在 Base UI 前面，而浮动层触发器是 toggle 语义
>      → **重复派发 = 净无操作**，键盘直接废掉。非 `<button>` 的 render 目标记得 `nativeButton={false}`。
>    - **`data-side` / `data-align` 不只挂在 Positioner 上，Popup 上也有**（官方 data-attribute 表不完整）——
>      registry 写在 Popup 上的 `data-[side=…]` 动画类是有效的，不要去"修"它。
>
> **本仓相对 registry 的偏差清单**（重新 `--overwrite` 后要重做；除图标外这些都是有意为之，不是漏改）：
>
> | 文件                              | 偏差                                                                        | 为什么                                                                                                                                                                                                                                                     |
> | --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | `src/components/dialog.tsx`       | 外壳 `overflow-hidden` + 内层 `dialog-body` 滚动；`max-h-[min(85vh,40rem)]` | 长表单限高；滚动与圆角分层，避免滚动条画出圆角外                                                                                                                                                                     |
> | `src/components/form.tsx`         | 手写：`Slot` → `useRender`，`LabelPrimitive` 类型 → 本包 `Label`            | **`form` 在 shadcn 的所有 base 里都不存在** —— `/r/styles/{base-nova,radix-nova}/form.json` 都是空壳（只有 `{name, type}`，没有 `files`），两侧 registry 都没有 `form.tsx`，`shadcn add form` 静默 `No changes.`。所以这个文件**永远归本仓所有**，只能手改 |
> | `src/components/toggle-group.tsx` | `style={{ "--gap": spacing } as React.CSSProperties & { "--gap": number }}` | registry 原文在本仓 `@types/react` 下过不了类型检查                                                                                                                                                                                                        |
> | `src/lib/surface.ts`              | 本仓新增：`FIELD_SHELL` / `OVERLAY_SHELL`                                   | Input / SelectTrigger 与 Select·Menu·Popover 浮层共用企业级壳；registry 无此共享层                                                                                                                                                                         |
> | `src/components/input.tsx`        | `INPUT_SHELL` 基于 `FIELD_SHELL`（`bg-background` + 统一 focus）            | 与 SelectTrigger 对齐，避免表单并排时 Input/Select 深浅不一                                                                                                                                                                                                |
> | `src/components/select.tsx`       | Trigger 走 `FIELD_SHELL`（h-9 / sm=h-8）；Item 用 `data-highlighted`；Content 走 `OVERLAY_SHELL` | Base UI 高亮属性是 `data-highlighted` 不是 `focus:`；浮层需 border+shadow-lg 才能在浅色同底上分层；focus 环对齐到全局 `ring-1`                                                                                                                          |
> | `src/components/dropdown-menu.tsx`| Content 走 `OVERLAY_SHELL`；Item/Checkbox/Radio 用 `data-highlighted`       | 与 Select 同一套 elevation / 高亮语义                                                                                                                                                                                                                      |
> | `src/components/popover.tsx`      | Content 走 `OVERLAY_SHELL`                                                  | 与 Select/Menu 浮层 elevation 一致                                                                                                                                                                                                                         |
> | `src/styles/globals.css`          | 浅色 `--border` / `--input` 略加深（约 oklch 0.88）                         | 白底上默认 0.925 边框对比过弱，企业级可读性不够；不引入组件私有 hex                                                                                                                                                                                         |
>
> ⚠️ 偏差越少越好：能靠调用点解决的（改 prop、改 class）就不要改本包组件 —— 改一处就少追一次上游。
>
> 装完检查 `package.json`：CLI 会按 registry / preset 声明补依赖（preset 尤其会带上
> `next-themes`、`lucide-react`、`@fontsource-variable/*`），需收敛到 `catalog:` 并删掉本包用不到的
> （例如 `form` 条目带来的 `@hookform/resolvers`、`zod`）。

`src/assistant/**` 是上游原样代码（已用 eslint override 放宽 `== null` / 空 catch / ref 读取），
不逐次改写——否则每次重新 add 都要重做一遍。

**例外：`thread.aui.tsx` 已按产品需要改造过**，重新 `registry:add` 覆盖后要重做这几处
（这几条也在文件里有对应注释）：

1. `ThreadComponents` 的扩展槽：`AssistantMessage` / `Welcome` / `ToolFallback` / `ToolGroup` /
   `ReasoningGroup` / `ProcessGroup` / `Composer*`；文案一律走 `labels`，组件里不写死字符串。
2. **助手消息排版 = [过程折叠区][最终回答]**：`AssistantMessage` 不再用上游的
   `MessagePrimitive.GroupedParts`，而是自己算 `findResponseStart`（最终回答的起点）、把
   之前的一切按原时序装进 `ProcessGroup`，最终回答留在外面常驻可见。叶子 part 仍走
   `MessagePrimitive.PartByIndex`，注册过的工具 / data UI 由库优先接管。
3. `ReasoningRoot` 包了一层滚动锁（见 `reasoning.aui.tsx`），`ReasoningTrigger` 多一个
   `label` 覆盖。
4. 会话列表按工作区分组、`ThreadListSearch` 等改造在 `thread-list.aui.tsx`。

- 不执行 `shadcn eject`：保持 `shadcn/tailwind.css` 跟随上游更新。
- 商店/打包注意：本包只产出标准 React + 静态 CSS，无 `eval`，满足 MV3 CSP。

## 环境无关性

本包**不得**依赖 Node、Electron、`chrome.*`。需要这些能力时，通过端口接口由各 app 注入（见 `packages/chat`）。
