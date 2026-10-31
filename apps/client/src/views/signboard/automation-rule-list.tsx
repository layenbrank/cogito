import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Label } from '@cogito/design/components/label'
import { Switch } from '@cogito/design/components/switch'

import type { SignboardAutomation, SignboardColumn, SignboardTag } from '@/stores/signboard'
import { summarizeAutomationRule } from '@/views/signboard/automation-sheet-drafts.ts'
import styles from '@/views/signboard/signboard.module.scss'

interface AutomationRuleListProps {
  rules: SignboardAutomation[]
  columns: SignboardColumn[]
  tags: SignboardTag[]
  onToggleEnabled: (ruleID: string, enabled: boolean) => void
  onEdit: (rule: SignboardAutomation) => void
  onRemove: (ruleID: string) => void
}

function AutomationRuleList(props: AutomationRuleListProps) {
  return (
    <div className="space-y-2">
      <Label>已有规则</Label>
      {props.rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无规则，创建后在移动/更新卡片时生效。</p>
      ) : (
        <ul className={styles.automationList}>
          {props.rules.map(function (rule) {
            return (
              <li
                key={rule.id}
                className={styles.automationItem}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {summarizeAutomationRule(rule, props.columns, props.tags)}
                  </p>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={function (checked) {
                    props.onToggleEnabled(rule.id, checked)
                  }}
                />
                <Button
                  type="button"
                  size="icon-lg"
                  variant="ghost"
                  aria-label="编辑"
                  onClick={function () {
                    props.onEdit(rule)
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
                    props.onRemove(rule.id)
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
  )
}

export { AutomationRuleList }
