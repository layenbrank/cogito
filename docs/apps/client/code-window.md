# 代码窗口（Code Workbench）

磁贴组件 `code` 打开独立窗口，路由 `/code`。对齐 VS Code / Cursor / Qoder **Editor** 壳层，**不含** AI 侧栏（AI 在 Agent 窗）。

## 布局

```
ShellFrame（窗口壳常驻）+ useShellSurface（本页申报槽）
├─ Caption.begin：窗口标题
├─ Caption.center：命令中心 / 搜索胶囊（Ctrl+P，三列网格真居中）
├─ Caption.final：布局控制（侧栏 Ctrl+B、底栏 Ctrl+`）+ 命令面板
├─ children（内容区 = workbench）
│  └─ Activity Bar │ Sidebar │ Tabs + Breadcrumbs + Monaco │ Panel
└─ section：状态栏
```

职责：

- **ShellFrame / 槽**：窗口级（标题、布局展开/收起、命令入口、状态）
- **内容区**：编辑工作台（活动栏切视图、文件树、编辑器、终端面板本体）
- **编辑器设置**：标题栏齿轮打开**独立标签页**（`cogito://code/settings`），不再是浮层弹框；改完即写回 `tiles.json`，没有「应用」按钮

## 竞品对照

| 区域            | VS Code / Cursor / Qoder Editor | 本窗                          |
| --------------- | ------------------------------- | ----------------------------- |
| Activity Bar    | 切视图                          | Explorer / Search / SCM(占位) |
| Sidebar         | 主侧栏                          | 可折叠                        |
| Editor Tabs     | 多文档                          | 单 group 多 tab               |
| Panel           | Terminal / Problems             | 复用 `features/terminal`      |
| Command Palette | Ctrl+Shift+P / Ctrl+P           | Dialog 命令/文件面板          |
| AI 侧栏         | Cursor / Qoder 强调             | **不做** → Agent 窗           |

## 工作区

启动时**不**默认打开 Documents；侧栏为空，需 Ctrl+O /「打开文件夹」选择根目录。

## 快捷键

