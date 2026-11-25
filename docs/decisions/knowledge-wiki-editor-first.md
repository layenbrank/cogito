# 知识库：LLM Wiki 写入契约 + 编辑器优先布局（决策记录）

> 2026-11-24。落实两项需求：
> 1. agent 不按 LLM Wiki 规范写（落点、frontmatter、index 全不对）；
> 2. knowledge 视图从「知识库管理工具」改成「以文本编辑器为主体」。
>
> 每条决策给出**采用方案 / 备选 / 取舍理由**；实现位置与验证方式见
> `docs/apps/client/knowledge.md` 与 `docs/apps/client/knowledge-user-guide.md`。

## 决策一览

| # | 主题 | 采用 | 备选（未采用） |
| --- | --- | --- | --- |
| D1 | agent 写入时机 | 只写待发布区（staging），用户确认后发布 | A. 写即发布 + 规范化；B. 设置项可切 |
| D2 | 分章语义 | 每章 = 独立 wiki 页，按 type 落目录，`[[ ]]` 互链 | A. 分章后合并成一篇；B. 大纲时让用户二选一 |
| D3 | 页面主形态 | ~~保留可拖拽三栏~~ → 见 D26（两栏 + 抽屉） | A. 左侧树 + 居中编辑 + 右侧抽屉；C. 单文档全屏 + 命令面板 |
| D4 | 知识库功能入口 | 保留独立路由页，从标题栏「空间」菜单进入；左轨已删除 | A. 收进侧栏分组 + 抽屉；C. 命令面板统一入口 |
| D5 | type → 目录的源头 | Rust `knowledge::wiki::WIKI_TYPES` 唯一权威，前端镜像并用 `knowledge:wikiContract` 校对 | A. 共享 JSON 双端读取；B. TS 为源、Rust 镜像 |
| D6 | 默认 type | `note`（→ `wiki/notes/`），正式纳入规范枚举 | A. 缺 type 直接报错；B. 默认 `concept` |
| D7 | 同名页发布 | 视为**更新同一页**（保留 `created`，刷新 `updated`） | A. 自动加 `-2` 后缀；B. 拒绝覆盖，要求用户处理 |
| D8 | 多页合并顺序 | 按调用方传入（待发布区勾选顺序） | A. 按文件名（`01-` 前缀）；B. 按修改时间 |
| D9 | index 维护 | 收敛到 Rust `wiki_index`，**整份重建**；删除前端拼接实现 | A. 增量 append；B. ingestion 保留 TS 实现 |
| D10 | 存量归位 | 设置 → 维护，先 dry-run 报告再执行 | A. 启动时自动迁移；B. 不迁移，只靠 lint 报 |
| D11 | 归位命名 | 已在 `wiki/` 的页保留原文件名；库根页用标题 slug | A. 全部按标题重命名；B. 全部保留原名（含库根） |
| D12 | 编辑器顶部 | 删除独立模式工具条，并入「文档头」（标题 + 元信息 + 模式/专注/查找） | A. 保留两条 36px 横条；B. 工具栏移到底部（Typora 式） |
| D13 | 右栏宽度 | 用户拖过的宽度优先；否则 320px | A. 固定 28% 百分比；B. 固定 360px |
| D14 | 布局持久化 | 见 D28：只存侧栏像素宽度 `knowledge.sidebar-width` | A. 写进 `KnowledgeShell` 偏好；B. 不持久化 |
| D15 | 说明书注入缓存 | 不做缓存，每轮按当前库读 | A. 15s TTL；B. 按 baseID 缓存 |
| D16 | 草稿预览 | `marked` 渲染后去活（去 `<script>`/`<iframe>`/`on*=`） | A. 不渲染 HTML，只显示源码；B. 引入 sanitizer 库 |
| D17 | ingest 的 `wiki/<标题>.md` | 按 frontmatter type 重定向进 `wiki/<type>/` | A. 交给 lint 报 `type-dir-mismatch`；B. 直接拒绝根级路径 |
| D18 | 控件基线 | knowledge 内主操作 32px、图标 16px；格式条 40px；caption 32px | A. 改 `@cogito/design` 全局默认；B. 36/40px 大一号 |
| D19 | 发布反馈 | toast「已发布 N 页」，不自动跳转 | A. 发布后自动打开新页；B. 发布前 diff 审核 |
| D20 | 老偏好迁移 | `knowledgeLayoutVersion: 2`，旧数据一次性把右栏收起 | A. 不动老偏好（老用户看不到变化）；B. 不做版本，只改默认值 |
| D21 | 顺带修的红测试 | `automation/run-plan.test.ts` 改成「包含」断言（实现本来就会追加模式指引） | A. 不动（与本任务无关，但 `pnpm unit` 会一直红）；B. 改实现去掉模式指引（会改变定时任务行为） |
| D22 | 模板类型怎么办 | 把 `character/theme/plot-thread/chapter/meeting/decision/project/stakeholder` 纳入内置类型（共 15 种，目录固定） | A. 模板改回 7 类（破坏领域语义、存量库全成目录不符）；B. 任意自定义 type + `wiki/<type>s/`（typo 会静默造目录） |
| D23 | 技能副本 | `.cursor/skills/knowledge-wiki` 只留指针，权威在 `.agents/skills/knowledge-wiki` | A. 两份同步维护；B. 删掉 `.cursor` 版本（Cursor 扫不到） |
| D24 | 同名发布 | Replace 模式按「标题 + type」找既有页并沿用其路径；同一批里标题重复则强制加后缀 | A. 只按 slug 定位（旧页在自定义/旧目录时会裂成两份）；B. 标题变了就重命名文件（URL 变、外链易断） |
| D25 | 容器叫什么 | 界面统一叫**空间**（文案键在 `views/knowledge/locale.ts`） | A. 项目；B. 仓库（Obsidian vault）；C. 笔记本 |
| D26 | 布局形态（破坏性） | 两栏 `侧栏 \| 主区`，删除 48px 左轨与第三列；大纲/AI/研究改为**覆盖式抽屉**（宽 320，不参与分栏）→ **已被 D30 取代** | A. 保留三栏但右栏默认收起（上一版，仍挤压正文）；B. 左树 + 居中正文 + 右抽屉（内容与 D3 重复，仍有三列 DOM） |
| D27 | 新建空间的交互 | 弹窗：名称输入 + 模板卡片（单选、图标 + 说明）+ 「导入示例空间」次要按钮；主按钮「创建」 | A. 侧栏内联 Input + Select + 「建」按钮（旧版）；B. 命令面板输入名称 |
| D28 | 侧栏宽度持久化 | localStorage `knowledge.sidebar-width`（px，240–440），默认 300px | A. 百分比；B. 和知识库偏好在同一个 store |
| D29 | 代码词汇 | 全栈 `base` → `space`：表 `knowledge_space`、列 `spaceID`、实体 `KnowledgeSpace`、命令 `knowledge:listSpaces`、工具 `cogito_knowledge_list_spaces`、store `useKnowledgeSpaceStore` | A. 只改界面文案、代码继续叫 base（双轨）；B. 只改 TS（Rust/DB 留下旧词） |
| D30 | 最终布局 | **三栏分割**：`侧栏 \| 主区 \| 右栏`，右栏默认收起、可拖可折叠（320px，280–44%），不再用抽屉 | A. 两栏 + 覆盖抽屉（D26，被否决：盖住正文）；B. 全屏专注（另作「专注模式」保留） |
| D31 | 渲染预算 | 工具页**激活才挂载**；store 列表更新合并为单次 emit（`toLoadLists`）；三栏各组件 `memo`；击键只写一次（`toCommitEdit`）；shell 槽位 `useMemo` | A. 保持全量常驻 + 虚拟列表（改动更大）；B. 上 React Compiler（未落地） |

