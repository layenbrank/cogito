# 对话输入区 / 右栏：知识库 · 技能 · 扩展（2026-11-06）

一条原则：**输入框旁边只放「边写边要做的事」，翻找类的都归右栏。**
2026-11-06 按这条原则重整了两处：拆掉输入区的 `+` 面板、右栏补三个页签。

## 输入区左下角（`composer-actions.tsx`）

| 位置 | 组件 | 作用 |
| --- | --- | --- |
| 1 | `composer-knowledge.tsx` | **知识库**：列库 → 列文档 → 点一下把文档引用进本轮对话 |
| 2 | `composer-clip.tsx` | 回形针：附件 / 图片 |
| 3 | `approval-switch.tsx` | 审批档位 |
| 4 | `mode-switch.tsx` | 执行 / 计划 / 问答 / 目标 |

原来的 `+`（`composer-context-menu.tsx`，双栏 AttachMenu：工作区 / 扩展 / 技能）**已删除**：
工作区文件在右栏「文件」、技能在右栏「技能」、MCP 插件列表搬到了右栏「扩展」，
唯一还留在输入区的是「知识库」—— 引用完继续写这件事，右栏做不到。

## 右栏页签（`aside.tsx`）

| 页签 | 组件 | 数据来源 | 点一下做什么 |
| --- | --- | --- | --- |
| 详情 | `aside-busy.tsx` / `aside-empty.tsx` | 会话状态 | — |

| 计划 | `aside-plan.tsx` | `features/agent/plan-*` | 确认执行 |
| **任务** | `aside-tasks.tsx`（复用 `views/agent/tasks/{model,task-form,task-runs,schedule-field}`） | `useAutomationStore`（本机 / goose / 云端三源） | 卡片管理、新建、看执行记录 |
| 文件 | `aside-files.tsx` | `workspaceFiles:*` + `useActiveWorkspace` | 预览 / 引用 / 审阅 |
| **知识库** | `aside-knowledge.tsx` → `knowledge-browser.tsx` | `knowledge:listBases` / `knowledge:listDocs` | 引用文档 |
| **技能** | `aside-skills.tsx` | `workspaceSkills:list` | 引用 `SKILL.md` |
| 审阅 | `aside-review.tsx` | `workspaceGit:*` | 逐块采纳 / 丢弃 |
| 历史 | `aside-history.tsx` | `workspaceGit:*` | 看提交与改动 |
| 浏览器 | `aside-browser.tsx` | 内嵌 webview | 给 agent 读/操作 |
| **扩展** | `aside-extensions.tsx` → `extensions-pane.tsx` | `config/extensions` + `session/extensions` | 就近开关 MCP / 内置扩展 |
| 终端 | `features/terminal` | PTY | 常驻 shell |

加粗的行是两轮新增的：知识库 / 技能 / 扩展（2026-11-06）与任务（2026-11-08）。
「任务」不再占独立页面（原 `/agent/tasks` 只留重定向到 `/agent/chat`），卡片列表 / 详情 / 执行记录 / 新建表单
全在这块面板里切；打开入口统一走 `agent:open-aside-tasks` 事件（命令面板 `AGENT_OPEN_TASKS`、左栏「任务」按钮同一条）。
`tasks` 与 `browser` / `terminal` 一样在 `EMBEDDED_HIDDEN_TABS` 里，嵌套壳不显示。
输入区的 popover 与右栏页签是**同一份实现**，只是宿主不同（`active` 控制何时去读 IPC）。

## 口径：技能按「工作区多文件夹」识别

技能不是只看「当前文件夹」的那一个：

```ts
// aside-skills.tsx / composer-triggers.tsx（`/` 触发器）
const { folderPaths, primaryRootPath } = useActiveWorkspace()
const rows = await WorkspaceSkills.fetchSkills([...folderPaths])   // 每个文件夹都扫一遍
const reference = toAgentPath(skill.path, primaryRootPath)         // 引用路径按会话 cwd 折算
```

