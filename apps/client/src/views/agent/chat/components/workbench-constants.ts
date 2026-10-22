import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { findSystemPrompt } from '@/features/agent/model/prompts'

/** 携带的历史消息上限，防止长会话撑爆上下文 */
const CONTEXT_MESSAGE_LIMIT = 20

interface QuickPrompt {
  key: string
  scenario: ScenarioKey
  label: string
  description: string
  icon: string
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    key: 'directive',
    scenario: 'directive',
    label: '根据这段描述实现一条指令并验证能否跑通',
    description: '用 corex 动作库一键编排、校验并试跑',
    icon: 'lucide:workflow'
  },
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