## 关键理由

### D1 staging-only
`write_doc` 直接 `publish(Replace)` 是「agent 不按规范写」的根因之一：模型拿到
`status=published`，就会在回复里说「已入库」，而页面可能落错地方、缺 frontmatter。
把发布权收回到用户手里后，提示词可以明确写「你只写草稿」，工具卡也显示「写入待发布区」，
错误在确认前就可见。代价是多一步点击，用批量发布/合并把成本压到最低。

### D2 一页一概念
LLM Wiki 的核心是「概念级页面 + 交叉引用」，不是「一篇长文」。旧的 `01-概述.md`
序号规则既与 `kebab-case` 命名冲突，也没人消费前缀（合并端按文件名排序后，发布又按标题重新命名）。
一页一概念可以直接用 type 落目录、用 `[[ ]]` 互链，lint 也能检查 type 与目录是否一致。

### D5 Rust 为源
写入/发布在 Rust，ingest 与模板在 TS；两边各维护一份 type 表迟早漂移（现状已经出现
`claim` 不在规范里、`note` 不在枚举里）。选 Rust 为源是因为**落盘与校验都在 Rust**，
前端镜像表只用于快速构造路径，并用 `knowledge:wikiContract` 在运行时校对。

### D7 同名=更新
自动加 `-2` 会让同一概念裂成多页，违背「一概念一页」。拒绝覆盖则每次微调都要用户手工删文件。
按 slug 定位同一页、更新内容并保留 `created`，是 wiki 的常规语义；要保留两版应该用「合并」或版本库。

