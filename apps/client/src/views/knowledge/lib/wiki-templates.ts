interface WikiTemplate {
  id: string
  name: string
  description: string
  icon: string
  schema: string
  purpose: string
  extraDirs: string[]
}

const BASE_SCHEMA_TYPES = `| entity | wiki/entities/ | 命名实体（人、工具、组织、数据集） |
| concept | wiki/concepts/ | 概念、方法、现象、框架 |
| source | wiki/sources/ | 论文、文章、演讲、书籍、博文摘要 |
| query | wiki/queries/ | 正在追踪的开放问题 |
| comparison | wiki/comparisons/ | 相关实体的对照分析 |
| synthesis | wiki/synthesis/ | 跨来源综合与结论 |
| overview | wiki/ | 全局概要（每个库一份，应用维护） |`

const BASE_NAMING = `- 文件名：\`kebab-case.md\`（可用中文短横线，如 \`本地优先.md\`）
- 实体：尽量用正式名称（如 \`openai.md\`、\`gpt-4.md\`）
- 概念：描述性名词短语（如 \`思维链.md\`）
- 资料：\`作者-年份-slug.md\`（如 \`wei-2022-cot.md\`）
- 问题：把问句压成 slug（如 \`规模是否提升推理.md\`）`

const BASE_FRONTMATTER = `所有页面必须包含 YAML frontmatter：

\`\`\`yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: 可读标题
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`

资料摘要页额外字段：
\`\`\`yaml
authors: []
year: YYYY
url: ""
venue: ""
\`\`\``

const BASE_INDEX_FORMAT = `\`wiki/index.md\` 按类型列出全部页面。每条格式：
\`\`\`
- [[页面-slug]] — 一句话说明
\`\`\``

const BASE_LOG_FORMAT = `\`wiki/log.md\` 按时间倒序记录操作：
\`\`\`
## YYYY-MM-DD

- 做了什么 / 记下什么发现
\`\`\``

const BASE_CROSSREF = `- 页面之间用 \`[[页面-slug]]\` 交叉引用
- 每个实体与概念都应出现在 \`wiki/index.md\`
- 问题页链回所依据的资料与概念
- 综合页通过 \`related:\` 引用贡献来源`

const BASE_CONTRADICTION = `当来源互相矛盾时：
1. 在相关概念或实体页注明矛盾
2. 新建或更新 query 页跟踪开放问题
3. 从 query 页链到双方来源
4. 证据足够后在 synthesis 页给出裁决`

const researchTemplate: WikiTemplate = {
  id: 'research',
  name: '研究深挖',
  description: '假设追踪与方法论笔记的深度研究知识库',
  icon: 'lucide:flask-conical',
  extraDirs: ['wiki/methodology', 'wiki/findings', 'wiki/thesis'],
  schema: `# Wiki 结构 — 研究深挖

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
${BASE_SCHEMA_TYPES}
| thesis | wiki/thesis/ | 工作假设及其随时间演变 |
| methodology | wiki/methodology/ | 研究方法、协议与实验设计 |
| finding | wiki/findings/ | 单条实证结果或观察 |

## 命名约定

${BASE_NAMING}
- 假设：把命题压成 slug（如 \`规模提升推理.md\`）
- 方法：方法名（如 \`系统综述.md\`、\`消融实验.md\`）
- 发现：描述性 slug（如 \`更大模型少样本更好.md\`）

## Frontmatter

${BASE_FRONTMATTER}

假设页额外字段：
\`\`\`yaml
confidence: low | medium | high
status: speculative | supported | refuted | settled
\`\`\`

发现页额外字段：
\`\`\`yaml
source: "[[资料-slug]]"
confidence: low | medium | high
replicated: true | false | null
\`\`\`

## 目录格式

${BASE_INDEX_FORMAT}

## 日志格式

${BASE_LOG_FORMAT}

## 交叉引用

${BASE_CROSSREF}
- 发现页通过 frontmatter \`source:\` 回链资料
- 假设页用 \`related:\` 指向支持/反驳的发现
- 使用该方法的发现应引用方法论页

## 矛盾处理

${BASE_CONTRADICTION}

## 研究约定

- 假设页随证据更新——它们是活文档
- 每条发现尽量标注可复现状态
- 方法论页写清「为什么」而不只是「怎么做」
- 区分直接证据与推断
`,
  purpose: `# 项目意图 — 研究深挖

## 研究问题

<!-- 本项研究要回答的核心问题。尽量具体、可证伪。 -->

>

## 假设 / 工作论点

<!-- 当前最佳猜测。证据累积后请更新。 -->

>

## 背景

<!-- 此前工作或动机是什么？补了什么空白？ -->

## 子问题

<!-- 把主问题拆成可推进的子问题。 -->

1.
2.
3.
4.

## 范围

**纳入：**
-

**不纳入：**
-

## 方法

<!-- 如何调查？哪些来源或实验相关？ -->

-

## 成功标准

<!-- 怎样算「答够了」？ -->

-

## 当前状态

> 尚未开始 — 随研究推进更新本节。
`
}

