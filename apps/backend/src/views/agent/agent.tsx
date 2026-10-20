import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { useState } from 'react'
import { toast } from 'sonner'

import { GET_AGENT_TASK, type AgentTask } from '@/apis/agent.ts'
import { PageHeader } from '@/components/data-table/page-header.tsx'
import { HttpError } from '@/utils/http/errors.ts'

export default function AgentView() {
  const [taskID, updateTaskID] = useState('')
  const [task, updateTask] = useState<AgentTask | null>(null)
  const [isLoading, updateLoading] = useState(false)

  async function loadTask() {
    if (!taskID.trim()) {
      toast.error('填写任务 ID')
      return
    }
    updateLoading(true)
    try {
      updateTask(await GET_AGENT_TASK(taskID.trim()))
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
        title="Agent 任务"
        description="按任务 ID 查询服务端 durable agent 状态（运维只读入口）。"
      />
      <div className="mb-4 flex max-w-xl gap-2">
        <Input
          placeholder="task id"
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
