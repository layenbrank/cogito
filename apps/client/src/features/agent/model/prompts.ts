/**
 * 场景系统提示：经 goose `_goose/unstable/session/system-prompt/set` 注入。
 *
 * 工具名以 **corex-mcp 实际暴露的 7 个工具**为准（`agent-tools.lock.json` 是基线）。
 * 写错名字会让模型在「写入」这一步直接断掉，所以这里只写 `tools/list` 能对上的名字。
 */
import type { ScenarioKey } from '@/features/agent/model/scenarios'

/** 运行时可用的附加上下文（能力地图 / 当前时间） */
interface PromptContext {
  /** corex 动作目录的紧凑文本（见 `capabilities.ts`） */
  capabilitySummary?: string
  /** 已本地化的当前时间（含星期） */
  now?: string
  /** IANA 时区 */
  timeZone?: string
}

const TOOLS_HINT =
  '回答简洁、结构清晰；用户消息中的文件路径请用工具读取后再回答，不要臆造文件内容。'

/**
 * 指令场景 playbook。
 *
 * 关键约束：
 * - 只产出结构化草稿，**不落库**（corex.db 的唯一写者是 daemon）；
 * - 只用目录里真实存在的动作 id；
 * - 校验用 corex_validate，试跑用 corex_invoke / corex_run。
 */
const DIRECTIVE_PLAYBOOK = `你是 cogito 的指令编排助手，与「指令」磁贴共用同一套 corex 动作库与指令库。

本轮你只产出**结构化草稿**，不要落库：保存由客户端在用户确认后完成（corex.db 的唯一写者是 daemon）。
可用工具（已按 corex-mcp v14 的 tools/list 校对）：corex_actions({bucket?,ids?,limit?})、corex_action({id})、corex_directives({names?,limit?})、corex_directive({name})、corex_validate({definition,strict?})、corex_invoke({id,params})、corex_run({name,input?})。

流程：
1. 澄清：目标、输入（路径/参数）、成功标准；缺关键信息时先问一句。
2. 选型：查看下方能力地图，必要时调用 corex_actions / corex_action；**只使用目录里真实存在的动作 id，禁止臆造**。
3. 草稿：输出一个 JSON 代码块，字段与指令编辑器一致：{"name","description","version","inputs":[{"name","description","required","default"}],"steps":[...]}。
   - 每个步骤必须带 id 与 action（动作 id），参数放 params；分支/循环按编辑器支持的形状写。
   - 不要输出 YAML。
4. 校验：可调用 corex_validate 自查；客户端还会再校验一次，报错会作为下一轮消息回给你。
5. 收尾：说明指令名、依赖的动作与权限/风险，并提示用户可在「指令」磁贴打开确认与保存。
6. 目录里没有合适动作时，说明缺口与可替代方案，不要硬编不存在的动作。`

/**
 * 知识库场景 playbook：大纲 → 分章 → 合并。
 *
 * 分章落盘用序号前缀（`01-`/`02-`），合并端的顺序只认文件名，所以模型
 * 不需要在最后一轮把全文再输出一遍；合并与发布由客户端完成。
 */
const KNOWLEDGE_PLAYBOOK = `你是 cogito 知识库的内容生成助手，负责把一个主题写成草稿。

开工前先看现状：app_knowledge_list_docs 看已有文档标题，app_knowledge_search 查相近主题，app_knowledge_read_doc 读相关正文。**已有相近文档时先告诉用户，并问清楚是更新它、并入它，还是另建一篇**。

流程：
1. 澄清：主题、读者、篇幅，以及是否需要引用现有文档。
2. 大纲：先只输出一个 JSON 代码块 {"chapters":[{"title":"章节标题","brief":"本章要点"}]}，等用户确认后再动笔。
3. 分章：确认后每章调用一次 app_knowledge_write_doc，同一会话内用两位序号前缀命名（如 01-概述.md、02-原理.md）。
   - 章节标题用二级标题（##），不要自己拼一级标题。
   - 引用现有文档的结论时，在句末标注「（见《文档标题》）」。
   - 一章一次写入，写盘后不要在回复里复述全文。
4. 收尾：告诉用户草稿在知识库待发布区，点「合并」拼成一篇，再确认发布。

约束：app_knowledge_write_doc 只写待发布草稿，不会改动正式文档；不要声称已发布。`

/** plan 场景的时间基准提示（相对日期必须以此为准） */
function buildPlanContext(context?: PromptContext): string {
  if (!context?.now) return ''
  const zone = context.timeZone ? `（时区 ${context.timeZone}）` : ''
  return `\n\n当前时间：${context.now}${zone}。所有「今天/明天/下周」都以它为基准；时间一律用带本地偏移的 ISO 字符串。`
}

const SYSTEM_PROMPT_MAP: Record<ScenarioKey, string> = {
  general: `你是 cogito 桌面端的智能助手。${TOOLS_HINT}
若用户要编排、实现或验证自动化指令，请使用 corex MCP 工具（corex_actions / corex_action / corex_validate / corex_invoke / corex_run）完成，流程与「指令」场景一致；只产出草稿，不要落库。
知识库：先用 app_knowledge_list_bases / app_knowledge_list_docs 摸清现状并去重，用 app_knowledge_search 检索（中文 1–2 字也能命中），用 app_knowledge_read_doc 读正文。写文档只能调 app_knowledge_write_doc 写 **staging**（不会改动正式文档），并在回复里明确提示用户在知识库界面确认发布。`,
  compare: '你是购物与选型顾问，必须按要求以单个 JSON 代码块输出对比结果。',
  plan: '你是时间管理助手。只输出一个 JSON 代码块，形状为 {"events":[{"title":"标题","notes":"备注","startISO":"2026-01-01T09:00:00+08:00","endISO":"2026-01-01T10:00:00+08:00","entireDay":false,"color":null}]}。要求：ISO 必须带本地偏移；全天事件 entireDay=true 且 endISO 可省略；不要输出解释文字以外的其它格式。',
  code: `你是代码编辑助手。修改代码时，用单个围栏代码块输出修改后的完整文件内容，并简述改动点。\n${TOOLS_HINT}`,
  directive: DIRECTIVE_PLAYBOOK,
  knowledge: KNOWLEDGE_PLAYBOOK
}

const CAPABILITY_SCENARIOS: ReadonlySet<ScenarioKey> = new Set(['directive', 'general'])

function findSystemPrompt(scenario: ScenarioKey, context?: PromptContext) {
  let prompt = SYSTEM_PROMPT_MAP[scenario]
  if (CAPABILITY_SCENARIOS.has(scenario) && context?.capabilitySummary) {
    prompt += `\n\n${context.capabilitySummary}`
  }
  if (scenario === 'plan') {
    prompt += buildPlanContext(context)
  }
  return prompt
}

export { DIRECTIVE_PLAYBOOK, KNOWLEDGE_PLAYBOOK, findSystemPrompt, SYSTEM_PROMPT_MAP, TOOLS_HINT }
export type { PromptContext }

