import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Switch } from '@cogito/design/components/switch'

import type { SignboardColumn, SignboardTag } from '@/stores/signboard'
import {
  ACTION_OPTIONS,
  TRIGGER_OPTIONS,
  type AutomationDraft
} from '@/views/signboard/automation-sheet-drafts.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface AutomationRuleFormProps {
  draft: AutomationDraft
  editingID: string | null
  columns: SignboardColumn[]
  tags: SignboardTag[]
  onDraftChange: (updater: (prev: AutomationDraft) => AutomationDraft) => void
  onSave: () => void
  onReset: () => void
}

function AutomationRuleForm(props: AutomationRuleFormProps) {
  const draft = props.draft

  return (
    <div className={styles.automationForm}>
      <p className="text-sm font-medium">{props.editingID ? '编辑规则' : '新建规则'}</p>

      <div className="space-y-2">
        <Label htmlFor="auto-title">名称</Label>
        <Input
          id="auto-title"
          value={draft.title}
          placeholder="例如：进入完成列降优先级"
          onChange={function (event) {
            props.onDraftChange(function (prev) {
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
            props.onDraftChange(function (prev) {
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
              props.onDraftChange(function (prev) {
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
            props.onDraftChange(function (prev) {
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
              props.onDraftChange(function (prev) {
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
              props.onDraftChange(function (prev) {
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
              props.onDraftChange(function (prev) {
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
              props.onDraftChange(function (prev) {
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
            props.onDraftChange(function (prev) {
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
          onClick={props.onSave}>
          {props.editingID ? '保存修改' : '创建规则'}
        </Button>
        {props.editingID ? (
          <Button
            type="button"
            size="lg"
            variant="ghost"
            onClick={props.onReset}>
            取消
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export { AutomationRuleForm }