- `folderPaths` 是工作区**全部**文件夹（`api/`、`docs/`…），不是 `rootPath`（当前选中的那个）。
- 会话 cwd 只等于**主文件夹**，所以非主文件夹里的技能必须给绝对路径 —— `toAgentPath` 负责折算
  （`features/agent/workspace/paths.ts`）。少了这一步，agent 会拿 `docs/.claude/skills/x/SKILL.md`
  去主文件夹里找，必然找不到。
- 多文件夹时列表右侧标出技能所属文件夹名，同名技能能分得清。
- 同一口径也用在下拉里：`@` 是「多根搜文件」、`/` 是「多根取技能」，两者都按 `folderPaths`。

## 口径：知识库文档 = 磁盘上的 Markdown

知识库文档不是另一种实体，就是 `<库根>/<relPath>` 上的一个文件：

```ts
const reference = toAgentPath(joinWorkspacePath(base.rootPath, doc.relPath), primaryRootPath)
await attachWorkspaceFile(aui, reference)   // 与文件树、@ 的同一条引用通道
```

库根通常**不在**工作区内，此时 `toAgentPath` 原样给绝对路径，agent 照样能读。
好处是不必给知识库另造一条「上下文注入」通道：引用语义、附件展示、持久化全部复用现成的。

## 与队列的关系

「插队 / 上下调序」失效的根因与修法（`steer` / `queue` 两条 lane + 扁平 `composer.queue`）见
[assistant-ui-elements.md](./assistant-ui-elements.md) 的「『插队 / 调整顺序』为什么曾经完全失效」。

## 右栏·知识库面板：预览 / 编辑也在这里（2026-11-07）

列表只解决「找得到」；点开一篇进入 `knowledge-doc-pane.tsx`：

- **预览**：`MarkdownContent` 渲染正文；front matter 不显示；相对图片按文档目录换成 asset 协议（`rewriteMarkdownAssetSrc`，代码块里的示例不误改）。
- **编辑**：窄栏里用 Markdown 源文 textarea（不引 tiptap / Monaco —— 整窗编辑器与散文换行各有取舍），Ctrl/Cmd+S 或保存按钮 → `knowledge:writeDoc`，服务端写盘 + 落库。
- **冲突**：打开时 `knowledge:resolveDoc` 取 hash，保存带回；库内期间被改过（`conflict=true`）先问「保留我的（force 覆盖）/ 重新载入」，不静默覆盖。
- **新建 / 删除 / 重扫**：`writeDoc(force)` / `removeDoc` / `rescanBase`。新建落 `wiki/<slug>.md`，同名顺延 `-2`、`-3`；删除会连磁盘文件一起删（有确认框）。
- **离开**：返回时脏内容先问「保存 / 丢弃 / 取消」；popover 被外部收起这类**非主动离开**才提示「未保存的修改已丢弃」。

## 上下文：气泡给概览，右栏给明细（2026-11-09）

- 气泡（composer footer「上下文」）只保留：总量 + 一条色条 + 四行来源（系统提示词 / 对话消息 / 工具 / 附件）+「查看详情」。
  Top N、输入 / 输出 / 推理 / 缓存这些一铺开就会盖住半个对话，因此不再放进气泡。
- 明细是「详情」页签里的一张卡（`aside-context.tsx`，不单独占页签）：窗口占用与剩余、四段分布（带比例条）、
  最占上下文 Top 5（点一行滚到那条消息）；系统提示词只计入估算，不向用户展示原文。
- 两边数字来自同一个快照 `use-context-usage.ts`（分段估算 + `goose-usage` 会话统计），气泡与面板不会各算一套。
- 卡片样式统一走 `aside-section.tsx`：详情面板与上下文面板用同一套圆角 / 字号 / 内边距。
- 入口：气泡「查看详情」→ `openAsideContext()` 事件；`chat.tsx` 展开右栏、`aside.tsx` 切到「详情」，卡片自己展开并滚到位。

