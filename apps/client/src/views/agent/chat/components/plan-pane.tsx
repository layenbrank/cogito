/**
 * 右侧 Plan 面板：展示结构化计划，勾选 / 写日历 / 关闭
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Checkbox } from '@i-thinking/design/components/checkbox'
import { Spinner } from '@i-thinking/design/components/spinner'
import { useState } from 'react'

import styles from './plan-pane.module.scss'
import type { PlanPartData } from '@/features/agent/types'

interface PlanPaneSource {
  messageID: string
  partIndex: number
  data: PlanPartData
}

interface PlanPaneProps {
  className?: string
  source: PlanPaneSource | null
  onClose: () => void
  onToggleItem: (itemIndex: number) => void
  onWriteCalendar: () => Promise<void>
}

function AgentPlanPane(props: PlanPaneProps) {
  const [writing, updateWriting] = useState(false)
  const data = props.source?.data ?? null

  return (
    <div className={props.className ?? styles.root}>
      <div className={`${styles.header} flex items-center justify-between`}>
        <span className="text-sm font-medium">计划</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭计划面板"
          onClick={props.onClose}>
          <Icon icon="lucide:x" />
        </Button>
      </div>
      <div className={styles.body}>
        {data ? (
          <div className="border-border bg-card flex flex-col gap-2 rounded-lg border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">日程计划</span>
              {data.date && <Badge variant="secondary">{data.date}</Badge>}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                disabled={writing}
                onClick={async function () {
                  updateWriting(true)
                  try {
                    await props.onWriteCalendar()
                  } finally {
                    updateWriting(false)
                  }
                }}>
                {writing ? <Spinner /> : <Icon icon="lucide:calendar" />}
                写入日历
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {data.items.map(function (item, itemIndex) {
                return (
                  <label
                    key={`${item.time ?? ''}-${item.title}`}
                    className="flex items-center gap-2">
                    <Checkbox
                      checked={Boolean(item.done)}
                      onCheckedChange={function () {
                        props.onToggleItem(itemIndex)
                      }}
                    />
                    {item.time && <Badge variant="outline">{item.time}</Badge>}
                    <span
                      className={item.done ? 'text-muted-foreground text-sm line-through' : 'text-sm'}>
                      {item.title}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground px-4 py-12 text-center text-sm">
            规划场景生成计划后会显示在这里
          </div>
        )}
      </div>
    </div>
  )
}

export { AgentPlanPane }
export type { PlanPaneSource }
