/**
 * 计划：从最后一条 assistant 正文里读出一份计划文档。
 *
 * 为什么需要它：goose 的 `plan` 事件来自模型的 todo 工具，模型**不一定会调**；
 * 而「计划模式」下模型是用 Markdown 把方案写出来。
 *
 * 对齐 Cursor `.cursor/plans/*.plan.md` 与 Copilot `plan-*.prompt.md` 的格式，
 * 一份计划有三层，互不替代：
 * - **overview**：一句话总结（`## 概述` / `## TL;DR` 段，没有就取全文首个正文段）；
 * - **steps**：实施步骤清单，只是摘要，供右栏展示进度；
 * - **body**：完整计划全文，原样保留 —— 「计划」页签与保存都用它，不做任何裁剪。
 */
import type { ThreadMessage } from '@assistant-ui/react'

interface PlanDraft {
  /** 计划标题：文档第一个 H1；没有则为空串 */
  title: string
  /** 一句话总结 */
  overview: string
  /** 任务清单：从「实施步骤」段派生，或来自结构化输出 */
  steps: string[]
  /** 完整计划正文，原样保留 */
  body: string
}

/** 编号（`1.` / `1、` / `1)`）与 markdown 勾选框两种写法 */
const STEP_LINE = /^\s*(?:\d+[.、)]|[-*]\s*\[[ xX]\])\s+(.+)$/
/**
 * 普通项目符号（`- 步骤` / `* 步骤`）。
 *
 * 计划清单已不再落盘，模型改为写正文散文式步骤时未必编号；只在**计划类标题**下
 * 才把普通项目符号当步骤（见 `findStepList`），否则任何带列表的回复都会被当成计划。
 */
const BULLET_LINE = /^\s*[-*+]\s+(?!\[[ xX]\])(.+)$/

/** 去掉行内 markdown 标记，保留 `__main__.py` 这类真实下划线 */
function cleanInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 概述标题：`## 概述` / `## 概要` / `## 总结` / `## TL;DR` / `## 摘要` / `## 目标` */
const OVERVIEW_HEADING = /^#{1,6}\s*(概述|概要|总结|摘要|目标|tl;?dr)\s*$/i

function findTitle(lines: readonly string[]): string {
  for (const raw of lines) {
    const matched = raw.trim().match(/^#\s+(.+)$/)
    if (matched) return cleanInline(matched[1])
  }
  return ''
}

/**
 * 概述：优先取「概述 / TL;DR」段的第一行正文，否则退到全文第一个正文段。
 * 只取一行 —— 它是**总结**，细节都留在 body 里。
 */
function findOverview(lines: readonly string[]): string {
  let inOverview = false
  let inFence = false
  let fallback = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || !line) continue
    if (OVERVIEW_HEADING.test(line)) {
      inOverview = true
      continue
    }
    if (isHeading(line)) {
      if (inOverview) break
      continue
    }
    if (STEP_LINE.test(line) || BULLET_LINE.test(line)) {
      if (inOverview) break
      continue
    }
    if (inOverview) return cleanInline(line)
    if (!fallback) fallback = cleanInline(line)
  }
  return fallback
}

/** 最后一条有正文的 assistant 消息正文（没有则 null） */
function findLastAssistantText(messages: readonly ThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const text = message.content
      .filter(function (part) {
        return part.type === 'text'
      })
      .map(function (part) {
        return part.type === 'text' ? part.text : ''
      })
      .join('\n')
      .trim()
    if (text) return text
  }
  return null
}

/** 计划章节标题：命中这些词的段落里的列表优先当计划 */
const PLAN_HEADING = /(计划|步骤|实施|方案|行动|roadmap)/i

/**
 * 「调整计划」那一轮常常不写 H1、只给结构化章节：命中任一即算结构在（见 `isPlanDocument`）。
 * 加了这一层，改过的计划才录得进档案 —— 否则右栏与执行入口继续拿旧版跑。
 */
const PLAN_SECTION_HEADING = /^#{1,6}\s*(?:方案|实施步骤|验证)(?:[：:].*)?\s*$/im
/** 结构判定的长度下限：太短的回复即便带标题也不是一份计划 */
const PLAN_DOCUMENT_MIN_CHARS = 200

/** 计划文档的硬标识：H1 标题，或明确说了「实施步骤 / 方案 / 计划」 */
const PLAN_DOCUMENT_HEADING = /^#{1,6}\s*(?:.*(?:实施步骤|方案|计划).*)$/im

/** 模型按约定给出结构化计划时直接用它（比任何启发式都准） */
const JSON_BLOCK = /```(?:json)?\s*\n([\s\S]*?)```/g