补充（D24）：只按 slug 定位时，「旧页在自定义目录」的情况下同标题发布会另建一份新页。
发布前先按「标题 + type」找既有页并沿用其路径；同一次批量发布里若标题重复，后面的强制加后缀，
避免用户勾选的两页互相覆盖。

### D9 整份重建 index
增量 append 的问题：页面改名/归位/删除后旧条目留在 index，lint 又会报「未进 index」。
整份重建是 O(n) 但 n 是库内页数（本地文件系统，毫秒级），换来的是索引永远与磁盘一致。
前端旧的 `upsertIndexEntry`/`rebuildWikiIndex` 已删除，避免双轨。

### D12/D13 编辑器优先
右栏常驻 28% 时编辑区只剩约 50% 宽，加上两条 36px 横条，正文被压得像侧边栏附件。
把模式/专注/查找并进文档头、右栏默认收起，编辑区稳定 ≥65%；知识库管理界面仍在，
但从标题栏菜单进入，符合「知识库是额外功能」的定位。

### D15 不缓存说明书
缓存 15s 在同一次对话里省三次小文件读取，却会在用户切库后注入上一个库的 schema。
schema 是「规则」，注入错规则比多读几次文件严重得多。

### D25 容器叫「空间」
把「知识库」当主概念写进界面，等于告诉用户这是个 CMS：进来先找库、再找目录、最后才写字。
参考对象都是「容器名退到后排」的编辑器——Obsidian 的 vault 只在标题栏出现，Typora 干脆没有容器，
语雀的「知识库」是入口而不是主语。选「空间」而不是用户提的「项目」：本仓库里「项目」已经指代码项目
（`AGENTS.md` 的 project 约定、client 的 workspace），两个「项目」在同一窗口里会打起来；
「工作区」同理被代码工作区占用；「仓库」是 Obsidian 的语义，容易被当成 git 仓库。

### D26 两栏 + 抽屉
上一版仍是三栏：左 rail 48px + 左栏 + 主区 + 右栏，正文实际可用宽度被三段吃掉，
且 `knowledge.pane-layout` 的百分比缓存让比例越拖越怪。改成两栏后：

- 左轨整体删除，工具入口只在标题栏「空间」菜单（D4 的延伸）；
- 右栏改成 `absolute right-0` 的抽屉，编辑区宽度恒定，看大纲时不再重排正文；
- 专注模式只剩正文 + 标题栏，`SplitterHandle` 也一并隐藏。

补充（D30）：抽屉方案被用户否决——写长文时抽屉会盖住正在看的段落，
最终回到**三栏分割**：右栏是第三列，默认收起（偏好 `isOutlineOpen` 记忆），
拖到 0 即关闭，宽度按像素缓存（`knowledge.aside-width`）。

### D27 新建空间用弹窗
旧交互是侧栏里一行 `Input` + 一行 `Select` + 一个「建」字按钮，8px 级字号、视觉上是「小工具」；
但新建空间是低频高权重动作（决定整个模板/schema），值得一个正经弹窗：名称 + 模板卡片（能看懂每个模板是干什么的）。
入口统一收进 `useSurfaceStore.isNewSpaceOpen`，侧栏、空态、标题栏菜单都调同一个弹窗。