## 详情·来源：「引用 / 附件 / 读取」三路合并（2026-11-09）

- 此前「来源」只读 `composer.attachments`，而 `@` 引用工作区文件走的是文本里的 chip（线格式 `@path`），
  附件行只放 Ctrl+V 粘贴的文件和图片 —— 卡片于是永远是空的。
- 取数收进 `apps/client/src/features/agent/sources.ts`，三路合并：
  ① 引用：用户消息正文里的 `@path` / `@browser-<uuid>` / `@skill:<名>`（复用 design 的 `parseDocument`，
  与 composer 同一套判定，`@media` 这类装饰写法不算）；② 附件：composer 附件行 + 消息里的 file / image part；
  ③ 读取：本轮 read / view 类工具真正读过的文件（`text_editor` 只有 `command=view` 算，写 / 改不进来源）。
- 去重键是路径 / label，优先级 `引用 > 附件 > 读取`，最多 12 条；卡片按 引用 / 附件 / 读取 分组。
- 交互：文件行开右栏文件树，`browser-<uuid>` 行开右栏浏览器（展示名回查 `useBrowserStore` 换成标签页标题），
  技能行只展示不可点。
- 列表跟随 `useStructuralThreadMessages`：按结构订阅，流式正文增长不会让整块详情面板重渲染。

## 右栏·文件页签改成文件树 + Ctrl/Cmd+F 的归属（2026-11-09）

- 文件页签不再是「一层层往里点的扁平列表」（点目录=进去、要一路再点回来）：改用**可展开的文件树**，
  复用代码窗资源管理器那套 `views/workspace/overlay/file-tree*.tsx`（折叠动画、图标、缩进、加载骨架同一份），
  树本身在 `aside-files-tree.tsx`：目录展开才读盘（`WorkspaceFiles.listDir`），`revision` 变化只重读
  「根 + 已展开目录」，展开态与当前文件都保留；换根（多文件夹工作区）才清展开态。
- 行上仍挂 `data-aside-path` / `data-aside-kind`（`FileTreeItem` / `FileRow` 的 `emitAsidePath`），
  右栏右键菜单（添加到对话 / 复制路径）行为不变；搜索框常驻树顶，输入即切到封顶的扁平命中列表，清空回到树。
- 从工具卡 / 来源打开文件（`initialRelative`）时，先把**祖先目录**展开并读出来，再高亮 + 滚到那一行 ——
  否则树里根本没有这一行。
- Ctrl/Cmd+F 的归属：焦点在右栏里时这一键属于右栏（聚焦文件树搜索框），不再冒到 chat 的 `AGENT_FIND`
  去打开「搜索整个会话」。实现是 `aside.tsx` 用 `useShortcut(COMMAND.AGENT_FIND, …)` 在处理器链前接管
  （优先级 0 > 命令自身兜底的 -1），判定只看 DOM：`aside-find.ts` 用 `[data-agent-aside]`（右栏根）
  + `[data-aside-find]`（搜索框）。焦点不在右栏时返回 `false`，会话搜索照旧；右栏里没有搜索框的页签
  （审阅 / 历史 / 计划…）只是吞掉这一键 —— WebView 原生 find bar 仍由派发器 `preventDefault` 拦住。
- 文本预览打开时文件树是 `hidden` 的，搜索框量不到布局，这一键改交给**编辑器自己的查找框**：派发器
  已 `preventDefault`，Monaco 的 keybinding 拿不到这个按键，所以由右栏显式转交 ——
  `aside-editor-find.ts` 登记编辑器实例（`use-aside-files-editor` 挂载/销毁时登记/清空），
  焦点命中 `isAsideEditorFocus` 时跑一次 `actions.find`。否则就是「谁都没反应」：会话搜索被右栏
  收掉，编辑器的查找又没被触发。
