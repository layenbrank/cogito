import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { useState } from 'react'
import { toast } from 'sonner'

import { GET_RAG_INDEX_TASK, type RagIndexTask } from '@/apis/rag.ts'
import { ConsolePage } from '@/components/console/console-page.tsx'
import { findFieldLabel, formatFieldValue } from '@/components/console/field-label.ts'
import { StatusBadge } from '@/components/console/status-badge.tsx'
import { reportCaught } from '@/utils/exception-report.ts'
import { HttpError } from '@/utils/http/errors.ts'

export default function RagView() {
  const [taskID, updateTaskID] = useState('')
  const [task, updateTask] = useState<RagIndexTask | null>(null)
  const [isLoading, updateLoading] = useState(false)

  async function loadTask() {
    if (!taskID.trim()) {
      toast.error('填写任务 ID')
      return
    }
    updateLoading(true)
    try {
      updateTask(await GET_RAG_INDEX_TASK(taskID.trim()))
    } catch (error) {
      reportCaught('rag.loadTask', error)
      updateTask(null)
      toast.error(HttpError(error).message)
    } finally {
      updateLoading(false)
    }
  }

  return (
    <ConsolePage bare>
      <div className="mb-4 flex max-w-xl gap-2">
        <Input
          placeholder="索引任务 ID"
          value={taskID}
          onChange={function (event) {
            updateTaskID(event.target.value)
          }}
        />
        <Button
          disabled={isLoading}
          onClick={function () {
            void loadTask()
          }}>
          查询
        </Button>
      </div>
      {task ? (
        <div
          className="space-y-3 rounded-xl border border-border/80 bg-[var(--backend-surface)] p-4 text-sm"
          style={{ boxShadow: 'var(--backend-elevation-1)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
            {'status' in task && typeof task.status === 'string' ? (
              <StatusBadge status={task.status} />
            ) : null}
          </div>
          <dl className="grid gap-2 sm:grid-cols-2">
            {Object.entries(task).map(function ([key, value]) {
              if (key === 'id' || key === 'status') return null
              return (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{findFieldLabel(key)}</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs">{formatFieldValue(value)}</dd>
                </div>
              )
            })}
          </dl>
        </div>
      ) : null}
    </ConsolePage>
  )
}
