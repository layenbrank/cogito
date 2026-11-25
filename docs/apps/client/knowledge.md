# 知识库（client）— LLM Wiki 范式

对齐 [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) / llm_wiki：**原文不可变 → Wiki 由 LLM 维护 → Schema/Purpose 定规则与意图**。  
与传统「每次提问向量召回原文」的 RAG 不同；可选 embedding 默认**关闭**。

> 旧 RAG 路径（强制云端向量、待发布门禁作主流程）已退出 Wiki 主线。编辑器仍是 **TipTap**；对话仍是 **ACP dock**（不 fork llm_wiki 的 Milkdown / 内嵌 Chat Agent）。
>
> 2026-11 改版的设计取舍（为什么是 staging-only、一页一概念、两栏 + 抽屉、容器叫「空间」、Rust 为 type 唯一源……）见 [决策记录](../decisions/knowledge-wiki-editor-first.md) 。

## 目录（每个 knowledge base 根下）

| 路径 | 说明 |
| --- | --- |
| `raw/sources/` | 不可变原文（PDF / md / 剪藏等） |
| `raw/parsed/` | 可选：文档解析正文（与 sources 同结构，`report.pdf.md`） |
| `wiki/<type>/` | LLM 维护的百科页（frontmatter、`[[wikilink]]`）；type 见写路径 |
| `wiki/index.md` / `log.md` / `overview.md` | 目录 / 时序日志 / 全局概要（**应用侧维护**，禁止模型 FILE 生成） |
| `wiki/media/` | 抽取图片等媒体 |
| `.staging/` | agent 写入的待发布草稿（用户确认后才进 `wiki/`） |
| `schema.md` / `purpose.md` | 结构规则 / 存在意图（注入 knowledge 场景与 ACP ingest prompt） |
| SQLite FTS | 标题与正文本地检索（文件仍是真相） |

脚手架：`wiki-templates.ts`（五套场景）+ `wiki-scaffold.ts` + Rust `ensure_wiki_layout`（只保证目录与 index/log/overview；purpose/schema 由前端模板写入）。无启动默认库；可导入 `demo-wiki` 示例树。

## 界面（编辑器优先）

**三栏**：`侧栏 | 主区 | 右栏`。侧栏默认 300px（240–440 可拖、可折叠）；主区最小 480px；
右栏（大纲 / AI / 深度研究）默认收起，打开时 320px（280–44% 可拖），宽度都按像素缓存。
界面文案把容器叫「**空间**」（`views/knowledge/locale.ts` 的 `SPACE*` 键是唯一文案源）。

| 区 | 行为 |
| --- | --- |
| 侧栏顶行 | 空间切换（下拉：切换 / 新建空间 / 导入示例空间 / 空间设置）+ 文档·文件视图切换 |
| 侧栏工具栏 | 搜索 + 「新建文档」主按钮 + 起草（AI）+ ⋯（重扫 / 导出空间 / 待发布 / 新建空间） |
| 侧栏列表 | 文档列表（或文件树）；底条 Activity（唯一活动入口，含完整队列与批量重试） |
| 主区 | 文档 → 编辑区（文档头 + 格式条 + 正文）；工具页（来源/检索/图谱/Lint/审阅/待发布/设置）从这里切出，**仅在激活时挂载**（切走会重置其滚动/筛选） |
| 右栏 | 大纲（含 Page Links）\| AI \| 深度研究，独立可分栏；拖到 0 或收起即关闭 |
| 标题栏 | 「视图」菜单（侧栏/大纲/AI/研究/专注）与「空间」菜单（文档 / 新建空间 / 进阶功能） |

已经没有 48px 图标 rail：知识库管理全部走标题栏菜单。

编辑器头部（`workspace/overlay/document-header.tsx`）只留「我在写哪篇」：20px 标题、路径/字数/保存态、
视图模式下拉、右栏开关、查找。专注在标题栏「视图」菜单里。

新建空间是弹窗（`surface/new-space-dialog.tsx`）：名称 + 模板卡片（单选，带图标与说明）+「导入示例空间」。

控件基线：主操作 32–36px（图标 16px），格式条 40px；不再出现 28px 以下按钮。

