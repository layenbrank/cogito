import type { ScenarioKey } from '@/features/agent/model/scenarios'
import { findSystemPrompt } from '@/features/agent/model/prompts'

/** 携带的历史消息上限，防止长会话撑爆上下文 */
const CONTEXT_MESSAGE_LIMIT = 20

interface QuickPrompt {
  key: string
  scenario: ScenarioKey
  /** 写入输入框的提示词 */
  label: string
  /** 卡片上的短标题；完整提示词进 tooltip */
  title: string
  icon: string
}

const QUICK_PROMPTS: QuickPrompt[] = [
  {
    key: 'directive',
    scenario: 'directive',
    title: '编排指令',
    label: '根据这段描述实现一条指令并验证能否跑通',
    icon: 'lucide:workflow'
  },
  {
    key: 'compare',
    scenario: 'compare',
    title: '购物对比',
    label: '对比两款适合办公编程的笔记本，预算五到六千',
    icon: 'lucide:shopping-cart'
  },
  {
    key: 'plan',
    scenario: 'plan',
    title: '日程规划',
    label: '为我制定明天的工作与休息日程',
    icon: 'lucide:calendar'
  },
  {
    key: 'general',
    scenario: 'general',
    title: '文件摘要',
    label: '总结我附加文件的核心内容',
    icon: 'lucide:file-text'
  },
  {
    key: 'code',
    scenario: 'code',
    title: '代码梳理',
    label: '帮我梳理这段代码的结构并指出可改进点',
    icon: 'lucide:code'
  }
]

export { CONTEXT_MESSAGE_LIMIT, findSystemPrompt, QUICK_PROMPTS }
export type { QuickPrompt }
