/**
 * 委派长任务的入口与面板：把「跑服务端 agent」这件事从本地 goose 会话里分出去。
 *
 * 入口按钮常驻标题栏 `actions`；面板是一个 Dialog，内容随委派阶段切换——空闲时是提交表单，
 * 提交后是进度，撞到待审批时是审批卡，终态是结论。hook（`useDelegation`）挂在**组件顶层**
 * （不随 Dialog 开合卸载），所以关掉面板轮询继续跑，下次打开还在同一份状态上。
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Spinner } from '@cogito/design/components/spinner'
import { Textarea } from '@cogito/design/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { useState } from 'react'

import { isApprovalPrompting, parseToolArguments, type DelegationPhase } from '@/features/agent/model/delegate'
import { useDelegation } from '@/features/agent/model/use-delegation'

const PHASE_LABELS: Record<DelegationPhase, string> = {
  idle: '未提交',
  submitted: '提交中',
  running: '运行中',
  awaiting_approval: '等待审批',
  settled: '已结束'
}

/** 把「每行一个工具名」的输入拆成数组；空行与空白忽略。 */
function splitTools(raw: string): string[] {
  return raw
    .split(/[\n,，]/)
    .map(function (item) {
      return item.trim()
    })
    .filter(function (item) {
      return item.length > 0
    })
}

function DelegatePanel() {
  const [open, updateOpen] = useState(false)
  const [objective, updateObjective] = useState('')
  const [maxStepsText, updateMaxStepsText] = useState('')
  const [toolsText, updateToolsText] = useState('')
  const { task, phase, decided, error, submit, decide, reset } = useDelegation()

  const hasActiveTask = phase === 'submitted' || phase === 'running' || phase === 'awaiting_approval'

  function handleSubmit() {
    const trimmed = objective.trim()
    if (!trimmed) return
    const maxSteps = maxStepsText.trim()
    const parsedMaxSteps = maxSteps ? Number.parseInt(maxSteps, 10) : undefined
    void submit({
      objective: trimmed,
      maxSteps: Number.isFinite(parsedMaxSteps) ? parsedMaxSteps : undefined,
      tools: splitTools(toolsText).length > 0 ? splitTools(toolsText) : undefined
    })
  }

  function handleReset() {
    reset()
    updateObjective('')
    updateMaxStepsText('')
    updateToolsText('')
  }

  function renderBody() {
    if (phase === 'submitted') {
      return (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner />
          正在提交任务…
        </div>
      )
    }

    if (!task) {
      return (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="delegate-objective">任务目标 *</Label>
            <Textarea
              id="delegate-objective"
              value={objective}
              placeholder="例如：把本租户的产品手册总结成一段话，需要改可见性时先问我"
              onChange={function (event) {
                updateObjective(event.target.value)
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="delegate-max-steps">轮次上限</Label>
              <Input
                id="delegate-max-steps"
                inputMode="numeric"
                value={maxStepsText}
                placeholder="缺省用服务端配置"
                onChange={function (event) {
                  updateMaxStepsText(event.target.value)
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="delegate-tools">工具白名单</Label>
              <Input
                id="delegate-tools"
                value={toolsText}
                placeholder="每行或逗号分隔；留空用服务端配置"
                onChange={function (event) {
                  updateToolsText(event.target.value)
                }}
              />
            </div>
          </div>
        </div>
      )
    }

    // 有待审批、且这条没决定过 → 审批卡；否则按 running 展示进度。
    const prompting = isApprovalPrompting(task, decided)
    if (prompting && task.pendingApproval) {
      const pending = task.pendingApproval
      return (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Badge variant="secondary" className="w-fit">
              第 {pending.step} 轮 · 工具 {pending.tool}
            </Badge>
            <p className="text-sm">
              模型想在服务端执行一次「{pending.tool}」，需要你批准才会真的执行：
            </p>
          </div>
          <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 text-xs">
            {JSON.stringify(parseToolArguments(pending.arguments), null, 2)}
          </pre>
          <p className="text-xs text-muted-foreground">
            逾期时间：{new Date(pending.expiresAt).toLocaleString()}
          </p>
        </div>
      )
    }

    if (phase === 'settled') {
      const result = task.result as { answer?: string } | null
      const answer = result?.answer
      return (
        <div className="grid gap-3">
          <Badge variant={task.status === 'SUCCEEDED' ? 'success' : 'destructive'} className="w-fit">
            {task.status === 'SUCCEEDED' ? '成功' : '失败'}
          </Badge>
          {answer ? (
            <div className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{answer}</div>
          ) : null}
          {task.error ? <p className="text-sm text-destructive">{task.error}</p> : null}
        </div>
      )
    }

    return (
      <div className="grid gap-2">
        <Badge variant="secondary" className="w-fit">
          运行中
        </Badge>
        <p className="text-sm text-muted-foreground">
          {task.progress ?? `step:${task.steps}/${task.maxSteps}`}
        </p>
        <p className="max-h-32 overflow-auto whitespace-pre-wrap text-sm">{task.objective}</p>
      </div>
    )
  }

  function renderFooter() {
    if (phase === 'submitted') return null
    if (!task || phase === 'idle') {
      return (
        <DialogFooter>
          <Button
            variant="outline"
            onClick={function () {
              updateOpen(false)
            }}>
            取消
          </Button>
          <Button disabled={!objective.trim()} onClick={handleSubmit}>
            提交
          </Button>
        </DialogFooter>
      )
    }
    if (phase === 'settled') {
      return (
        <DialogFooter>
          <Button variant="outline" onClick={handleReset}>
            再来一个
          </Button>
          <Button
            onClick={function () {
              updateOpen(false)
            }}>
            关闭
          </Button>
        </DialogFooter>
      )
    }
    if (phase === 'awaiting_approval') {
      const pending = task.pendingApproval
      const prompting = pending && isApprovalPrompting(task, decided)
      if (prompting && pending) {
        return (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={function () {
                void decide(pending.approvalID, { decision: 'REJECTED' })
              }}>
              驳回
            </Button>
            <Button
              onClick={function () {
                void decide(pending.approvalID, { decision: 'APPROVED' })
              }}>
              批准执行
            </Button>
          </DialogFooter>
        )
      }
      return null
    }
    return null
  }

  return (
    <Dialog
      open={open}
      onOpenChange={updateOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-region="false"
              aria-label="委派到服务端"
              className="text-muted-foreground relative size-7"
              onClick={function () {
                updateOpen(true)
              }}
            />
          }>
          <Icon
            icon="lucide:server"
            className="size-3.5"
          />
          {hasActiveTask ? (
            <span
              className="bg-primary absolute end-0.5 top-0.5 size-1.5 rounded-full"
              aria-hidden
            />
          ) : null}
        </TooltipTrigger>
        <TooltipContent side="bottom">委派到服务端</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>委派到服务端</DialogTitle>
          <DialogDescription>
            交给 cogito 的服务端 agent 跑长任务：它会自己分步调用工具，需要人工审批的动作会在这里等你决定。
          </DialogDescription>
        </DialogHeader>

        {task ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline">{PHASE_LABELS[phase]}</Badge>
            <span className="truncate text-xs text-muted-foreground">{task.objective}</span>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {renderBody()}
        {renderFooter()}
      </DialogContent>
    </Dialog>
  )
}

export { DelegatePanel }
