import {
  parseActions,
  parseCondition,
  type AutomationAction
} from '@/features/signboard/automation'
import type {
  SignboardAutomation,
  SignboardColumn,
  SignboardTag
} from '@/stores/signboard'

const TRIGGER_OPTIONS = [
  { value: 'entryEnterColumn', label: '进入某列' },
  { value: 'entryLeaveColumn', label: '离开某列' },
  { value: 'entryDueSet', label: '设置到期日' },
  { value: 'entryCreated', label: '创建卡片' }
] as const

const ACTION_OPTIONS = [
  { value: 'setPriority', label: '设置优先级' },
  { value: 'setDueOffsetDays', label: '设置到期偏移（天）' },
  { value: 'attachTag', label: '附加标签' },
  { value: 'archiveCard', label: '归档卡片' },
  { value: 'setColor', label: '设置颜色' }
] as const

type ActionKind = (typeof ACTION_OPTIONS)[number]['value']

interface AutomationDraft {
  title: string
  trigger: string
  toColumnID: string
  fromColumnID: string
  actionType: ActionKind
  priority: string
  dueOffsetDays: string
  tagID: string
  color: string
  enabled: boolean
}

function emptyAutomationDraft(): AutomationDraft {
  return {
    title: '',
    trigger: 'entryEnterColumn',
    toColumnID: '',
    fromColumnID: '',
    actionType: 'setPriority',
    priority: '0',
    dueOffsetDays: '3',
    tagID: '',
    color: '',
    enabled: true
  }
}

function buildConditionJson(draft: AutomationDraft) {
  const condition: Record<string, string> = {}
  if (draft.toColumnID) condition.toColumnID = draft.toColumnID
  if (draft.fromColumnID) condition.fromColumnID = draft.fromColumnID
  return JSON.stringify(condition)
}

function buildActionJson(draft: AutomationDraft): string {
  let action: AutomationAction
  switch (draft.actionType) {
    case 'setPriority':
      action = { type: 'setPriority', priority: Number(draft.priority) || 0 }
      break
    case 'setDueOffsetDays':
      action = { type: 'setDueOffsetDays', days: Number(draft.dueOffsetDays) || 0 }
      break
    case 'attachTag':
      action = { type: 'attachTag', tagID: draft.tagID }
      break
    case 'archiveCard':
      action = { type: 'archiveCard' }
      break
    case 'setColor':
      action = { type: 'setColor', color: draft.color || null }
      break
  }
  return JSON.stringify([action])
}

function summarizeAutomationRule(
  rule: SignboardAutomation,
  columns: SignboardColumn[],
  tags: SignboardTag[]
) {
  const trigger =
    TRIGGER_OPTIONS.find(function (row) {
      return row.value === rule.trigger
    })?.label ?? rule.trigger
  const condition = parseCondition(rule.conditionJson)
  const actions = parseActions(rule.actionJson)
  const parts: string[] = [trigger]
  if (condition.toColumnID) {
    const column = columns.find(function (row) {
      return row.id === condition.toColumnID
    })
    if (column) parts.push(`→ ${column.title}`)
  }
  if (condition.fromColumnID) {
    const column = columns.find(function (row) {
      return row.id === condition.fromColumnID
    })
    if (column) parts.push(`← ${column.title}`)
  }
  const first = actions[0]
  if (first) {
    if (first.type === 'attachTag') {
      const tag = tags.find(function (row) {
        return row.id === first.tagID
      })
      parts.push(tag ? `标签 ${tag.title}` : '附加标签')
    } else if (first.type === 'setPriority') {
      parts.push(`优先级 ${first.priority}`)
    } else if (first.type === 'setDueOffsetDays') {
      parts.push(`到期 +${first.days} 天`)
    } else if (first.type === 'archiveCard') {
      parts.push('归档')
    } else if (first.type === 'setColor') {
      parts.push('设色')
    }
  }
  return parts.join(' · ')
}

function fillAutomationDraft(rule: SignboardAutomation): AutomationDraft {
  const condition = parseCondition(rule.conditionJson)
  const actions = parseActions(rule.actionJson)
  const first = actions[0]
  const next = emptyAutomationDraft()
  next.title = rule.title
  next.trigger = rule.trigger
  next.toColumnID = condition.toColumnID ?? ''
  next.fromColumnID = condition.fromColumnID ?? ''
  next.enabled = rule.enabled
  if (first) {
    next.actionType = first.type
    if (first.type === 'setPriority') next.priority = String(first.priority)
    if (first.type === 'setDueOffsetDays') next.dueOffsetDays = String(first.days)
    if (first.type === 'attachTag') next.tagID = first.tagID
    if (first.type === 'setColor') next.color = first.color ?? ''
  }
  return next
}

export {
  ACTION_OPTIONS,
  TRIGGER_OPTIONS,
  buildActionJson,
  buildConditionJson,
  emptyAutomationDraft,
  fillAutomationDraft,
  summarizeAutomationRule
}
export type { ActionKind, AutomationDraft }
