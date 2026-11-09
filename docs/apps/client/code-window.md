# 代码窗口（Code Workbench）

磁贴组件 `code` 打开独立窗口，路由 `/code`。对齐 VS Code / Cursor / Qoder **Editor** 壳层，**不含** AI 侧栏（AI 在 Agent 窗）。

## 布局

```
ShellFrame（窗口壳常驻）+ useShellSurface（本页申报槽）
├─ Caption.begin：标题 + 命令中心（Ctrl+P）
├─ Caption.final：布局控制（侧栏 Ctrl+B、底栏 Ctrl+`）+ 命令面板
├─ children（内容区 = workbench）
│  └─ Activity Bar │ Sidebar │ Tabs + Breadcrumbs + Monaco │ Panel
└─ section：状态栏
```

职责：
- **ShellFrame / 槽**：窗口级（标题、布局展开/收起、命令入口、状态）
- **内容区**：编辑工作台（活动栏切视图、文件树、编辑器、终端面板本体）


## 竞品对照

| 区域 | VS Code / Cursor / Qoder Editor | 本窗 |
|------|--------------------------------|------|
| Activity Bar | 切视图 | Explorer / Search / SCM(占位) |
| Sidebar | 主侧栏 | 可折叠 |
| Editor Tabs | 多文档 | 单 group 多 tab |
| Panel | Terminal / Problems | 复用 `features/terminal` |
| Command Palette | Ctrl+Shift+P / Ctrl+P | Dialog 命令/文件面板 |
| AI 侧栏 | Cursor / Qoder 强调 | **不做** → Agent 窗 |

## 工作区

启动时**不**默认打开 Documents；侧栏为空，需 Ctrl+O /「打开文件夹」选择根目录。

## 快捷键

| 快捷键 | 作用 |
|--------|------|
| Ctrl/Cmd+Shift+P | 命令面板 |
| Ctrl/Cmd+P | 转到文件 |
| Ctrl/Cmd+S | 保存 |
| Ctrl/Cmd+W | 关闭标签 |
| Ctrl/Cmd+O | 打开文件夹 |
| Ctrl/Cmd+B | 展开/收起主侧栏（标题栏布局按钮 / Activity 再点当前项） |
| Ctrl/Cmd+` | 切换终端 |

## 关键路径

- 视图：`apps/client/src/views/code/`
- 状态：`apps/client/src/stores/code.ts`
- 终端：`apps/client/src/features/terminal/`（与 Agent 共用）

## 资源管理器渲染（大目录不再卡死）

历史现象：展开 `node_modules` 这类上千子项的目录会冻结 UI。根因**不是**磁盘 IO（Rust 侧早已 `spawn_blocking`），而是「一次性把整层子项铺成 DOM」再被三处放大器重做：树节点身份抖动（整树 spread 击穿 memo）、`expandedKeys` 换引用导致全行重渲、每层 220ms 高度过渡；叠加递归 watch 覆盖 `node_modules` 造成的刷新扇出。

现在的三层结构（可独立回滚）：

| 层 | 落点 | 作用 |
|---|---|---|
| 加固 | `views/workspace/overlay/file-tree.ts` 结构共享、`file-tree-item.tsx` memo 只比自身展开态、`CollapsibleContent` 的 `disableAnimation` | 刷新只克隆 root→target 路径；折叠真的发生时只丢该子树 |
| 封顶 | `views/code/lib/paging.ts`（`EXPLORER_PAGE_SIZE = 200`）、`file-tree.ts` 的 `scheduleChunkedChildren`（每帧 50） | 首屏 200 条，其余点「显示更多」续读，避免一次铺死 |
| 根治 | `views/code/workspace/overlay/explorer-rows.ts` + `explorer-flat-list.tsx` | 可见行压成一维数组，固定行高 `EXPLORER_ROW_HEIGHT = 28` + 上下 spacer 窗口渲染，DOM 只保留视口内几十行 |

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

## 与 Agent 窗边界

- **代码窗**：编辑、文件系统、终端、问题列表
- **Agent 窗**：对话、任务、审批、工具卡；可另开终端面板
