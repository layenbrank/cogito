interface AutomationCondition {
  fromColumnID?: string
  toColumnID?: string
  tagID?: string
}

type AutomationAction =
  | { type: 'setPriority'; priority: number }
  | { type: 'setDueOffsetDays'; days: number }
  | { type: 'attachTag'; tagID: string }
  | { type: 'archiveCard' }
  | { type: 'setColor'; color: string | null }

interface AutomationRule {
  id: string
  enabled: boolean
  trigger: string
  conditionJson: string
  actionJson: string
}

interface AutomationEvent {
  trigger: 'entryEnterColumn' | 'entryLeaveColumn' | 'entryDueSet' | 'entryCreated'
  entryID: string
  fromColumnID?: string
  toColumnID?: string
  tagIDs?: string[]
}

function parseCondition(raw: string): AutomationCondition {
  try {
    return JSON.parse(raw) as AutomationCondition
  } catch {
    return {}
  }
}

function parseActions(raw: string): AutomationAction[] {
  try {
    const parsed = JSON.parse(raw) as AutomationAction[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function matchesCondition(event: AutomationEvent, condition: AutomationCondition) {
  if (condition.fromColumnID && condition.fromColumnID !== event.fromColumnID) return false
  if (condition.toColumnID && condition.toColumnID !== event.toColumnID) return false
  if (condition.tagID && !(event.tagIDs ?? []).includes(condition.tagID)) return false
  return true
}

function applyRules(event: AutomationEvent, rules: AutomationRule[]) {
  const matched: { ruleID: string; actions: AutomationAction[] }[] = []
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (rule.trigger !== event.trigger) continue
    const condition = parseCondition(rule.conditionJson)
    if (!matchesCondition(event, condition)) continue
    const actions = parseActions(rule.actionJson)
    if (actions.length === 0) continue
    matched.push({ ruleID: rule.id, actions })
  }
  return matched
}

export type { AutomationAction, AutomationCondition, AutomationEvent, AutomationRule }
export { applyRules, parseActions, parseCondition }
