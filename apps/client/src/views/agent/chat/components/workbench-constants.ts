import type { ScenarioKey } from '@/features/agent/model/scenarios'

/** 携带的历史消息上限，防止长会话撑爆上下文 */
const CONTEXT_MESSAGE_LIMIT = 20

const TOOLS_HINT =
  '回答简洁、结构清晰；用户消息中的文件路径请用工具读取后再回答，不要臆造文件内容。'

const SYSTEM_PROMPT_MAP: Record<ScenarioKey, string> = {
  general: `你是 i-thinking 桌面端的智能助手，回答简洁、结构清晰，涉及代码时使用围栏代码块输出。\n${TOOLS_HINT}`,
  compare: '你是购物与选型顾问，必须按要求以单个 JSON 代码块输出对比结果。',
  plan: '你是时间管理助手，必须按要求以单个 JSON 代码块输出日程计划。',
  code: `你是代码编辑助手。修改代码时，用单个围栏代码块输出修改后的完整文件内容，并简述改动点。\n${TOOLS_HINT}`
}

function findSystemPrompt(scenario: ScenarioKey) {
  return SYSTEM_PROMPT_MAP[scenario]
}

interface QuickPrompt {
  key: string
  scenario: ScenarioKey
  label: string
  description: string
  icon: string
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    key: 'compare',
    scenario: 'compare',
    label: '对比两款适合办公编程的笔记本，预算五到六千',
    description: '购物选型场景，输出结构化对比表',
    icon: 'lucide:shopping-cart'
  },
  {
    key: 'plan',
    scenario: 'plan',
    label: '为我制定明天的工作与休息日程',
    description: '规划一天安排，支持一键写入日历',
    icon: 'lucide:calendar'
  },
  {
    key: 'general',
    scenario: 'general',
    label: '总结我附加文件的核心内容',
    description: '附加本地文件后进行分析和摘要',
    icon: 'lucide:file-text'
  },
  {
    key: 'code',
    scenario: 'code',
    label: '帮我梳理这段代码的结构并指出可改进点',
    description: '代码阅读与重构建议',
    icon: 'lucide:code'
  }
]

export { CONTEXT_MESSAGE_LIMIT, findSystemPrompt, QUICK_PROMPTS }
export type { QuickPrompt }