### D28 侧栏宽度只记像素
百分比在窗口大小变化时会漂（18% 在 1440 宽是 259px，在 2560 宽是 460px）。
侧栏是「文件树」，用户对绝对宽度有肌肉记忆，所以存 px 并夹在 240–440；
默认 300px——够放「标题 + 路径 · 字数 · 时间」两行。

### D29 代码词汇全栈收敛到 space
界面叫「空间」而代码叫 `KnowledgeBase` / `bases` / `baseId`，读代码时要在两套词之间翻译，
而且 agent 工具（`cogito_knowledge_list_bases`）向模型自报的也是旧词。既然这个词是产品主语，就一次改到底：

- DB：表 `knowledge_base` → `knowledge_space`，列 `baseID`/`knowledgeBaseID` → `spaceID`/`knowledgeSpaceID`，
  字典 `knowledge_base_scope` → `knowledge_space_scope`，索引同名跟进；
- Rust：实体 `KnowledgeSpace`、`Service::find_space` / `toListSpaces` / `toEnsureDefaultSpace`、
  命令 `knowledge:listSpaces|createSpace|updateSpace|removeSpace`、工具 `cogito_knowledge_list_spaces`（参数 `spaceId`）；
- TS：`stores/spaces.ts` / `useSpacesStore`、`KnowledgeSpace` 类型、`spaces` / `activeSpaceID` / `selectSpace`。

**冻结（不改）**：浏览器剪藏插件的 HTTP 路径 `GET /api/v1/bases` 与请求体 `baseId`——它们是已发布的跨制品契约，
内部用 `#[serde(rename = "baseId")]` 映射；localStorage 键 `knowledge.source-watch.all-bases` 同理保留，避免静默重置用户偏好。

老库不改就只有一个结果：`no such table: knowledge_space`。改名不是「新增表/列」，所以启动兜底 `ensure_knowledge()`
在「新名不存在、旧名存在」时做一次数据保留式 `ALTER`（表 / 列 / 索引三组，幂等，跑过即跳过），
基线 `0001` 对新库直接建新名。

### D31 渲染预算
用户反馈「随意的操作都会触发整页重渲染」。根因不是死循环，而是三件事叠在一起：

1. **工具页常驻**：主区把设置 / 来源 / 检索 / 图谱 / Lint / 待发布 / 审阅全部挂载只靠 `hidden` 藏，
   隐藏状态的 effect 照样跑（`staging` 挂载即全量 refresh、`sources` 隐藏时还 `mkdir`、`search` 读 80 个 md）。
2. **store 抖动**：`refresh()` 里 `isLoading → spaces → docs → staging → isLoading` 串行 setter，
   一次操作通知 4~5 轮；击键更是 `html → markdown → stats → outline → outline` 五连写。
3. **没有 memo 边界**：根组件因栏开合 / 切页签重渲染时，三栏 children 全是新元素，整棵树跟着重画。

对应改法（都保持「能删路径就删」，不叠开关）：

- `MainPane` 只在激活时渲染 children（编辑器例外——未保存草稿与 undo 栈必须常驻）；
- store 新增 `fetchDocsAndStaging()`：docs + staging 一次 emit；`stores/knowledge.ts` 新增 `toCommitEdit()`：
  击键一次 setter 落地 html / markdown / outline（并去掉重复的 outline 计算），字数统计 `findDocStats`
  扫全篇 Markdown，按 **200ms** 节流单独写入，换文档 / 卸载时丢弃未落地的统计；
- `KnowledgeSurface` / `KnowledgeMainContent` / `KnowledgeAside` / `DocsTabScroll` 加 `memo`，
  列表只收 `docs / hits / isLoading / openDoc` 四个稳定 props（`openDoc` 用 `useCallback` 从 store 取当前空间）；
- 侧栏切换不再把 `tab` 当 refresh 依赖（切页签不需要重扫磁盘）；
- 脚本 `expand()/collapse()` 引起的 `onResize` 用 ref 屏蔽，避免反写偏好造成二次重渲染；
- `useShellSurface` 的槽位元素 `useMemo`，否则每次根渲染都会白白通知顶栏 / 底栏。

