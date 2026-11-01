# 知识库（client）

一个**文件即真相**的 Markdown 库：正文写盘、库里存快照与元数据，本地检索与对话助手围绕它做。
本文件说明「东西在哪、谁写、坏了怎么查」；具体语义写在代码模块头注释与 `crates/core/src/knowledge`。

> **当前默认：仅本地 FTS + 对话模型写作/优化。** 云端 embedding / 向量召回 / 客户端 RRF
> 已从主线客户端路径移除；完整 RAG 实现冻结在远程分支 `archive/knowledge-rag`
>（基线约 `fe4c3ebf`）。service/compute 侧 RAG 模块暂留但客户端不再调用。

## 分层

| 层 | 位置 | 说明 |
| --- | --- | --- |
| 正文 | `<库目录>/<相对路径>.md` | **唯一真相**；外部改动可回灌 |
| 元数据 | SQLite `knowledge_base` / `knowledge_doc` / FTS5；`knowledge_index_state` 表保留但客户端停写 | 标题、字数、hash、revision |
| 草稿 | `<库目录的父目录>/.staging/<session>/` | agent 只能写这里，等用户确认才发布 |
| 导出 | `<库目录的父目录>/exports/` | 整包 zip（store-only，保留目录结构） |
| 契约 | `shared/ipc/specs/knowledge.ts` | zod 校验，字段与 Rust serde camelCase 一一对应 |

> 库目录 = `knowledge_base.rootPath`；`.staging` / `exports` 是各 base 目录的**兄弟**，不属于任何一篇文档，
> 所以回灌扫描不会把它们当成文档。

## 界面：三列壳（左栏 tabs | 编辑器 | 右栏 tabs）

对齐 Notion / Obsidian / Cursor 笔记：导航在左、正文居中、AI 在右；**全屏最多三列**，
不用并排叠「库面板 + 文件树 + 源码 + 预览 + 大纲 + AI」。旧的知识库 Sheet、生成对话框、
库设置、合并确认、三层自动化弹框、偏好 Sheet 已全部删除。

| 列 | 文件 | 内容 |
| --- | --- | --- |
| 左栏（可收起） | `views/knowledge/surface/*` | 主 tabs：浏览（文件树）/ 库 / 待发布；任务、设置退成右侧图标 |
| 中栏 | `views/knowledge/workspace/*` | 编辑器；源码\|预览「分栏」只在中栏内部 |
| 右栏（可收起） | `views/knowledge/surface/aside.tsx` + `features/agent/dock/*` | tabs：大纲 \| AI（互斥，同一列） |

- **浏览**：磁盘文件树（新建 / 重命名 / 删除）。
- **库**：库切换、新建库、**本地检索**、文档列表 + 生成 + 「⋯」库操作（重扫/导出）。
- **待发布**：`staging` 分组；分组内「合成一篇」只需改个标题，发布两段式（第一下变「确认覆盖」）。
- **任务**：三种归属同列一行——本机（应用运行时执行）/ goose（交给 goose 调度器）/ 服务端（
  `/api/v1/automations`，关掉客户端照跑）；新建/编辑表单嵌在列表上方，执行记录在行内展开。
- **设置**：库选项 + 编辑器偏好（字号/宽度/自动保存/智能标点/打字机）+ 目录信息，改完即生效。

标题栏与工具条「AI」、以及 Ctrl+J，都打开**右栏 AI 页**（不另起一列）。有选区时预选「改写选区」。
Dock 快捷动作含总结 / 结构优化 / 润色 / 续写 / 改写选区 / 问这篇 / 新建；均走对话模型。
结果的落盘是**显式一步**：坞里的「应用到文档」把上一条回复写进光标/选区（一次操作 = 一步撤销）。
切到大纲页时对话仍挂载（隐藏），会话不丢。

## 写路径只有一条

```
agent（app_knowledge_write_doc） → .staging/<session>/xxx.md
                                        │  用户在左面板「待发布」里发布
                                        ▼
                        Service::toPublish：落正式文件 → 写库 → 回灌 hash
```

- **agent 拿不到「直接改正文」**：`app_knowledge_write_doc` 只写 staging，且走审批（`Effect::Write`）。
- **UI 写正文只有一处**：`lib/knowledge-ipc.ts`；编辑器保存走 `knowledge:writeDoc`（带 `hash` 做冲突判定）。
- 中文文件名 → `slugify` 拉丁化，避免各平台路径坑；同名冲突按 `replace` / `keepboth` 两种策略。

## 读写不变量

1. **文件为准**：`knowledge_doc.content` 只是快照，读不到文件时才回退到它。
2. **hash 判冲突**：编辑器打开时记下 `hash`，保存时不一致就是「期间被别处改过」，不写盘、只提示。
3. **外部改动回灌**：打开左面板时可扫描磁盘差异（`autoUpdate` 开关），watch 冲突按「自身抑制 / 外部回灌 / 脏则询问」处理。
4. **删除同批**：base/doc → 文件 + FTS 一起删；`knowledge_index_state` 行若存在一并清理（表本身保留）。

## 检索：仅本地 FTS

| 通道 | 实现 | 失败时 |
| --- | --- | --- |
| 本地 | SQLite FTS5 trigram + BM25；**1–2 字中文**走 `LIKE` 回退 | 无（这是唯一通道） |

前端入口：`views/knowledge/lib/hybrid-search.ts`（现为本地薄封装）→ IPC `searchDocs`。
Agent 工具 `app_knowledge_search` 同样只走 Rust `Service::toSearch`（本地）。

设置项「生成带引用」：基于本地检索命中标注「（见《标题》）」，不依赖向量库。

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
| `app_knowledge_list_docs` | 读 | 看已有文档标题，避免重复造 |
| `app_knowledge_read_doc` | 读 | 单篇正文，默认 8k 字符、上限 20k（分段读） |
| `app_knowledge_search` | 读 | **本地 FTS**；唯一检索入口 |
| `app_knowledge_write_doc` | 写（审批） | 只写 staging，上限 200k 字符 |

## 恢复云端 RAG

需要向量召回时：从 `archive/knowledge-rag` 对照拣回客户端上云 / `apis/rag` / RRF 融合等路径；
文档模型（磁盘 md + SQLite 元数据）无需迁移。

## 排查

| 现象 | 先看哪里 |
| --- | --- |
| 列表有、打开是空 | 文件被挪走 → `knowledge_doc.hash` 与磁盘不一致；面板里「重新扫描」 |
| 保存提示冲突 | 期间别处改过（另一个窗口 / 外部编辑器）；重新打开取新 `hash` 再改 |
| 检索不到 1–2 字中文 | 预期走 `LIKE` 回退；若仍空，确认 FTS 表与文档行数一致（删除是否同批） |
| 定时任务没跑 | 本机：客户端是否在运行；服务端：worker 是否在跑（见 schedule README 排查表） |
| 发布后文件不在库里 | 检查 `rootPath` 是否随应用数据目录搬过（启动时会改成当前路径，旧文件不自动搬） |