function findStructuredSteps(text: string): string[] | null {
  const blocks = [...text.matchAll(JSON_BLOCK)]
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const payload = blocks[index][1] ?? ''
    try {
      const parsed = JSON.parse(payload) as { steps?: unknown }
      if (!Array.isArray(parsed.steps)) continue
      const steps = parsed.steps
        .map(function (item: unknown) {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object') {
            const record = item as { title?: unknown; content?: unknown; detail?: unknown }
            const picked = record.title ?? record.content ?? record.detail
            return typeof picked === 'string' ? picked.trim() : ''
          }
          return ''
        })
        .filter(function (item) {
          return item.length > 0
        })
      if (steps.length >= 2) return steps
    } catch (error) {
      // 不是合法 JSON：继续找上一个代码块
      console.warn('[agent/plan-draft] 结构化计划解析失败，回退启发式:', error)
    }
  }
  return null
}

interface ListBlock {
  heading: string
  steps: string[]
  /** 其中有多少条是普通项目符号（非编号 / 非勾选框） */
  bullets: number
}

function isHeading(line: string): boolean {
  const text = line.trim()
  if (!text) return false
  if (/^#{1,6}\s/.test(text)) return true
  if (/^[一二三四五六七八九十]+[、.]/.test(text)) return true
  if (/^\*\*[^*]+\*\*[：:]?$/.test(text)) return true
  return false
}

/** 按标题切段，收集每段里的连续列表（每段可能有多个） */
function findListBlocks(lines: readonly string[]): ListBlock[] {
  const blocks: ListBlock[] = []
  let heading = ''
  let current: string[] | null = null
  let bullets = 0
  let strayLines = 0

  function flush() {
    if (current && current.length >= 2) {
      blocks.push({ heading, steps: current, bullets })
    }
    current = null
    bullets = 0
    strayLines = 0
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (isHeading(line)) {
      flush()
      heading = line
      continue
    }
    if (!line) {
      if (current) strayLines += 1
      continue
    }
    const matched = line.match(STEP_LINE)
    const bullet = matched ? null : line.match(BULLET_LINE)
    const item = matched?.[1] ?? bullet?.[1]
    if (item) {
      current ??= []
      strayLines = 0
      if (bullet) bullets += 1
      current.push(cleanInline(item))
      continue
    }
    if (!current) continue
    strayLines += 1
    if (strayLines > 1) flush()
  }
  flush()
  return blocks
}

/**
 * 从正文里挑出最像「实施步骤」的那段列表：
 * 标题命中「计划/步骤/方案」的优先，并列时取最长 —— 隐患、待确认问题
 * 这类列表通常比计划短，长的才是主线。
 *
 * 没有计划类标题时只认编号 / 勾选框列表：普通项目符号太通用，光凭它无法
 * 认定「这是一份计划」，否则任何带 bullet 的回复都会被当成计划草稿。
 */
function findStepList(lines: readonly string[]): string[] | null {
  const blocks = findListBlocks(lines)
  if (blocks.length === 0) return null
  const candidates = blocks.filter(function (block) {
    return PLAN_HEADING.test(block.heading)
  })
  const numbered = blocks.filter(function (block) {
    return block.bullets === 0
  })
  const pool = candidates.length > 0 ? candidates : numbered
  if (pool.length === 0) return null
  const longest = pool.reduce(function (best, block) {
    return block.steps.length > best.steps.length ? block : best
  })
  return longest.steps
}

/**
 * 把一段正文解析成计划草稿（纯函数，供 planner / recorder 复用）。
 * 解析不出至少一条步骤就返回 null。
 */
function parsePlanText(body: string): PlanDraft | null {
  const text = body.trim()
  if (!text) return null

  const lines = text.split('\n')
  const steps = findStructuredSteps(text) ?? findStepList(lines)
  if (!steps || steps.length === 0) return null

  return { title: findTitle(lines), overview: findOverview(lines), steps, body: text }
}

/**
 * 这段正文「看起来是不是一份计划文档」。
 *
 * 比 `parsePlanText` 更严：至少 2 步，且必须带 H1 或明确的计划类标题 ——
 * 否则任何带两个 bullet 的普通回答都会被录成计划档案，右栏就会永远挂着一份假计划。
 *
 * 结构化判据优先（「调整计划」那一轮常没有 H1）：`## 方案` / `## 实施步骤` / `## 验证`
 * 任一 + 正文长度达标即视为计划文档。太短的回复即便带标题也不录，避免把一句
 * 「## 方案：改个名」当成新计划。
 */
function isPlanDocument(text: string): boolean {
  const draft = parsePlanText(text)
  if (!draft || draft.steps.length < 2) return false
  if (/^#\s+/m.test(text) || PLAN_DOCUMENT_HEADING.test(text)) return true
  return PLAN_SECTION_HEADING.test(text) && text.length >= PLAN_DOCUMENT_MIN_CHARS
}

/**
 * 读取计划：
 * 1. steps 优先用结构化 JSON（模型仍可能这样输出），否则从「实施步骤」段派生；
 * 2. body 是**原文全量**，「计划」页签全量渲染它，保存也用它 —— 不再剔除步骤、不再截断。
 */
function findPlanDraft(messages: readonly ThreadMessage[]): PlanDraft | null {
  const body = findLastAssistantText(messages)
  if (!body) return null
  return parsePlanText(body)
}

export { findLastAssistantText, findPlanDraft, isPlanDocument, parsePlanText }
export type { PlanDraft }
