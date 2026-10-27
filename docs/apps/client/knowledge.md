# 知识库（client）

一个**文件即真相**的 Markdown 库：正文写盘、库里存快照与元数据，检索、云端召回、定时生成都围绕它做。
本文件说明「东西在哪、谁写、坏了怎么查」；具体语义写在代码模块头注释与 `crates/core/src/knowledge`。

## 分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 正文 | `<库目录>/<相对路径>.md` | **唯一真相**；外部改动可回灌 |
| 元数据 | SQLite `knowledge_base` / `knowledge_doc` / `knowledge_index_state` | 标题、字数、hash、revision、云端索引坐标 |
| 草稿 | `<库目录的父目录>/.staging/<session>/` | agent 只能写这里，等用户确认才发布 |
| 导出 | `<库目录的父目录>/exports/` | 整包 zip（store-only，保留目录结构） |
| 契约 | `shared/ipc/specs/knowledge.ts` | zod 校验，字段与 Rust serde camelCase 一一对应 |

> 库目录 = `knowledge_base.rootPath`；`.staging` / `exports` 是各 base 目录的**兄弟**，不属于任何一篇文档，
> 所以回灌扫描不会把它们当成文档。

## 写路径只有一条

```
agent（app_knowledge_write_doc） → .staging/<session>/xxx.md
                                        │  用户在知识库面板点「发布」
                                        ▼
                        Service::toPublish：落正式文件 → 写库 → 回灌 hash
```

- **agent 拿不到「直接改正文」**：`app_knowledge_write_doc` 只写 staging，且走审批（`Effect::Write`）。
- **UI 写正文只有一处**：`lib/knowledge-ipc.ts`；编辑器保存走 `knowledge:writeDoc`（带 `hash` 做冲突判定）。
- 中文文件名 → `slugify` 拉丁化，避免各平台路径坑；同名冲突按 `replace` / `keepboth` 两种策略。

## 读写不变量

1. **文件为准**：`knowledge_doc.content` 只是快照，读不到文件时才回退到它。
2. **hash 判冲突**：编辑器打开时记下 `hash`，保存时不一致就是「期间被别处改过」，不写盘、只提示。
3. **外部改动回灌**：打开面板时可扫描磁盘差异（`autoUpdate` 开关），watch 冲突按「自身抑制 / 外部回灌 / 脏则询问」处理。
4. **删除同批**：base/doc → 文件 + FTS + 索引状态一起删；云端资产默认保留（要手动清）。

## 检索：本地永远可用，云端只加分

| 通道 | 实现 | 失败时 |
| --- | --- | --- |
| 本地 | SQLite FTS5 trigram；**1–2 字中文**走 `LIKE` 回退 | 无（这是兜底） |
| 云端 | 上传资产 → 索引任务 → `POST /api/v1/rag/search` 向量召回 | 该路静默缺席，结果标注「本地」 |

两路在**渲染进程**用 RRF 融合（`lib/hybrid-search.ts`）：bm25 与余弦不同量纲，只比名次；
服务端不做融合，因为它拿不到两路结果。去重键是 `assetID → docID`（`knowledge_index_state` 那张对照表）。

云端索引状态机写在 `knowledge_index_state`：`idle → uploading/queued/running → succeeded | failed`，
失败原因进 `error` 并在界面上显示，不静默消失。`cloudModel` / `cloudDimensions` 与当前嵌入模型不一致时，
这篇文档**不参与云端召回**（不同向量空间的距离没有可比性）。

## 自动化（定时生成 / 定时任务）

| 归属 | 谁执行 | 关掉客户端 |
| --- | --- | --- |
| 本机（`owner=client`） | 客户端 worker 每 12s 认领，发 `automation:due`，渲染进程起一次 ACP 会话 | 不跑 |
| goose 调度器（`owner=goose`） | 交给 goose 的 schedules，本地行只做镜像 | 看 goose |
| 服务端（`owner=cloud`） | service 侧的 `scheduled_job` + worker（见 `apps/service/src/services/schedule/README.md`） | 照跑 |

共同语义：cron 用 **5 段 crontab**，按任务时区解释；`(automationId, scheduledFor)` 唯一，
认领用 CAS 推进 `nextRunAt`；错过多轮**只补一次**。无人值守执行时，审批与追问一律自动拒绝
（拒绝次数追加到输出里，不假装成功）。

## agent 工具面

| 工具 | 效果 | 说明 |
| --- | --- | --- |
| `app_knowledge_list_bases` | 读 | 确认目标库 |
| `app_knowledge_list_docs` | 读 | 看已有标题，避免重复造 |
| `app_knowledge_read_doc` | 读 | 单篇正文，默认 8k 字符、上限 20k（分段读） |
| `app_knowledge_search` | 读 | 本地 + 云端融合；**唯一**检索入口 |
| `app_knowledge_write_doc` | 写（审批） | 只写 staging，上限 200k 字符 |

云端 MCP（`cogito-cloud`）**只在本地网关缺失时挂载**：两边同时在，模型会对同一个查询调两次。
见 `features/agent/acp/cloud-mcp.ts`。

## 清理入口

旧版本每 30 秒往 `<应用数据>/markdown-backups` 写一份 `.bak`；新版不再写，但**不自动删除**。
偏好面板（编辑器右上「偏好」）在检测到残留时显示「旧版本留下的备份 · N 个文件 · X MB」并给删除按钮
（`knowledge:legacyScan` / `knowledge:legacyRemove`）。删的是副本，不影响当前文档。

## 排查

| 现象 | 先看哪里 |
| --- | --- |
| 列表有、打开是空 | 文件被挪走 → `knowledge_doc.hash` 与磁盘不一致；面板里「重新扫描」 |
| 保存提示冲突 | 期间别处改过（另一个窗口 / 外部编辑器）；重新打开取新 `hash` 再改 |
| 检索不到 1–2 字中文 | 预期走 `LIKE` 回退；若仍空，确认 FTS 表与文档行数一致（删除是否同批） |
| 云端召回声称为 0 | `knowledge_index_state.status` 与 `error`；再看 `cloudModel` 是否与当前嵌入模型一致 |
| 定时任务没跑 | 本机：客户端是否在运行；服务端：worker 是否在跑（见 schedule README 排查表） |
| 发布后文件不在库里 | 检查 `rootPath` 是否随应用数据目录搬过（启动时会改成当前路径，旧文件不自动搬） |