Chat 不在侧栏：由右栏 AI tab / dock 承担。主题与组件用 `@cogito/design`。

### 链接（`[[页面]]`）

规范里页面靠 frontmatter **title** 互链，编辑器对这一种语法做全链路处理（D32）：

| 环节 | 实现 |
| --- | --- |
| 载入 | `lib/enrich-html.ts` 的 `toWikiLinkAnchors`：`[[X]]` / `[[X\|别名]]` → `<a data-wikilink data-wikilink-title data-wikilink-alias>`；``` 围栏与行内代码内不处理 |
| 输入 | `workspace/wikilink-extension.ts` 的 mark + input rule（打完 `]]` 自动成链） |
| 补全 | 打 `[[` 弹出当前空间页面列表（`workspace/wikilink-suggest.tsx`，`@tiptap/suggestion` 定位，↑↓/Enter/Tab/Esc） |
| 点击 | 编辑器 `handleDOMEvents.click` → `workspace/link-navigation.ts`：按标题在当前空间找页并打开；缺失则给「创建该页」动作（复用 `lib/page-links.ts` 的 `insertMissingWikiPage`） |
| 保存 | `lib/serialize-markdown.ts` 的自定义 `wikilink` 规则还原成 `[[X]]`（默认 `a` 规则会写成 `[文本]()`） |

标题匹配忽略大小写与 `.md` 后缀，`[[X#小节]]` 的锚点先剥掉（本仓库的「页」= 文件，暂无段落锚点）。
`[[页面]]` 与 `enrich-wikilinks.ts` 的 `enrichWikilinks`（裸标题提及 → `[[…]]`）是两个相反方向，不要合并。

普通外链（`[文本](https://…)`）在实时视图里点一下就交给系统浏览器（`@tauri-apps/plugin-opener` 的 `openUrl`），
只放行 `http(s)` / `mailto`；`file:` 与自定义 scheme 不代用户打开。相对路径链接不接管，保持普通文本行为。

### 表格浮层

选中框（`.tiptap-table-selection-overlay`）的 rect 来自 `getBoundingClientRect()`，是**视口坐标**，
所以浮层用 `useFloating({ strategy: 'fixed' })` + `FloatingPortal`（落 `body`），并监听 `window` 的
`scroll`（capture，才能收到编辑器内层滚动容器的滚动）与 `resize`，按 rAF 节流重算 rect。
行/列拖拽手柄走另一条路：门户在表格内的 `.table-controls`（`position: relative`），坐标相对容器算，
随内容一起滚动，**不需要**同样的监听。

### Callout（`> [!note]`）

`lib/callout.ts` 在 marked **之后**把引用块改写成 `div[data-callout]`（`> [!info]`, `> [!warning]`, `> [!danger]`,
`> [!tip]`, `> [!success]`, `> [!quote]`, `> [!example]`，其它类型按名字原样渲染）；标题取标记同一行，省略时用类型中文名
（提示 / 注意 / 警告…）。编辑器侧是 `workspace/callout-extension.ts` 的块节点，标题用 CSS `::before` 从
`data-callout-title` 渲染（不进内容区，光标进出与复制都不用特殊处理），配色走 `--success` / `--warning` /
`--destructive` / `--primary` 语义 token。保存时 `serialize-markdown.ts` 的 `callout` 规则还原成 `> [!type] 标题` + 每行 `>`。

编辑器能力对照与待补清单见 [knowledge-editor-gap-analysis.md](./knowledge-editor-gap-analysis.md)。

## 设置（对齐 llm_wiki 分类）

LLM（purpose/schema 入口）· Embedding · 多模态 · 网页搜索 · 网络（代理）· 源监听（项目/多库、解析并发、提取并发、保留 parsed、autoIngest、分类扩展名、排除规则）· 定时导入 · MinerU/PDF · API/MCP · 输出语言 · 维护。

## 核心操作

```
raw/sources → Ingest（ACP 两阶段 → parseFileBlocks → 写 wiki + index/log/overview → rescan）
           → Query（FTS ± 向量）→ Lint / Review / Graph / Research
```

### Ingest 契约（ACP）

1. `registerIngestAnalyzer(analyzeWithAcp)` 在 Knowledge 页挂载时注册。
2. Step1 分析、Step2 生成 `---FILE: wiki/…---` 块（`runInlinePrompt`，无工具）。
3. `parseFileBlocks`：路径必须在 `wiki/`、拒绝 `..` / 绝对路径；聚合页丢弃；截断进 warnings。
4. 应用侧写多页、合并 `sources`、维护 index/log/overview，然后 `rescan()`。
5. ACP/模型未就绪：队列标 `blocked`，Activity 可「解除阻塞」。
6. Analyzer 失败：回退确定性分析 + Review `confirm`。

### Sources

- 导入：文件 / 文件夹 / URL（SSRF、≤50、私网拒绝）。
- 删除：级联清 cache、wiki 引用、摘要页、media。
- Watch：create/modify → 刷新树 →（autoIngest 且扩展名/排除/体积通过时）入队；remove → lifecycle + 清 `raw/parsed`。
- 双并发：`parsingConcurrency` 闸文档抽取；`ingestConcurrency` 闸队列 worker。
- 多空间：`watchAllSpaces` 时后台变更写入 pending，打开对应空间再 drain。

### 剪藏

浏览器扩展（工具栏弹窗，剪藏页由 `apps/clipper` 打包、扩展本体由 `apps/extension`）→ `127.0.0.1:19828/clip`（隔离 dev 为 `19829`，或 LAN 绑定时局域网 IP）→ `raw/sources` → 入队。抽取与投递在 `@cogito/extension-kit`，与新标签墙共用同一个扩展，不再跨扩展互调。

### PDF

| 后端 | 行为 |
| --- | --- |
| `sidecar-md` | 优先旁路同名 `.md` / `.pdf.md` |
| `mineru` | HTTP `POST {endpoint}/parse`；失败回退内置 |
| `pdfium` | **轻量占位**（未绑定 `pdfium-render`）：旁路 `.md` 或提示文；`extractImages` 扫描 `wiki/media` 同 stem 图片路径 |

多模态开启时，ingest 对回传的图片路径调用 `captionImagePath`，写入「图片说明」段。

### 定时导入

设置变更会 `refreshScheduledImport` 重挂 interval；支持「立即运行一次」扫描目录 → `raw/sources/scheduled` → 入队。

### 图谱 / Lint / Review / 维护

- 图谱：`wiki-graph` + SVG 画布（点击打开页、滚轮缩放、拖拽平移）。
- Lint：结构检查（断链 / 孤儿 / 缺 index）+ **规范项**（缺 type、type 与目录不符、未进 index）；可选「语义启发」（重复标题 / 过短正文）；断链一键 stub。
- Review：「自动修复缺页」对 `missing-page` / `suggestion` 建页。
- 维护：扫描去重（入 Review）、Enrich wikilinks（`enrichWikilinks`）。

## 本机 HTTP（Clip + Wiki API）

默认 `127.0.0.1:19828`；设置 **允许局域网** 时热重绑 `0.0.0.0:19828`：

| 路径 | 说明 |
| --- | --- |
| `GET /health` | Clip 守护状态 |
| `POST /clip` | 剪藏 → `knowledge://clip` → `raw/sources` |
| `GET /api/v1/health` | Wiki API 健康检查（含 `allowLanAccess` / `mcpEnabled` / `bindHost`） |
| `GET /api/v1/bases` | 空间列表（路径为兼容已发布的剪藏插件保留 `bases` 拼写） |
| `GET\|POST /api/v1/search` | FTS 检索 |

设置页「API / Clip」：Token、LAN、**MCP 侧车**（关闭后新 ACP 会话不注入 `cogito-mcp`）。

## Embedding / LanceDB

默认持久层 **LanceDB**（库目录 `.cogito/lancedb`，Rust `vector_*` 命令）；可回退 JSON（localStorage）。  
`concurrency` / `batchSize` 用于 ingest 后批量 `upsertPageEmbeddings`。  
编译需 `protoc`：`apps/client/src-tauri/.cargo/config.toml` 指向 vendored `tools/protoc/bin/protoc.exe`。

设置里「使用本机 Qwen3 Embedding」填 `http://127.0.0.1:11435/v1` 与模型 `dengcao/Qwen3-Embedding-0.6B:F16`，**不**自动打开开关；启用前仍要探测成功。这条端点是本机 `llama-server --embedding`，不是 Ollama `:11434`（该目录把这只 GGUF 标成 completion，`/v1/embeddings` 会 501）。经 Cloudflare Tunnel 时把端点改成 `https://<域名>/embed/v1` 并填写 API Key。查询前缀只加在问句上，写入索引的原文不加；留空则问句也嵌原文。换模型后若维度和 Lance 表不一致，先清空索引再重建。

## 网页搜索 / AnyTXT

Deep Research provider：`tavily` · `serpapi` · `searxng` · `brave` · `firecrawl` · `bocha`（端点可覆盖）。  
设置 · AnyTXT：Windows 本机 JSON-RPC（默认 `127.0.0.1:9920`）；启用后与网页搜索一并写入 raw。

## 与 llm_wiki 的有意差异

| 项 | llm_wiki | cogito |
| --- | --- | --- |
| 右栏 | 仅 Deep Research | **三栏第三列**（大纲含 Page Links \| AI \| 深度研究；研究可与工具主区并存） |
| 编辑器 | Milkdown 等 | TipTap |
| Chat runtime | 内嵌 Rust agent | ACP / goose + `cogito_knowledge_*`（注入 purpose/schema/overview；检索模式 standard/smart/faithful） |
| LLM Ingest | 直连 HTTP `streamChat` | **ACP `runInlinePrompt`**；`cogito_knowledge_ingest` 入队同一管线 |
| 建库 | 场景模板覆盖 purpose/schema | 同左（五套模板 + 示例库导入） |
| 项目 | 单项目路径 | 多 `knowledge_space` |
| 向量存储 | LanceDB | **LanceDB**（可 JSON 回退） |
| Clip / API 端口 | 常 19827 API + clip pending | **同端口 19828**（/clip + /api/v1）；可 LAN |
| AnyTxt | 可选本地检索 | **已接**（设置 · AnyTXT → Research） |
| Wiki API 鉴权 | 设置灌入 daemon | 设置 → `wiki_http_configure` 进程内热更新（含 LAN 重绑） |
| Source Watch 后端 | Rust file-sync 快照 + hash 改名检测 | 前端 Tauri `watch` + pending 缓冲；无内容 hash 改名合并 |
| Office 预解析 | `preprocessFile`（docx/pptx 等） | 无独立 Office 抽取；PDF 走 sidecar/MinerU/轻量 pdfium |
| LLM Provider | 可在 Wiki 设置内配 | **全局** Agent / 模型设置 |

## 写路径

```
agent write_doc（带 type）→ wiki::normalize → .staging/<session>/<slug>-<hex>.md
用户「待发布」确认 → knowledge:publish / publishMany
  → wiki/<type>/<slug>.md + 落库 + index/log/overview → FTS
UI ingest-runner / ACP FILE 块 → wiki/<type>/… → index/log/overview → rescan → FTS
UI 编辑器保存 → knowledge:writeDoc（hash 冲突）
「存回 wiki」→ save-to-wiki.ts
```

规范只有一处实现（Rust `crates/core/src/knowledge/wiki.rs`）：

- `type` → 目录：内置 15 种 —— 通用 `entity/concept/source/query/comparison/synthesis/note`，以及模板类型 `character/theme/plot-thread/chapter/meeting/decision/project/stakeholder`；未知 type 直接报错（不猜目录）；
- frontmatter 由管线补齐（`type/title/created/updated`），正文 H1 与 title 重复会被去掉、其余 H1 降为 H2；
- **同名页 = 更新同一页**（保留 `created`，刷新 `updated`），不再静默另存一份；
- index/log/overview 由应用维护（`knowledge::wiki_index`），设置 → 维护可「重建 wiki/index.md」。

存量归位：设置 → 维护 → 「检查存量文档」先出计划（dry-run），确认后把库根/错目录的页挪进 `wiki/<type>/`。
