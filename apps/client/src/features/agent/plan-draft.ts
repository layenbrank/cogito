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

import { readModeSnapshot } from '@/features/agent/mode'

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

/**
 * 模型按约定给出结构化计划时直接用它（比任何启发式都准）。
 *
 * 只认**标明 json 的围栏**：以前 `(?:json)?` 让任意代码块（包括 `chunks=131`、`src/utils/...`
 * 这种普通围栏）都进 `JSON.parse`，于是每篇带代码块的回答都把控制台刷成一片告警。
 */
const JSON_BLOCK = /```json[ \t]*\r?\n([\s\S]*?)```/gi

/** 同一段正文的结构化步骤只解一次（aside 的选择器会在每次状态变化时重入） */
const STEP_CACHE_LIMIT = 32
const stepCache = new Map<string, string[] | null>()

function findStructuredSteps(text: string): string[] | null {
  const cached = stepCache.get(text)
  if (cached !== undefined) return cached
  const found = parseStructuredSteps(text)
  if (stepCache.size >= STEP_CACHE_LIMIT) {
    const oldest = stepCache.keys().next().value
    if (oldest !== undefined) stepCache.delete(oldest)
  }
  stepCache.set(text, found)
  return found
}

function parseStructuredSteps(text: string): string[] | null {
  const blocks = [...text.matchAll(JSON_BLOCK)]
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const payload = (blocks[index][1] ?? '').trim()
    // 不是对象/数组就不是计划 JSON：跳过，不进 JSON.parse（也不再告警）
    if (!payload.startsWith('{') && !payload.startsWith('[')) continue
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
      // 合法围栏但不是合法 JSON：属于正常降级（模型把代码块标成了 json），
      // 只在 DEV 留一条 debug，别再刷成 warn
      if (import.meta.env.DEV) {
        console.debug('[agent/plan-draft] 跳过非 JSON 的 json 围栏:', error)
      }
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

/**
 * 计划模式下「够长就算计划」的字数下限。
 *
 * 计划模式的语义是「这一轮产出的就是计划」，所以不该再要求模型严格按模板写骨架；
 * 但也不能把一句「这个文件是做什么的」当成可执行计划，用长度挡住短问答。
 */
const PLAN_MODE_FALLBACK_MIN_CHARS = 200

/**
 * 产出最后一条助手回复的那一轮用的是哪个模式。
 *
 * 读的是**用户消息上的模式快照**（发送那一刻写进去的），而不是"现在选中的模式"：
 * 随手聊完再把档位切到「计划」，旧回答不该被当成计划；而真正的计划轮即便用户已切到
 * 执行档，也该继续当成计划（执行入口就在计划页签里）。老数据没有快照 → 不猜。
 */
function findTurnMode(messages: readonly ThreadMessage[]): string | null {
  let assistantIndex = messages.length - 1
  while (assistantIndex >= 0 && messages[assistantIndex].role !== 'assistant') {
    assistantIndex -= 1
  }
  if (assistantIndex < 0) return null
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    // 快照落在 `metadata.custom`（`stampUserModeSnapshot` 写的就是那一层）；
    // 同时兼容已经拍平到 `metadata` 上的旧形状，免得再造一个读不到的情况。
    const custom = message.metadata?.custom as Readonly<Record<string, unknown>> | undefined
    return (
      readModeSnapshot(custom)?.mode ?? readModeSnapshot(message.metadata)?.mode ?? null
    )
  }
  return null
}

/**
 * 右栏「计划」页签该显示的草稿（归档记录优先，由调用方先判）。
 *
 * 非计划轮只认 `isPlanDocument`（H1 / 计划类章节 + 步骤），随便一句回答不该占据计划页签。
 * 计划轮则放宽：这一轮的产出**就是**计划，没按模板写（只给「## 方案」+ 散文步骤）也应当
 * 能「开始执行」。
 *
 * 两个门的顺序很重要：兜底只在「这一轮是计划轮」时生效 —— 用消息快照判，不用当前档位。
 */
function findPanelDraft(messages: readonly ThreadMessage[]): PlanDraft | null {
  const text = findLastAssistantText(messages)
  if (!text) return null
  const parsed = parsePlanText(text)
  if (parsed && isPlanDocument(text)) return parsed
  if (findTurnMode(messages) !== 'plan') return null
  if (text.length < PLAN_MODE_FALLBACK_MIN_CHARS) return null
  if (parsed) return parsed
  const lines = text.split('\n')
  return { title: findTitle(lines), overview: findOverview(lines), steps: [], body: text }
}

export {
  findLastAssistantText,
  findPanelDraft,
  findPlanDraft,
  findTurnMode,
  isPlanDocument,
  parsePlanText
}
export type { PlanDraft }
