/**
 * 可一键导入的示例知识库树（purpose/schema + 少量 wiki/来源）。
 */
import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs'

import { findParentDir, joinPath } from '@/views/knowledge/lib/path.ts'

interface DemoWikiFile {
  relative: string
  content: string
}

const DEMO_WIKI_NAME = '示例知识库'
const DEMO_WIKI_SLUG = 'demo-wiki'

const DEMO_WIKI_FILES: readonly DemoWikiFile[] = [
  {
    relative: 'purpose.md',
    content: `# 项目意图 — 示例知识库

## 目标

这是一个可导入的示例知识库，用来演示 purpose / schema、来源摄入与 Wiki 交叉引用。

## 关键问题

1. 本地优先知识库与传统 RAG 各适合什么场景？
2. 摄入两阶段分析如何保证来源可追溯？
3. purpose / schema 如何约束助手的建页行为？

## 范围

**纳入：**
- 桌面端知识库范式、Wiki 页面组织、助手对话约定

**不纳入：**
- 日常待办、与主题无关的聊天记录

## 当前论点

> 知识应先编译进持久 Wiki，再被查询；而不是每次提问都从头从原文推导。
`
  },
  {
    relative: 'schema.md',
    content: `# Wiki 结构 — 示例

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
| entity | wiki/entities/ | 命名实体（人、工具、组织） |
| concept | wiki/concepts/ | 概念、框架、现象 |
| source | wiki/sources/ | 资料摘要页 |
| overview | wiki/ | 全局概要（系统维护） |

## 命名约定

- 文件：\`kebab-case.md\` 或中文短横线
- 交叉引用：\`[[页面-slug]]\`

## Frontmatter

\`\`\`yaml
---
type: entity | concept | source | overview
title: 可读标题
tags: []
related: []
sources: []
---
\`\`\`

## 交叉引用

- 每个概念/实体应出现在 \`wiki/index.md\`
- 资料摘要页必须在 frontmatter \`sources\` 回链原文
- 禁止助手生成 \`wiki/index.md\` / \`wiki/log.md\` / \`wiki/overview.md\`（由应用维护）
`
  },
  {
    relative: 'raw/sources/本地优先笔记.md',
    content: `# 本地优先笔记

本地优先应用把真相保存在本机文件与数据库中，云端同步是可选增强。

对知识库而言：原始资料放在 raw/sources，Wiki 由助手增量维护，purpose/schema 定义方向与结构。
`
  },
  {
    relative: 'raw/sources/摄入流水线.md',
    content: `# 摄入流水线摘要

两步思维链：先分析实体/概念/矛盾，再生成带 frontmatter 的 Wiki 页。

应用侧维护 index / log / overview；模型只输出 wiki/ 下的内容页 FILE 块。
`
  },
  {
    relative: 'wiki/index.md',
    content: `---
title: 目录
type: index
---

# 目录

## 概念

- [[本地优先]] — 本地优先与文件真相
- [[两阶段摄入]] — 两阶段摄入

## 实体

- [[llm-wiki]] — LLM Wiki 范式

## 资料

- [[本地优先笔记]] — 本地优先笔记摘要
- [[摄入流水线]] — 摄入流水线摘要
`
  },
  {
    relative: 'wiki/log.md',
    content: `---
title: 操作日志
type: log
---

# 操作日志

## 操作记录

- 导入示例知识库：写入示例 purpose/schema 与示例页
`
  },
  {
    relative: 'wiki/overview.md',
    content: `---
title: 概要
type: overview
---

# 概要

示例库覆盖「本地优先」「两阶段摄入」与「LLM Wiki」三个入口概念，并附两篇短来源。
`
  },
  {
    relative: 'wiki/concepts/本地优先.md',
    content: `---
title: 本地优先
type: concept
tags: [架构]
related: [llm-wiki, 两阶段摄入]
sources: [raw/sources/本地优先笔记.md]
---

# 本地优先

本机文件与本地数据库是真相来源；云端索引可选。与 [[llm-wiki]] 结合时，Wiki 页持久化结论，而不是每次问答重算。

参见来源 [[本地优先笔记]]。
`
  },
  {
    relative: 'wiki/concepts/两阶段摄入.md',
    content: `---
title: 两阶段摄入
type: concept
tags: [摄入]
related: [本地优先, llm-wiki]
sources: [raw/sources/摄入流水线.md]
---

# 两阶段摄入

1. **分析**：实体、概念、矛盾、与现有 Wiki 的关联
2. **生成**：带 \`sources[]\` 的 Wiki 页 + 应用侧更新 index/log/overview

细节见 [[摄入流水线]] 来源摘要。
`
  },
  {
    relative: 'wiki/entities/llm-wiki.md',
    content: `---
title: LLM Wiki
type: entity
tags: [范式]
related: [本地优先, 两阶段摄入]
---

# LLM Wiki

Karpathy 提出的增量 Wiki 方法论：原文 → Wiki → schema/purpose。本应用在此基础上增加场景模板、图谱与 ACP 助手。
`
  },
  {
    relative: 'wiki/sources/本地优先笔记.md',
    content: `---
title: 本地优先笔记
type: source
sources: [raw/sources/本地优先笔记.md]
related: [本地优先]
---

# 本地优先笔记

短摘要：强调本机真相与可选云同步。完整原文在 \`raw/sources/本地优先笔记.md\`。
`
  },
  {
    relative: 'wiki/sources/摄入流水线.md',
    content: `---
title: 摄入流水线摘要
type: source
sources: [raw/sources/摄入流水线.md]
related: [两阶段摄入]
---

# 摄入流水线摘要

短摘要：分析 → 生成 FILE 块；聚合页由应用维护。
`
  }
]

async function writeDemoWikiTree(rootPath: string): Promise<void> {
  for (const file of DEMO_WIKI_FILES) {
    const absolute = joinPath(rootPath, file.relative)
    const parent = findParentDir(absolute)
    if (parent && !(await exists(parent))) {
      await mkdir(parent, { recursive: true })
    }
    await writeTextFile(absolute, file.content)
  }
}

export { DEMO_WIKI_FILES, DEMO_WIKI_NAME, DEMO_WIKI_SLUG, writeDemoWikiTree }
