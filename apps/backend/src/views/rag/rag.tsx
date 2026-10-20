import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'
import { toast } from 'sonner'

import { GET_RAG_INDEX_TASK, type RagIndexTask } from '@/apis/rag.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
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
      updateTask(null)
      toast.error(HttpError(error).message)
    } finally {
      updateLoading(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="RAG 索引"
        description="按索引任务 ID 查询进度与结果。"
      />
      <div className="mb-4 flex max-w-xl gap-2">
        <Input
          placeholder="index-task id"
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
        <pre className="overflow-auto rounded-xl border border-border/80 bg-background p-4 text-xs">
          {JSON.stringify(task, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