const readingTemplate: WikiTemplate = {
  id: 'reading',
  name: '主题阅读',
  description: '跟踪人物、主题、情节线索与章节笔记',
  icon: 'lucide:book-open',
  extraDirs: ['wiki/characters', 'wiki/themes', 'wiki/plot-threads', 'wiki/chapters'],
  schema: `# Wiki 结构 — 主题阅读

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
${BASE_SCHEMA_TYPES}
| character | wiki/characters/ | 书中人物 |
| theme | wiki/themes/ | 反复出现的主题、母题、象征 |
| plot-thread | wiki/plot-threads/ | 正在跟踪的情节线 |
| chapter | wiki/chapters/ | 分章笔记与摘要 |

## 命名约定

${BASE_NAMING}
- 人物：姓名 kebab-case（如 \`elizabeth-bennet.md\`）
- 主题：主题名词短语（如 \`阶层流动.md\`）
- 情节线：弧线描述（如 \`达西救赎弧.md\`）
- 章节：\`ch-NN-slug.md\`（如 \`ch-01-开场.md\`）

## Frontmatter

${BASE_FRONTMATTER}

人物页额外字段：
\`\`\`yaml
first_appearance: "第 N 章"
role: protagonist | antagonist | supporting | minor
\`\`\`

章节页额外字段：
\`\`\`yaml
chapter: N
pages: "1-24"
\`\`\`

## 目录格式

${BASE_INDEX_FORMAT}

## 日志格式

${BASE_LOG_FORMAT}

## 交叉引用

${BASE_CROSSREF}
- 章节笔记用 \`related:\` 标出出场人物
- 主题页链到主题最明显的章节
- 情节线页列出推进该弧的章节

## 矛盾处理

${BASE_CONTRADICTION}

## 阅读约定

- 章节页在读时或刚读完写——抓住新鲜感受
- 区分情节摘要与个人解读
- 主题页跟踪全书中的**发展**，不要只写「存在某主题」
- 未收束的情节线用 status: \`open\`
- 重要引文记下页码，方便回找
`,
  purpose: `# 项目意图 — 主题阅读

## 书籍信息

**书名：**
**作者：**
**年份：**
**类型：**

## 为什么读

<!-- 吸引你的原因？希望得到什么？ -->

## 要跟踪的主题

<!-- 预期或想跟进的主题线索 -->

1.
2.
3.

## 开卷问题

<!-- 读完前想弄清的问题 -->

1.
2.

## 阅读节奏

**开始日期：**
**目标读完：**
**当前章节：**

## 初印象

<!-- 读完首章或第一次坐下来后更新 -->

>

## 最终收获

<!-- 读完后填写：这本书教了你什么？ -->

>
`
}