- 真正的坑在 Monaco 侧：`lib/monaco-loader.ts` 从 `monaco-editor/editor/editor.api` 起包，那是**内核
  API，一个 contrib 都不含** —— `actions.find` 从来没注册，查找框根本不存在，于是「转交」也无处可转
  （`getAction('actions.find')` 返回 `null`，现象就是按了没反应）。现在按需补上
  `editor/contrib/find/browser/findController` 与 `editor/contrib/format/browser/formatActions`
  （预览顶栏的「格式化」/ `Shift+Alt+F` 同样依赖后者），没换成 `editor.main` —— 那个会顺带拉全部语言
  注册与 lsp client。
- 同类隐患（本次没动）：`suggest` / `hover` / `folding` / `contextmenu` / `bracketMatching` 也都是
  contrib，`EDITOR_OPTIONS` 里相应的开关目前是空转；要用就按上面的方式逐个补。

## 右栏·任务面板：列表与详情统一到「详情」页签的语言（2026-11-09）

- 此前「任务」面板整套写在 `views/agent/tasks/tasks.module.scss` 里：11px 正文、8–10px 圆角、
  自写 badge —— 和「详情」页签（`aside-busy` + `aside-section`：14px 标题 / 13px 正文 /
  12px 元信息、`rounded-xl border-border/60 bg-card`）并排放着像两个人做的。
- 现在列表卡与详情分区都走 Tailwind + 设计 token：
  - **列表**：按执行方分组的**网格卡片**，容器 `repeat(auto-fill, minmax(12rem, 1fr))`——默认
    340px 右栏 1 列，拖宽后 2–4 列（12rem 是实测「每周一 10:00 + 目标 · 6 轮」能挤进一行的
    下限，再窄就只剩豆腐块）。卡面整块是一个按钮（`article` + 内层 `button`）：
    名称两行截断 + 状态胶囊，下面三行元信息（排期 + 模式小标签 / 下次触发 / 上次执行，
    截断时用 `title` 兜底）。失败时多一行 `lastError`：`circle-alert` 图标 + `truncate`，
    只占一行 —— 错误长短不一会把整行卡片撑高（实测两行错误让同排卡片多出 40px 空白），
    完整错误留给详情看。卡底动作条 `mt-auto` 钉在底边：
    开关 + 带文字的「立即执行」（跑起来变 spinner + 阶段文案）+ 更多菜单（编辑 / 查看记录 /
    删除）。网格让同一行的动作条对齐、卡片等高，扫一眼就能比「谁快到期、谁上次挂了」。
    比例上按「卡片是行、不是砖」来定：内边距 8/6px、行距 6px，316px 宽时卡高约 138px
    （≈2.3:1，和旁边 `AsideSection` 的观感一档）；拖到三列时卡约 220×161（≈1.4:1），
    高度由内容决定、不靠 `aspect-ratio` 硬撑 —— 卡片内容不变，比例随宽度自然变化即可，
    只要同一行高度一致（错误行只占一行、标题最多两行）就不会出现「半张卡是空白」。
    分组标题同排显示本组条数；
  - **详情**：抬头两行（任务名 / 状态胶囊 + 执行方 · 排期 · 模式），正文四张 `AsideSection`：
    指令 / 排期 / 执行 / 执行记录，层次靠卡片而不是分割线；
  - **分组标题**带执行方图标（本机 / goose / 服务端），右上说明仍是「关掉应用就不跑」这类口径。
- 状态胶囊收进 `tasks/task-status-pill.tsx`，任务卡 / 详情抬头 / 执行记录共用一套 tone，
  与 `aside-plan` 的 `STATUS_META` 同色阶（primary / success / destructive / muted）。
- 执行记录（`task-runs.tsx`）同步改成 12px 分段筛选 + 描边行卡：筛选在 232px 下横向滚动
  （隐藏滚动条），行内动作整体换行，不会把「展开输出」拆成两行。
- `tasks.module.scss` 只剩表单（新建 / 编辑 + 可视化排期），标签与提示提到 12px；
  列表 / 详情 / 记录那批类名全删，避免两套字号并存。

