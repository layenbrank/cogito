# 知识库（client）— LLM Wiki 范式

对齐 [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) / llm_wiki：**原文不可变 → Wiki 由 LLM 维护 → Schema/Purpose 定规则与意图**。  
与传统「每次提问向量召回原文」的 RAG 不同；可选 embedding 默认**关闭**。

> 旧 RAG 路径（强制云端向量、待发布门禁作主流程）已退出 Wiki 主线。编辑器仍是 **TipTap**；对话仍是 **ACP dock**（不 fork llm_wiki 的 Milkdown / 内嵌 Chat Agent）。

## 目录（每个 knowledge base 根下）

| 路径 | 说明 |
| --- | --- |
| `raw/sources/` | 不可变原文（PDF / md / 剪藏等） |
| `raw/parsed/` | 可选：文档解析正文（与 sources 同结构，`report.pdf.md`） |
| `wiki/` | LLM 维护的百科页（frontmatter、`[[wikilink]]`） |
| `wiki/index.md` / `log.md` / `overview.md` | 目录 / 时序日志 / 全局概要（**应用侧维护**，禁止模型 FILE 生成） |
| `wiki/media/` | 抽取图片等媒体 |
| `schema.md` / `purpose.md` | 结构规则 / 存在意图（注入 ACP ingest prompt） |
| SQLite FTS | 标题与正文本地检索（文件仍是真相） |

脚手架：`wiki-scaffold.ts` + Rust `ensure_wiki_layout`。

## 界面（对齐 llm_wiki 布局）

三列：Icon rail +（Knowledge \| Files + Activity 底条）| 主区 | 右栏大纲 / AI。

| 区 | 行为 |
| --- | --- |
| Icon 主轨 | Wiki · 来源 · 检索 · 图谱 · Lint · 审阅 · 深度研究 |
| Icon 底轨 | 活动（可进主区）· 设置（全宽，收起左内容栏） |
| 左内容 | Knowledge 文档列表 \| Files 磁盘树；底条 Activity |
| 主区 | Wiki → TipTap；来源/检索/图谱/Lint/审阅/研究 → 工具全宽；设置 → 全页 |
| 右 | 大纲 \| AI（ACP）；工具主视图时收起；**无**「待发布」轨 |

Chat 不在左轨：由右栏 AI dock 承担。主题与组件用 `@cogito/design`。

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
- 多库：`watchAllBases` 时后台变更写入 pending，打开对应库再 drain。

### 剪藏

`@cogito/clipper` → `127.0.0.1:19828/clip`（或 LAN 绑定时局域网 IP）→ `raw/sources` → 入队。

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
- Lint：结构检查；可选「语义启发」（重复标题 / 过短正文）；断链一键 stub。
- Review：「自动修复缺页」对 `missing-page` / `suggestion` 建页。
- 维护：扫描去重（入 Review）、Enrich wikilinks（`enrichWikilinks`）。

## 本机 HTTP（Clip + Wiki API）

默认 `127.0.0.1:19828`；设置 **允许局域网** 时热重绑 `0.0.0.0:19828`：

| 路径 | 说明 |
| --- | --- |
| `GET /health` | Clip 守护状态 |
| `POST /clip` | 剪藏 → `knowledge://clip` → `raw/sources` |
| `GET /api/v1/health` | Wiki API 健康检查（含 `allowLanAccess` / `mcpEnabled` / `bindHost`） |
| `GET /api/v1/bases` | 知识库列表 |
| `GET\|POST /api/v1/search` | FTS 检索 |

设置页「API / Clip」：Token、LAN、**MCP 侧车**（关闭后新 ACP 会话不注入 `cogito-mcp`）。

## Embedding / LanceDB

默认持久层 **LanceDB**（库目录 `.cogito/lancedb`，Rust `vector_*` 命令）；可回退 JSON（localStorage）。  
`concurrency` / `batchSize` 用于 ingest 后批量 `upsertPageEmbeddings`。  
编译需 `protoc`：`apps/client/src-tauri/.cargo/config.toml` 指向 vendored `tools/protoc/bin/protoc.exe`。

## 网页搜索 / AnyTXT

Deep Research provider：`tavily` · `serpapi` · `searxng` · `brave` · `firecrawl` · `bocha`（端点可覆盖）。  
设置 · AnyTXT：Windows 本机 JSON-RPC（默认 `127.0.0.1:9920`）；启用后与网页搜索一并写入 raw。

## 与 llm_wiki 的有意差异

| 项 | llm_wiki | cogito |
| --- | --- | --- |
| 编辑器 | Milkdown 等 | TipTap |
| Chat runtime | 内嵌 Rust agent | ACP / goose + `app_knowledge_*` |
| LLM Ingest | 直连 HTTP `streamChat` | **ACP `runInlinePrompt`** |
| 项目 | 单项目路径 | 多 `knowledge_base` |
| 向量存储 | LanceDB | **LanceDB**（可 JSON 回退） |
| Clip / API 端口 | 常 19827 API + clip pending | **同端口 19828**（/clip + /api/v1）；可 LAN |
| AnyTxt | 可选本地检索 | **已接**（设置 · AnyTXT → Research） |
| Wiki API 鉴权 | 设置灌入 daemon | 设置 → `wiki_http_configure` 进程内热更新（含 LAN 重绑） |
| Source Watch 后端 | Rust file-sync 快照 + hash 改名检测 | 前端 Tauri `watch` + pending 缓冲；无内容 hash 改名合并 |
| Office 预解析 | `preprocessFile`（docx/pptx 等） | 无独立 Office 抽取；PDF 走 sidecar/MinerU/轻量 pdfium |
| LLM Provider | 可在 Wiki 设置内配 | **全局** Agent / 模型设置 |

## 写路径

```
UI ingest-runner / ACP FILE 块 → wiki/*.md + index/log/overview → rescan → FTS
agent write_doc / ingest → 短暂缓冲 → 立即发布 → wiki/*.md + FTS
UI 编辑器保存 → knowledge:writeDoc（hash 冲突）
「存回 wiki」→ save-to-wiki.ts
```