const personalTemplate: WikiTemplate = {
  id: 'personal',
  name: '个人成长',
  description: '目标、习惯、反思与日记',
  icon: 'lucide:sprout',
  extraDirs: ['wiki/goals', 'wiki/habits', 'wiki/reflections', 'wiki/journal'],
  schema: `# Wiki 结构 — 个人成长

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
${BASE_SCHEMA_TYPES}
| goal | wiki/goals/ | 正在推进的具体结果 |
| habit | wiki/habits/ | 重复行为及其追踪 |
| reflection | wiki/reflections/ | 阶段性复盘与教训 |
| journal | wiki/journal/ | 日记或会话随笔 |

## 命名约定

${BASE_NAMING}
- 目标：结果作 slug（如 \`跑完马拉松.md\`）
- 习惯：行为名（如 \`每日冥想.md\`）
- 复盘：类型+日期（如 \`周报-2024-03.md\`）
- 日记：日期（如 \`2024-03-15.md\`）

## Frontmatter

${BASE_FRONTMATTER}

目标页额外字段：
\`\`\`yaml
target_date: YYYY-MM-DD
status: active | paused | achieved | abandoned
progress: 0-100
\`\`\`

习惯页额外字段：
\`\`\`yaml
frequency: daily | weekly | monthly
streak: N
status: active | paused | dropped
\`\`\`

复盘页额外字段：
\`\`\`yaml
period: weekly | monthly | quarterly | annual
\`\`\`

## 目录格式

${BASE_INDEX_FORMAT}

## 日志格式

${BASE_LOG_FORMAT}

## 交叉引用

${BASE_CROSSREF}
- 复盘页引用该期审视过的目标与习惯
- 目标通过 \`related:\` 链到支撑习惯
- 日记可用 \`[[slug]]\` 引用目标与复盘

## 矛盾处理

${BASE_CONTRADICTION}

## 个人成长约定

- 日记与复盘要诚实——这个库是写给自己的
- 定期更新目标进度；过期数据不如没有
- 区分结果目标与过程目标
- 复盘习惯成败时写清「为什么」
- 跨目标洞见放在 synthesis 目录
`,
  purpose: `# 项目意图 — 个人成长

## 关注领域

<!-- 当前在推进生活或自我的哪些方面？ -->

1.
2.
3.

## 动机

<!-- 为什么是现在？是什么促使你开这个库？ -->

## 当前目标（摘要）

<!-- 高层列表——细节写在 wiki/goals/ -->

- [ ]
- [ ]
- [ ]

## 进行中的习惯

<!-- 高层列表——细节写在 wiki/habits/ -->

-
-

## 复盘节奏

**每日日记：** 是 / 否
**每周复盘：**
**每月复盘：**
**每季复盘：**

## 指导原则

<!-- 指导成长工作的价值观 -->

1.
2.
3.

## 今年主题

<!-- 一句话概括本年意图 -->

>
`
}

