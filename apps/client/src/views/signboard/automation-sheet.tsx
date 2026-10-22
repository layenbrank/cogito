import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Sheet, SheetContent, SheetTitle } from '@i-thinking/design/components/sheet'
import { Switch } from '@i-thinking/design/components/switch'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import {
  parseActions,
  parseCondition,
  type AutomationAction
} from '@/features/signboard/automation'
import {
  useSignboardStore,
  type SignboardAutomation,
  type SignboardColumn,
  type SignboardTag
} from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface AutomationSheetProps {
  open: boolean
  onUpdateOpen: (open: boolean) => void
  boardID: string | null
  columns: SignboardColumn[]
  tags: SignboardTag[]
}

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

interface Draft {
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

function emptyDraft(): Draft {
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

function buildConditionJson(draft: Draft) {
  const condition: Record<string, string> = {}
  if (draft.toColumnID) condition.toColumnID = draft.toColumnID
  if (draft.fromColumnID) condition.fromColumnID = draft.fromColumnID
  return JSON.stringify(condition)
}

function buildActionJson(draft: Draft): string {
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

function summarizeRule(rule: SignboardAutomation, columns: SignboardColumn[], tags: SignboardTag[]) {
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

function AutomationSheet(props: AutomationSheetProps) {
  const automations = useSignboardStore(function (state) {
    return state.automations
  })
  const toWriteAutomation = useSignboardStore(function (state) {
    return state.toWriteAutomation
  })
  const toUpdateAutomation = useSignboardStore(function (state) {
    return state.toUpdateAutomation
  })
  const toRemoveAutomation = useSignboardStore(function (state) {
    return state.toRemoveAutomation
  })

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingID, setEditingID] = useState<string | null>(null)

  const ordered = useMemo(
    function () {
      return automations.slice().sort(function (a, b) {
        return a.index - b.index
      })
    },
    [automations]
  )

  function resetForm() {
    setDraft(emptyDraft())
    setEditingID(null)
  }

  function loadRule(rule: SignboardAutomation) {
    const condition = parseCondition(rule.conditionJson)
    const actions = parseActions(rule.actionJson)
    const first = actions[0]
    const next = emptyDraft()
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
    setDraft(next)
    setEditingID(rule.id)
  }

  async function saveRule() {
    if (!props.boardID) return
    const title = draft.title.trim() || '未命名规则'
    if (draft.actionType === 'attachTag' && !draft.tagID) {
      toast.error('请选择要附加的标签')
      return
    }
    const payload = {
      title,
      enabled: draft.enabled,
      trigger: draft.trigger,
      conditionJson: buildConditionJson(draft),
      actionJson: buildActionJson(draft)
    }
    if (editingID) {
      const ok = await toUpdateAutomation(editingID, payload)
      if (!ok) {
        toast.error('更新规则失败')
        return
      }
      toast.success('已更新规则')
    } else {
      const id = await toWriteAutomation({ boardID: props.boardID, ...payload })
      if (!id) {
        toast.error('创建规则失败')
        return
      }
      toast.success('已创建规则')
    }
    resetForm()
  }

  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <SheetContent
        side="right"
        showCloseButton
        overlayClassName="bg-black/20 supports-backdrop-filter:backdrop-blur-xs"
        className="w-[min(420px,94vw)] gap-0 overflow-y-auto sm:max-w-none">
        <SheetTitle className="mb-4 text-lg">自动化规则</SheetTitle>

        <div className={styles.sheetSection}>
          <div className="space-y-2">
            <Label>已有规则</Label>
            {ordered.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无规则，创建后在移动/更新卡片时生效。</p>
            ) : (
              <ul className={styles.automationList}>
                {ordered.map(function (rule) {
                  return (
                    <li
                      key={rule.id}
                      className={styles.automationItem}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{rule.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {summarizeRule(rule, props.columns, props.tags)}
                        </p>
                      </div>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={function (checked) {
                          void toUpdateAutomation(rule.id, { enabled: checked })
                        }}
                      />
                      <Button
                        type="button"
                        size="icon-lg"
                        variant="ghost"
                        aria-label="编辑"
                        onClick={function () {
                          loadRule(rule)
                        }}>
                        <Icon
                          icon="lucide:pencil"
                          className="size-4"
                        />
                      </Button>
                      <Button
                        type="button"
                        size="icon-lg"
                        variant="ghost"
                        aria-label="删除"
                        onClick={function () {
                          void toRemoveAutomation(rule.id).then(function (ok) {
                            if (!ok) toast.error('删除失败')
                            else toast.success('已删除')
                          })
                        }}>
                        <Icon
                          icon="lucide:trash-2"
                          className="size-4"
                        />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className={styles.automationForm}>
            <p className="text-sm font-medium">{editingID ? '编辑规则' : '新建规则'}</p>

            <div className="space-y-2">
              <Label htmlFor="auto-title">名称</Label>
              <Input
                id="auto-title"
                value={draft.title}
                placeholder="例如：进入完成列降优先级"
                onChange={function (event) {
                  setDraft(function (prev) {
                    return { ...prev, title: event.target.value }
                  })
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>触发</Label>
              <Select
                items={TRIGGER_OPTIONS.map(function (row) {
                  return { value: row.value, label: row.label }
                })}
                value={draft.trigger}
                onValueChange={function (value) {
                  if (value === null) return
                  setDraft(function (prev) {
                    return { ...prev, trigger: value }
                  })
                }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map(function (row) {
                    return (
                      <SelectItem
                        key={row.value}
                        value={row.value}>
                        {row.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {(draft.trigger === 'entryEnterColumn' || draft.trigger === 'entryLeaveColumn') && (
              <div className="space-y-2">
                <Label>{draft.trigger === 'entryEnterColumn' ? '目标列' : '来源列'}</Label>
                <Select
                  items={[
                    { value: '__any__', label: '任意列' },
                    ...props.columns.map(function (column) {
                      return { value: column.id, label: column.title }
                    })
                  ]}
                  value={
                    (draft.trigger === 'entryEnterColumn' ? draft.toColumnID : draft.fromColumnID) ||
                    '__any__'
                  }
                  onValueChange={function (value) {
                    if (value === null) return
                    const next = value === '__any__' ? '' : value
                    setDraft(function (prev) {
                      if (prev.trigger === 'entryEnterColumn') {
                        return { ...prev, toColumnID: next }
                      }
                      return { ...prev, fromColumnID: next }
                    })
                  }}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="任意列" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">任意列</SelectItem>
                    {props.columns.map(function (column) {
                      return (
                        <SelectItem
                          key={column.id}
                          value={column.id}>
                          {column.title}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>动作</Label>
              <Select
                items={ACTION_OPTIONS.map(function (row) {
                  return { value: row.value, label: row.label }
                })}
                value={draft.actionType}
                onValueChange={function (value) {
                  if (value === null) return
                  const matched = ACTION_OPTIONS.find(function (row) {
                    return row.value === value
                  })
                  if (!matched) return
                  setDraft(function (prev) {
                    return { ...prev, actionType: matched.value }
                  })
                }}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map(function (row) {
                    return (
                      <SelectItem
                        key={row.value}
                        value={row.value}>
                        {row.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>

            {draft.actionType === 'setPriority' ? (
              <div className="space-y-2">
                <Label>优先级</Label>
                <Select
                  items={[
                    { value: '0', label: '无' },
                    { value: '1', label: '低' },
                    { value: '2', label: '中' },
                    { value: '3', label: '高' },
                    { value: '4', label: '紧急' }
                  ]}
                  value={draft.priority}
                  onValueChange={function (value) {
                    if (value === null) return
                    setDraft(function (prev) {
                      return { ...prev, priority: value }
                    })
                  }}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['无', '低', '中', '高', '紧急'].map(function (label, index) {
                      return (
                        <SelectItem
                          key={label}
                          value={String(index)}>
                          {label}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {draft.actionType === 'setDueOffsetDays' ? (
              <div className="space-y-2">
                <Label htmlFor="auto-due-offset">天数偏移</Label>
                <Input
                  id="auto-due-offset"
                  type="number"
                  value={draft.dueOffsetDays}
                  onChange={function (event) {
                    setDraft(function (prev) {
                      return { ...prev, dueOffsetDays: event.target.value }
                    })
                  }}
                />
              </div>
            ) : null}

            {draft.actionType === 'attachTag' ? (
              <div className="space-y-2">
                <Label>标签</Label>
                <Select
                  items={props.tags.map(function (tag) {
                    return { value: tag.id, label: tag.title }
                  })}
                  value={draft.tagID || null}
                  onValueChange={function (value) {
                    if (value === null) return
                    setDraft(function (prev) {
                      return { ...prev, tagID: value }
                    })
                  }}>
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue placeholder="选择标签" />
                  </SelectTrigger>
                  <SelectContent>
                    {props.tags.map(function (tag) {
                      return (
                        <SelectItem
                          key={tag.id}
                          value={tag.id}>
                          {tag.title}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {draft.actionType === 'setColor' ? (
              <div className="space-y-2">
                <Label htmlFor="auto-color">颜色</Label>
                <Input
                  id="auto-color"
                  value={draft.color}
                  placeholder="#hex 或留空清除"
                  onChange={function (event) {
                    setDraft(function (prev) {
                      return { ...prev, color: event.target.value }
                    })
                  }}
                />
              </div>
            ) : null}

            <div className={styles.sheetRow}>
              <Label htmlFor="auto-enabled">启用</Label>
              <Switch
                id="auto-enabled"
                checked={draft.enabled}
                onCheckedChange={function (checked) {
                  setDraft(function (prev) {
                    return { ...prev, enabled: checked }
                  })
                }}
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                size="lg"
                className="flex-1"
                onClick={function () {
                  void saveRule()
                }}>
                {editingID ? '保存修改' : '创建规则'}
              </Button>
              {editingID ? (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={resetForm}>
                  取消
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AutomationSheet }