## 任务执行目录 = 工作区 + 工作区下的目录（2026-11-09）

- 症状：任务表单里只有一个「工作目录」下拉，选项是**工作区**。可一个工作区可以挂多个文件夹，
  真正执行时 `acp/session.ts` 的 `findWorkspaceCwd` 把该工作区的全部文件夹丢给
  `pickWorkspaceCwd`，取「第一个真实存在的」—— 于是执行目录被隐式锁死在某个文件夹上，
  用户无法指定「我要在工作区的 `docs` 而不是 `api` 里跑」。
- 数据模型：`automation` 表新增 `workspacePath`（文件夹绝对路径，NULL = 跟随工作区默认目录）。
  老库由 `migrations/automation_schema.rs` 的 `column_patches()` 幂等补列（`pragma_table_info`
  判缺再 ALTER），新库走 0001 基线 DDL。
- 表单拆成两个下拉：**工作区**（不指定 / 某工作区，多目录时标「N 个目录」）+ **目录**
  （跟随工作区默认目录 / 工作区下的具体路径，未选工作区时禁用）。切工作区或切目录都会清空已绑定的
  计划文件路径 —— 旧路径挂到新根上必错。
- 校验三层同一条口径「指定目录必须先选工作区」：`TaskDraft` 的 `findDraftProblem`、
  `AutomationSaveSchema`、Rust `Service::toSave`（`指定目录时必须先选工作区`）。
- 执行侧：`runner.requireWorkspace(workspaceId, workspacePath, approval)` 返回的绝对路径既用来读
  绑定计划，也作为 `runThreadPrompt({ cwd })` 传给 `ensureThreadSession` —— 显式目录**优先于**
  工作区默认目录；会话缓存比对的是 `cwd`，改目录会重建 ACP session（旧的 cwd 不会沿用）。
  显式目录不存在时直接抛「任务指定的目录已不存在：<path>」，不静默退回第一个目录。
- 详情页「工作目录」显示 `工作区标题 · 目录路径`，跟着这次选的目录走，不再是「工作区 + 猜出来的路径」。

## 右栏·预览按类型分流：图片 / 音视频 / 二进制（2026-11-09）

- 以前点开任何文件都交给 Monaco（`readCodeFile`），而它对二进制扩展名、以及含 `\0` 的内容直接抛
  「这是二进制文件，无法在编辑器中打开」—— 图片、pdf、压缩包点进去只有一行报错，等于没有预览。
- 分流是纯函数 `aside-files-preview-kind.ts`（带单测）：`image` / `audio` / `video` 走 asset 协议
  （`convertFileSrc`，`tauri.conf.json` 的 `assetProtocol.scope` 已开到 `**`），`binary` 只给
  「用默认应用打开」（`openPath`），其余仍按 `text` 进 Monaco。`svg` 刻意算文本 —— 能编辑。
- 预览拆成三个组件（`AsideTextPreview` / `AsideMediaPreview` / `AsideBinaryPreview`），共用
  `PreviewShell` 顶栏：Monaco 只在文本预览里挂载，看图片不会白建一个编辑器；媒体预览没有
  保存 / 格式化按钮，二进制预览多一个「用默认应用打开」。
- `use-aside-files-preview` 对非文本类型直接跳过读盘（不再先报一次「无法打开」再空着）。
- 透明背景：棋盘格挂在 `<img>` 自己的背景上（`CHECKER_STYLE`，`repeating-conic-gradient` +
  `color-mix(in oklab, var(--foreground) 12%, var(--background))`，16px 一格），只有真有透明像素
  的地方才露出来 —— 不透明图片整片盖住它，四周也不会把留白误标成「透明」。两格都由设计 token
  现算（`--background` 白 / 近黑，`--foreground` 近黑 / 近白），亮暗两套主题自动成立，不用写两份
  颜色；12% 是目视调出来的（8% 在亮色下太淡、16% 在暗色下太吵）。另配 `ring-1 ring-border`，让
  不透明图片也有边界。