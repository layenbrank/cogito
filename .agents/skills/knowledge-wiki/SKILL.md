---
name: knowledge-wiki
description: Cogito 空间（LLM Wiki）工作流：一页一概念、frontmatter 必填项、type → wiki/<type>/ 落点、待发布区（staging）与 ACP 两阶段 ingest、检索模式。整理或写入空间、摄入资料、按忠实原文回答时使用。
---

# 空间 Wiki Skill

## 规范（与 Rust `knowledge::wiki` 同源）

一页一概念；页面类型决定目录：

| type | 目录 | 用途 |
| --- | --- | --- |
| `entity` | `wiki/entities/` | 人、工具、组织、数据集 |
| `concept` | `wiki/concepts/` | 概念、方法、现象、框架 |
| `source` | `wiki/sources/` | 论文、文章、书籍摘要 |
| `query` | `wiki/queries/` | 正在追踪的开放问题 |
| `comparison` | `wiki/comparisons/` | 实体/方案对照 |
| `synthesis` | `wiki/synthesis/` | 跨来源综合 |
| `note` | `wiki/notes/` | 普通笔记（默认） |
| `character` | `wiki/characters/` | 书中人物（阅读模板） |
| `theme` | `wiki/themes/` | 主题/母题（阅读模板） |
| `plot-thread` | `wiki/plot-threads/` | 情节线（阅读模板） |
| `chapter` | `wiki/chapters/` | 分章笔记（阅读模板） |
| `meeting` | `wiki/meetings/` | 会议纪要（商业模板） |
| `decision` | `wiki/decisions/` | 决策记录（商业模板） |
| `project` | `wiki/projects/` | 项目（商业模板） |
| `stakeholder` | `wiki/stakeholders/` | 干系人（商业模板） |

每页必须带 YAML frontmatter（管线会自动补齐缺项）：

```yaml
---
type: concept
title: 可读标题
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

- 正文从 `##` 起写，不写一级标题（标题在 frontmatter 里，重复的 H1 会被去掉）；
- 文件名 `kebab-case.md`，可用中文短横线（`本地优先.md`）；
- 页面之间用 `[[页面标题]]` 互链；
- 需要强调结论/风险时用 callout（编辑器会渲染成高亮块）：
  `> [!warning] 数据是旧的` + `>` + `> 正文`；可用类型 `note` / `tip` / `info` / `success` / `warning` / `danger` / `quote` / `example`；
- **禁止**写 `wiki/index.md`、`wiki/log.md`、`wiki/overview.md` —— 应用维护。

## 库说明书

- `purpose.md`：为什么存在、关键问题、范围
- `schema.md`：页面类型、命名、交叉引用规则
- `wiki/overview.md`：全局概要（应用维护）

聊天页会自动注入这三个文件；上下文里没有时用 `cogito_knowledge_read_wiki` 读。

## 工具

| 工具 | 用途 |
| --- | --- |
| `cogito_knowledge_search` | FTS 检索 |
| `cogito_knowledge_graph_search` | `[[wikilink]]` 邻居 |
| `cogito_knowledge_read_doc` / `read_wiki` | 读正文 |
| `cogito_knowledge_write_doc` | **只写待发布区（staging）**，必须带 `type` |
| `cogito_knowledge_ingest` | **入队** ACP 两阶段（返回 `queued`） |
| `cogito_knowledge_workspace_write` | 写 `<base>/.agent/` 草稿 |
| `cogito_knowledge_lint` | 断链 / 孤儿页 / 缺 type / 未进 index |

`write_doc` **不会**直接入库：写完要请用户到「空间 → 待发布」确认发布，不要在回复里说「已发布」。

发布语义：**同名 + 同 type = 更新那一页**（会沿用既有路径，不会另建一份）；标题改了就是新页，先问用户。

## 检索模式

- **standard**：FTS
- **smart**：先 overview，再 FTS / graph
- **faithful**：优先 `raw/sources` 与带 `sources[]` 的页；结论必须引用路径

## Ingest

1. 资料落在 `raw/sources/`
2. `cogito_knowledge_ingest({ path, spaceId? })` → queued
3. 前端 Activity 跑分析→生成 FILE 块→写 `wiki/<type>/`→维护 index/log/overview

## 建空间

- 不要依赖「默认空间」
- 新建时选场景模板（研究/阅读/个人成长/商业/通用），或「导入示例空间」