### D32 wikilink 全链路
规范里页面互链写的是 `[[页面标题]]`，但**只有编辑器自己的 input rule 认识它**：

| 环节 | 改前 | 改后 |
| --- | --- | --- |
| Markdown → HTML（`enrich-html.ts`） | `[[X]]` 原样留在正文里（marked 当文本） | `[[X]]`/`[[X\|别名]]` → `<a data-wikilink data-wikilink-title data-wikilink-alias>` |
| HTML → Markdown（`serialize-markdown.ts`） | 走默认 `a` 规则，保存成 `[文本]()`，双括号丢失 | 自定义 `wikilink` 规则还原 `[[X]]` / `[[X\|别名]]` |
| 点击 | 无 | 按标题在当前空间里找；找不到给「创建该页」动作 |
| 普通外链点击 | `Link` 是 `openOnClick: false`，点了没反应 | `http(s)`/`mailto` 交给系统浏览器（`openUrl`），其他 scheme 不代开 |
| 输入 | 只能手打完整 `[[X]]` | 打 `[[` 弹出当前空间的页面列表（回车 / Tab 插入） |
| 代码块 | —— | ``` 围栏与行内代码内的双括号不处理 |

候选项（为什么不是别的做法）：

- **mark（现有）vs 独立 node**：mark 保持文本可编辑、DOM 轻、与 `serialize` 的 `textContent` 天然对齐；
  node 能做「渲染成卡片」，但会让光标进出、删除、粘贴都要特殊处理。选 mark。
- **点击跳转的落点**：`data-wikilink-title` 指向 **frontmatter title**（与 SKILL、「同名同 type = 更新」一致），
  文件名只是兜底匹配键；`[[页面#小节]]` 的锚点先剥掉——本仓库的「页」就是文件，暂不做段落锚点。
- **缺失页**：复用 Page Links 的 `insertMissingWikiPage`（写 `wiki/<slug>.md` + frontmatter），
  不再另写一套建页逻辑，保证「点断链建页」与「侧栏一键建页」结果一致。
- **`[[` 补全的实现**：`@tiptap/suggestion` 管插件与定位（`props.mount` 交给 Floating UI），
  弹层交给一个独立 React root 重画——不用 `ReactRenderer`（要求 forwardRef + imperative handle，
  这里只需要重画列表）。

同批还把命令面板的 knowledge provider 从「只搜 `recentPaths`」改成「当前空间全部文档 + 最近打开（去重）」：
`recentPaths` 等于「用过的才搜得到」，与 Obsidian / 语雀的快速切换心智不符。
候选项：接后端 FTS（`knowledge:search`）——能量大但要走 IPC、且与侧栏搜索重复，先本地标题匹配。

### D33 编辑器能力对照（与 Obsidian / Typora / 语雀 / 石墨）

调研结论与待办清单落到了 `docs/apps/client/knowledge-editor-gap-analysis.md`；
原则是**只补「读 agent 产出 + 自己动手写」这条主线上缺的**，不做「百科式对齐 Obsidian」：

- 已具备：GFM、表格（可拖列宽）、任务列表、代码高亮、KaTeX（行内/块）、Mermaid、图片上传、
  实时/源码/分屏三视图、查找替换、大纲、出链/反链/断链面板、导出 HTML 与 zip。
- 本轮补：wikilink 全链路（D32）、callout（D34）、命令面板全库检索、外链点击打开。
- 待排期（按价值排序见文档）：`#tag` 标签与标签面板、文档多标签页、版本历史、标题折叠、
  打印/PDF、`![[嵌入]]`、`[[` 锚点跳转。

### D34 Callout（`> [!note]`）

语雀「高亮块」、石墨「高亮」、Obsidian callout 是同一诉求：长文里的结论 / 风险要能被一眼看到。
与 D32 同批落地，共用「Markdown 双向必须可往返」这条纪律。

三个实现取舍：

1. **在 marked 之后改写 HTML**，不在 Markdown 阶段改。`> [!x]` 本身就是引用块语法，marked 已经给出
   `<blockquote><p>[!x] …`；在 Markdown 阶段塞原始 `<div>` 的话，里面的列表/代码要自己再过一遍解析器，
   相当于重写一遍 marked。
2. **标题取「标记同一行」**：marked 会把 `> [!note]` 与下一行正文合成一个段落（软换行），
   按 `\n` 切开才不会把正文第一句吃成标题。首段被吃掉的 `<p>` 要补回去，否则 HTML 不平衡。
3. **标题不进内容区**：用 `data-callout-title` + CSS `::before` 渲染，而不是在节点里放一个不可编辑的
   `<div>`。后者会让光标进出、全选、复制都要特殊处理，而 callout 标题本来就很少改。

类型 → 颜色的映射走语义 token（`--success` / `--warning` / `--destructive` / `--primary` / `--muted`），
不写死十六进制，主题切换自动跟随；未知类型不丢弃，按名字原样渲染（与 Obsidian 一致）。


## 明确不做的（候选增强）

- 待发布区内的 **diff / 直接编辑**（当前只有只读预览）：需要把 staging 接进编辑器会话，
  改动面大，先确认发布流跑顺。
- 发布后**自动打开新页**：发布是批量动作，自动跳转会让剩下的页失去焦点。
- **agent 写入即刷新待发布角标**：需要订阅工具结果事件；目前打开待发布/切页签时刷新。
- **tags/related 的强校验**（引用页面是否存在、tag 词表）：先只校验 type 与目录。
- **合并时的章节排序 UI**：现在按勾选顺序，页数多时体验一般。
- **capture 页/其他视图的按钮基线统一**：本次只落在 knowledge 与 caption。

## 验证结果（2026-11-24）

| 检查 | 结果 |
| --- | --- |
| `cargo test --manifest-path apps/client/src-tauri/Cargo.toml -p cogito-core` | 170 passed（其中 knowledge 53） |
| `cargo clippy -p cogito-core`（knowledge 相关） | 无警告 |
| `pnpm --filter @cogito/client type-check` | 通过 |
| `pnpm --filter @cogito/client lint` | 通过 |
| `pnpm --filter @cogito/client unit` | 1479 passed / 210 files（含修复后的 automation 用例） |
| `pnpm --filter @cogito/client build-only` | 成功（仅有仓库既有的 INEFFECTIVE_DYNAMIC_IMPORT 提示） |
| `pnpm check:agent-junk` | 仓库干净 |

### 验证结果（2026-11-24 · 破坏性布局重构 D25–D28）

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @cogito/client type-check` | 通过 |
| `pnpm --filter @cogito/client lint` | 通过 |
| `pnpm --filter @cogito/client unit` | 1487 passed / 211 files（新增 `layout-visibility.test.ts`） |
| `cargo test -p cogito-core` / `-p cogito-database` | 168 / 26 passed（含新增 `knowledge_rename_patch_keeps_rows`） |
| 视觉 | 无左轨；侧栏默认 300px（可拖、可折叠）；三栏分割（右栏 320px 可拖、默认收起）；新建空间为弹窗 |

## 相关文件

- 规范实现：`apps/client/src-tauri/crates/core/src/knowledge/{front_matter,wiki,wiki_index,text,service}.rs`
- 工具面：`apps/client/src-tauri/crates/core/src/tools/knowledge.rs`
- IPC：`apps/client/src-tauri/crates/command/src/knowledge.rs`、`apps/client/src/lib/knowledge-ipc.ts`
- 前端：`apps/client/src/views/knowledge/**`（`surface/{space-switcher,new-space-dialog,sidebar-surface,layout-visibility}.tsx`、`workspace/overlay/document-header.tsx`、`caption/final.tsx`、`locale.ts` 文案键）
- 词汇改名：`crates/database/src/{migrations/knowledge_schema.rs,migration.rs}`（`ensure_knowledge`）、`stores/spaces.ts`
- 提示词：`apps/client/src/features/agent/model/prompts.ts`、`apps/client/src/views/knowledge/lib/wiki-context-bridge.ts`
- 文档：`docs/apps/client/knowledge.md`、`docs/apps/client/knowledge-user-guide.md`、`.agents/skills/knowledge-wiki/SKILL.md`