| 快捷键           | 作用                                                    |
| ---------------- | ------------------------------------------------------- |
| Ctrl/Cmd+Shift+P | 命令面板                                                |
| Ctrl/Cmd+P       | 转到文件                                                |
| Ctrl/Cmd+S       | 保存                                                    |
| Ctrl/Cmd+W       | 关闭标签                                                |
| Ctrl/Cmd+O       | 打开文件夹                                              |
| Ctrl/Cmd+B       | 展开/收起主侧栏（标题栏布局按钮 / Activity 再点当前项） |
| Ctrl/Cmd+`       | 切换终端                                                |

## 关键路径

- 视图：`apps/client/src/views/code/`
- 状态：`apps/client/src/stores/code.ts`
- 终端：`apps/client/src/features/terminal/`（与 Agent 共用）
- 编辑器设置：`apps/client/src/views/code/workspace/settings-surface.tsx`（标签页本体）、`caption/settings-button.tsx`（标题栏入口）

## 资源管理器渲染（大目录不再卡死）

历史现象：展开 `node_modules` 这类上千子项的目录会冻结 UI。根因**不是**磁盘 IO（Rust 侧早已 `spawn_blocking`），而是「一次性把整层子项铺成 DOM」再被三处放大器重做：树节点身份抖动（整树 spread 击穿 memo）、`expandedKeys` 换引用导致全行重渲、每层 220ms 高度过渡；叠加递归 watch 覆盖 `node_modules` 造成的刷新扇出。

现在的三层结构（可独立回滚）：

| 层   | 落点                                                                                                                                  | 作用                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 加固 | `views/workspace/overlay/file-tree.ts` 结构共享、`file-tree-item.tsx` memo 只比自身展开态、`CollapsibleContent` 的 `disableAnimation` | 刷新只克隆 root→target 路径；折叠真的发生时只丢该子树                                                  |
| 封顶 | `views/code/lib/paging.ts`（`EXPLORER_PAGE_SIZE = 200`）、`file-tree.ts` 的 `scheduleChunkedChildren`（每帧 50）                      | 首屏 200 条，其余点「显示更多」续读，避免一次铺死                                                      |
| 根治 | `views/code/workspace/overlay/explorer-rows.ts` + `explorer-flat-list.tsx`                                                            | 可见行压成一维数组，固定行高 `EXPLORER_ROW_HEIGHT = 28` + 上下 spacer 窗口渲染，DOM 只保留视口内几十行 |

取舍与约束：

- **不引入** `@tanstack/react-virtual`：行等高（`h-7` + `truncate`），手写窗口化足够，避免为树再加依赖。
- 树**不做**高度过渡动画（保留 chevron 旋转），对齐 VS Code；`Collapsible` 其他使用方不受影响。
- `node_modules` **保持可见**（只封顶 + 虚拟化，不做 `files.exclude`），搜索排除由后端 `SKIP_DIRS` 负责。
- 折叠即失效：折叠时丢弃该目录 children 缓存与子孙展开态，避免「已展开但无子节点」的脏 key；代价是反复折叠/展开会重读盘。
- 文件变更监听已从 `plugin-fs` 递归 watch 换到 Rust `workspaceFiles:watch`（`notify` + 300ms 合批 + 就地丢弃 `node_modules`/`.git`/`.pnpm`/`dist`），只回受影响的相对目录（上限 8，超出则整树刷新）。

观测口径：DEV 下 `window.__cogitoPerf`（长任务，阈值 120ms）与 `window.__cogitoExplorer`（每目录读盘/首帧耗时）。手工验收断言 `document.querySelectorAll('[data-tree-key]').length <= 80`。

## TypeScript 智能提示的 `@types` 注入

`views/code/lib/monaco-types.ts` 会把工作区 `node_modules/@types` 打进 Monaco 的 extraLibs。整包注入一次是几 MB 的 IPC + 主线程解析，属于「打开文件卡一下」的来源，因此改为**按需 + 分块 + 可关**：

- 三档 `tsTypesMode`（持久化在 `tiles.json` 的 `code` 段，侧栏头部 `lucide:braces` 循环切换）：
  - `lean`（默认）：只有 `hasTypescriptConsumer()` 为真、且「tsconfig 的 `compilerOptions.types` 含 `node` 或任一模型文本出现 `node:`」时才注入；
  - `full`：总是注入；
  - `off`：不注入，并清空已注入的 extraLibs。
- 分块：`packTypes` 每次 IPC 64 个文件，块与块之间 `runWhenIdle` 让出主线程；后端 `PACK_TYPES_MAX_CHUNK = 128`、总量上限 2MB、单文件 256KB。
- **已知取舍**：选 `off`（或 `lean` 判不出 node 需求）后，代码里的 `node:fs` / `process` 会按预期报 `Cannot find module` / 类型错误。这是有意的代价 —— 需要时在侧栏把档位切到 `full` 即可恢复，不必重启窗口。
- 不删除 `@types` 注入能力：它是 `node:` 与 Node 全局变量类型提示的唯一来源。

## Monaco 入口与贡献

`editor.api` 只有内核 API（不含任何 `editor/contrib/*`），为了首屏体积一直没换回 `editor.main`
（那个会连带 ~60 种 basic-language 与 `monaco-lsp-client`）。编辑器特性集中在
`lib/monaco-contribs.ts`，按三层静态引入，且**必须早于 `editor.create` 与首个同名语言的 model**
—— monaco 的贡献注册、rich language features、tokenizer 工厂都是一次性的：

- 基础编辑：`coreCommands` / clipboard / contextmenu / comment / folding / bracketMatching / multicursor…
- 智能特性：suggest / hover / codeAction / rename / parameterHints / semanticTokens / stickyScroll / peek…
- 语言服务：TS / JSON 的 `monaco.contribution`（CSS / HTML 与各语言语法在 `monaco-language.ts` 按需加载）

浮层（补全、悬停、参数提示、查找框、快速输入、右键菜单、peek）的视觉统一在
`views/code/styles/monaco-widgets.css`：monaco 0.57 用的是 `--vscode-cornerRadius-*` /
`--vscode-shadow-*` 这组「workbench 变量」，standalone 下没有定义（圆角/阴影会整条失效），
文件头把它们桥到 `--radius` 与 design `OVERLAY_ELEVATION` 的阴影数值上；其余面 / 字 / 行高
按 `@cogito/design` token 覆盖。

改不动的四处（都是 monaco 自己的约束，不是没调好）：

- **两个「命令面板」不是同一个东西**。应用自己的 Ctrl+P / Ctrl+Shift+P 走的是
  `workspace/command-palette.tsx` 的 design `Dialog`（搜索胶囊同源），34px 行 / 7px 圆角 /
  `primary 9% + muted`；而**编辑器右键菜单里的 `Command Palette`（F1）是 monaco 自己的
  quick input**（`editor.action.quickCommand` → `.quick-input-widget`），两处要分别改。
- **quick input 的外壳样式写在元素上**：`quickInput.js` 给 `.quick-input-widget` 拼了内联
  `background-color / color / border`（值来自 `--vscode-quickInput-*` 一类主题变量），普通声明
  压不住，必须 `!important`；而且它的样式表**首次打开时才注入 `<head>`**，晚于
  `monaco-widgets.css`，所以选择器写成 `.quick-input-widget.quick-input-widget` 抬一档权重，
  否则同权重时被后写的 monaco 规则盖掉。
- **quick input 的行高是 JS 算的**：`QuickInputList.getHeight()` 返回 22（带 detail 时 44），
  滚动偏移与命中区都按它算 —— 行高别动，能改的只有内边距 / 行圆角 / 交互态。
- **查找框也是「晚注入样式表 + 内联样式」**：`findWidget.css` 跟着 find 贡献所在的分块注入 `<head>`，
  比 `monaco-widgets.css` 晚 —— 所以这里的选择器统一写成 `.monaco-editor .find-widget.find-widget`
  （`findOptionsWidget` 同理）把权重抬一档；只写 `.monaco-editor .find-widget` 时，原生的 34px 高 /
  `padding: 0 4px 0 9px` / `editorWidget.background` 会整条赢回来。输入件与 Aa / ab / .* 的
  底色 / 描边 / 文字色是 `InputBox.applyStyles()` / `Toggle.applyStyles()` 写进元素的内联样式，
  只有 `!important` 能改（主题键 `input.*` / `inputOption.*` 是全局的，不能为这一处单独改）。
  高度也是 JS 算的（单行 33px、替换态 62px），纵向 `padding` / `margin` 一律不能动，否则 25px
  输入框会被裁切；能调的只有横向留白、圆角与交互态。

## 与 Agent 窗边界

- **代码窗**：编辑、文件系统、终端、问题列表
- **Agent 窗**：对话、任务、审批、工具卡；可另开终端面板
