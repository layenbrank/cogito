---
name: knowledge-wiki
description: Cogito 知识库（LLM Wiki）工作流入口。权威内容在 `.agents/skills/knowledge-wiki/SKILL.md`；这里只保留指针，避免两份规范漂移。
---

# 知识库 Wiki Skill（指针）

权威版本：**[`.agents/skills/knowledge-wiki/SKILL.md`](../../.agents/skills/knowledge-wiki/SKILL.md)**

> 为什么不再维护副本：type 表、frontmatter 必填项、staging 发布语义都随代码演进，
> 两份文本必然漂移。Cursor 只扫 `.cursor/skills`，所以这个目录保留一个指针；
> **改规范请只改 `.agents/` 那一份。**

速查（详细规则见上面链接）：

- 一页一概念；`type` 决定落点（entity/concept/source/query/comparison/synthesis/note + 模板类型）
- 正文从 `##` 起；`[[页面标题]]` 互链；禁写 `wiki/index.md` / `log.md` / `overview.md`
- `cogito_knowledge_write_doc` **只写待发布区**，用户在「知识库 → 待发布」确认后才归档
- 同名 + 同 type = 更新那一页；标题改了就是新页，先问用户