const businessTemplate: WikiTemplate = {
  id: 'business',
  name: '商业/团队',
  description: '会议、决策、项目与干系人上下文',
  icon: 'lucide:briefcase',
  extraDirs: ['wiki/meetings', 'wiki/decisions', 'wiki/projects', 'wiki/stakeholders'],
  schema: `# Wiki 结构 — 商业 / 团队

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
${BASE_SCHEMA_TYPES}
| meeting | wiki/meetings/ | 会议纪要、议程与行动项 |
| decision | wiki/decisions/ | 架构或战略决策（ADR 风格） |
| project | wiki/projects/ | 项目简介、状态与复盘 |
| stakeholder | wiki/stakeholders/ | 相关人员、团队与组织 |

## 命名约定

${BASE_NAMING}
- 会议：\`YYYY-MM-DD-slug.md\`（如 \`2024-03-15-冲刺规划.md\`）
- 决策：\`NNN-slug.md\`（如 \`001-采用-typescript.md\`）
- 项目：描述性 slug（如 \`支付改版.md\`）
- 干系人：姓名或团队 kebab-case（如 \`alice-chen.md\`、\`平台组.md\`）

## Frontmatter

${BASE_FRONTMATTER}

会议页额外字段：
\`\`\`yaml
date: YYYY-MM-DD
attendees: []
action_items: []
\`\`\`

决策页额外字段：
\`\`\`yaml
status: proposed | accepted | deprecated | superseded
deciders: []
date: YYYY-MM-DD
supersedes: ""   # 被取代的 ADR slug（如有）
\`\`\`

项目页额外字段：
\`\`\`yaml
status: planned | active | on-hold | complete | cancelled
owner: ""
start_date: YYYY-MM-DD
target_date: YYYY-MM-DD
\`\`\`

## 目录格式

${BASE_INDEX_FORMAT}

## 日志格式

${BASE_LOG_FORMAT}

## 交叉引用

${BASE_CROSSREF}
- 会议用 \`attendees:\` 与 \`[[干系人-slug]]\` 标出席者
- 决策页链到讨论过该决策的会议
- 项目页用 \`related:\` 链到关键决策
- 干系人页列出参与的项目与决策

## 矛盾处理

${BASE_CONTRADICTION}

## 商业约定

- 会议纪要在会中或 24 小时内写完
- 行动项必须有负责人和截止日期
- 决策页写清**上下文与后果**，不只写结论
- 废弃决策要链到取代它的决策
- 项目完成时补一段复盘
`,
  purpose: `# 项目意图 — 商业 / 团队

## 业务背景

**组织 / 团队：**
**领域：**
**覆盖时段：**

## 目标

<!-- 本 Wiki 支撑的顶层业务目标 -->

1.
2.
3.

## 关键项目

<!-- 高层列表——细节写在 wiki/projects/ -->

-
-

## 关键干系人

<!-- 主要的人或团队 -->

-
-

## 进行中的决策

<!-- 尚未落定的决策——细节写在 wiki/decisions/ -->

-
-

## 指标 / 成功标准

<!-- 团队如何衡量进展？ -->

-

## 约束与风险

<!-- 预算、时间、组织约束与风险 -->

-

## 复盘节奏

**周会纪要：**
**月度状态：**
**季度复盘：**
`
}

const generalTemplate: WikiTemplate = {
  id: 'general',
  name: '通用',
  description: '最小脚手架，适合任意主题',
  icon: 'lucide:file-text',
  extraDirs: [],
  schema: `# Wiki 结构

## 页面类型

| 类型 | 目录 | 用途 |
|------|------|------|
${BASE_SCHEMA_TYPES}

## 命名约定

${BASE_NAMING}

## Frontmatter

${BASE_FRONTMATTER}

## 目录格式

${BASE_INDEX_FORMAT}

## 日志格式

${BASE_LOG_FORMAT}

## 交叉引用

${BASE_CROSSREF}

## 矛盾处理

${BASE_CONTRADICTION}
`,
  purpose: `# 项目意图

## 目标

<!-- 你想弄清或建成什么？ -->

## 关键问题

<!-- 驱动本项目的主要问题 -->

1.
2.
3.

## 范围

**纳入：**
-

**不纳入：**
-

## 当前论点

<!-- 工作假设或阶段性结论（随项目更新） -->

> 待定
`
}

const WIKI_TEMPLATES: WikiTemplate[] = [
  researchTemplate,
  readingTemplate,
  personalTemplate,
  businessTemplate,
  generalTemplate
]

const WIKI_TEMPLATE_GENERAL = 'general'

function findWikiTemplate(id: string): WikiTemplate {
  return (
    WIKI_TEMPLATES.find(function (item) {
      return item.id === id
    }) ?? generalTemplate
  )
}

export { WIKI_TEMPLATES, WIKI_TEMPLATE_GENERAL, findWikiTemplate, type WikiTemplate }
