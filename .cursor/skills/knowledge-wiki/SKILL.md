---
name: knowledge-wiki
description: Cogito 知识库（LLM Wiki）工作流：场景模板、purpose/schema、ACP 两阶段 ingest、检索模式与 .agent 产物。在用户整理 Wiki、摄入资料、或按忠实原文回答时使用。
---

# 知识库 Wiki Skill

## 库说明书

- `purpose.md`：为什么存在、关键问题、范围
- `schema.md`：页面类型、命名、交叉引用规则
- `wiki/overview.md`：全局概要（**应用维护**，禁止模型 FILE 生成）
- 同样禁止改写 `wiki/index.md`、`wiki/log.md`

开场先 `app_knowledge_read_wiki` 读上述文件（若上下文未注入）。

## 工具

| 工具 | 用途 |
|------|------|
| `app_knowledge_search` | FTS 检索 |
| `app_knowledge_graph_search` | `[[wikilink]]` 邻居 |
| `app_knowledge_read_doc` / `read_wiki` | 读正文 |
| `app_knowledge_write_doc` | 直接写 wiki |
| `app_knowledge_ingest` | **入队** ACP 两阶段（返回 `queued`） |
| `app_knowledge_workspace_write` | 写 `<base>/.agent/` 草稿 |
| `app_knowledge_lint` | 断链 / 孤儿页 |

## 检索模式

- **standard**：FTS
- **smart**：先 overview，再 FTS / graph
- **faithful**：优先 `raw/sources` 与带 `sources[]` 的页；结论必须引用路径

## Ingest

1. 资料落在 `raw/sources/`
2. `app_knowledge_ingest({ path, baseId? })` → queued
3. 前端 Activity 跑分析→生成 FILE 块→写 wiki→维护 index/log/overview

## 建库

- 不要依赖「默认知识库」
- 新建时选场景模板（研究/阅读/个人成长/商业/通用），或「导入示例库」
