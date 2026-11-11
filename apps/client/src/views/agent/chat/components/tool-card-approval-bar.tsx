/**
 * 工具卡的审批条：ACP 的 `tool-approval-request` → `elements/approval-card`。
 *
 * 之前是 Confirmation 原语拼的一条紧凑内联行（盾牌 + prompt + 按钮）：命令、范围、
 * 拒绝后的回执全挤在一行里，读不出「这一步到底要做什么」。现在换成元素页那张纸卡 ——
 * 图标块 + 标题 / 副标题 + 等宽命令面板 + 右对齐动作按钮；答完之后 footer 变收据
 * （执行中 / 已完成 / 已拒绝），卡片留在原位。
 *
 * 通道没变：中途审批只走 `chatModelPort.respondToApproval`。assistant-ui 自己的
 * `respondToApproval` 在 run 仍在进行时会抛「Tried to respond to a tool approval
 * while a run is in progress」。
 *
 * 档位映射：ACP 最多四档（allow-once / allow-always / reject-once / reject-always），
 * 卡片三段 + `extraActions` —— 主按钮 ← allow-once、次级 ← allow-always、
 * Deny ← reject-once（没有就 reject-always），剩下的那档拒绝插在 Deny 左侧。
 * 宿主一个档位都没声明时退回二元回答（拒绝 / 允许一次），optionId 由 ACP 层按类别挑。
 */
import type { ToolApprovalOption, ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { ApprovalCard, type ApprovalCardAction } from '@cogito/design/assistant/approval-card'
import { toApprovalState } from '@cogito/design/assistant/approval-card-state'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { useState } from 'react'
import { toast } from 'sonner'

import { chatModelPort } from '@/features/agent/port/instance'
import { isShellTool, isWriteTool, toAgentToolLabel } from '@/features/agent/tool-labels'
import { summarize } from '@/views/agent/chat/components/tool-card-format'
import { toShellCommand } from '@/views/agent/chat/components/tool-output'

type ApprovalBarProps = Pick<
  ToolCallMessagePartProps,
  'approval' | 'args' | 'result' | 'toolCallId' | 'toolName'
>

/**
 * 四档权限选项的兜底文案。
 * ACP 层已经把人话标签放进 `option.label`（goose 常把 kind 原样塞进 name），
 * 这里只兜住「label 也缺失」的情况。
 */
const APPROVAL_OPTION_LABELS: Record<string, string> = {
  'allow-once': '允许一次',
  'allow-always': '始终允许',
  'reject-once': '拒绝一次',
  'reject-always': '始终拒绝'
}

function findOption(
  options: readonly ToolApprovalOption[] | undefined,
  kind: string
): ToolApprovalOption | undefined {
  return options?.find(function (option) {
    return option.kind === kind
  })
}

function isRejectKind(kind: string): boolean {
  return kind === 'reject-once' || kind === 'reject-always'
}

function findOptionLabel(option: ToolApprovalOption): string {
  // 先认宿主给的文案：ACP 层已经把 kind 换成人话，但「这次别再问我」这类自定义说法要留住
  const raw = option.label?.trim()
  if (raw && !/^(allow|reject)[_-](once|always)$/i.test(raw)) return raw
  const byKind = APPROVAL_OPTION_LABELS[option.kind]
  if (byKind) return byKind
  return option.id
}

/** 图标块：命令是终端、写文件是笔，其余用一个「要你点头」的盾牌 */
function findApprovalIcon(toolName: string): string {
  if (isShellTool(toolName)) return 'lucide:terminal'
  if (isWriteTool(toolName)) return 'lucide:pencil'
  return 'lucide:shield-alert'
}

function ApprovalBar(props: ApprovalBarProps) {
  const labels = useAssistantLabels()
  const [pending, setPending] = useState(false)
  const approval = props.approval

  // 没有审批通道的普通工具卡：不占位
  if (!approval) return null

  // 票据状态是**实时**的：历史重建的旧卡可能还带着「待审批」，但票据早没了。
  // 只看消息快照的话，这种卡点下去只会得到一句「已失效」—— 不如一开始就按失效渲染。
  const live = chatModelPort.findApprovalState?.(props.toolCallId)
  const isStale = live === null
  // 回执已受理、事件还没穿过泵的那几帧：直接用缓存里的结论，避免先闪回一下待审批
  const settledDecision = typeof live === 'boolean' ? live : undefined

  const state = isStale
    ? 'denied'
    : toApprovalState({
        approved: approval.approved ?? settledDecision,
        cancelled: approval.resolution === 'cancelled',
        settled: props.result !== undefined && props.result !== null
      })
  const request = state === 'request'
  const options = approval.options
  const hasOptions = (options?.length ?? 0) > 0
  const allowOnce = findOption(options, 'allow-once')
  const alwaysAllow = findOption(options, 'allow-always')
  const rejectOnce = findOption(options, 'reject-once')
  const rejectAlways = findOption(options, 'reject-always')
  // Deny 先吃 reject-once；两档拒绝都在时才把 reject-always 挤到左边去
  const deny = rejectOnce ?? rejectAlways
  const extraReject = rejectOnce && rejectAlways ? rejectAlways : undefined

  function deliver(input: { approved: boolean; optionId?: string }): boolean {
    const sent =
      chatModelPort.respondToApproval?.({
        toolCallId: props.toolCallId,
        approved: input.approved,
        optionId: input.optionId
      }) ?? false
    if (sent) return true
    // 票据已经不在等待中（跑完了 / 工具执行过了）：如实说，别假报成功
    setPending(false)
    toast.error(labels.approvalStale, { duration: 2000 })
    return false
  }

  function choose(option: ToolApprovalOption) {
    if (pending) return
    setPending(true)
    if (deliver({ approved: !isRejectKind(option.kind), optionId: option.id })) {
      toast.success(findOptionLabel(option), { duration: 1000 })
    }
  }

  /** 宿主没声明档位时的二元回答：只说允许 / 拒绝，optionId 交给 ACP 层按类别挑 */
  function answer(approved: boolean) {
    if (pending) return
    setPending(true)
    if (deliver({ approved })) {
      toast.success(approved ? labels.approvalAllowOnce : labels.approvalDeny, { duration: 1000 })
    }
  }

  function handleAllowOnce() {
    if (allowOnce) choose(allowOnce)
    else answer(true)
  }

  function handleDeny() {
    if (deny) choose(deny)
    else answer(false)
  }

  const command = isShellTool(props.toolName) ? toShellCommand(props.args)?.command : null
  const summary = summarize(props.args)
  const subtitle = isStale
    ? '审批已失效（本轮已结束或审批已过期），需要时请重新发送'
    : approval.prompt?.trim() || labels.approvalDefaultSubtitle
  // 命令已经在等宽面板里：说明别再复述同一句话
  const description = summary && summary !== command && summary !== subtitle ? summary : undefined

  const extraActions: readonly ApprovalCardAction[] | undefined = extraReject
    ? [
        {
          key: extraReject.id,
          label: findOptionLabel(extraReject),
          onSelect: function () {
            choose(extraReject)
          }
        }
      ]
    : undefined

  return (
    <ApprovalCard
      state={state}
      title={toAgentToolLabel(props.toolName)}
      subtitle={subtitle}
      // 已经答过的卡只留收据：命令 / 说明再摆一遍，下面还压着一份工具结果
      description={request ? description : undefined}
      command={request ? (command ?? undefined) : undefined}
      icon={
        <Icon
          icon={findApprovalIcon(props.toolName)}
          aria-hidden
          className="size-4"
        />
      }
      pending={pending}
      allowOnceLabel={allowOnce ? findOptionLabel(allowOnce) : undefined}
      alwaysAllowLabel={alwaysAllow ? findOptionLabel(alwaysAllow) : undefined}
      denyLabel={deny ? findOptionLabel(deny) : undefined}
      onAllowOnce={request && (allowOnce || !hasOptions) ? handleAllowOnce : undefined}
      onAlwaysAllow={
        request && alwaysAllow
          ? function () {
              choose(alwaysAllow)
            }
          : undefined
      }
      onDeny={request && (deny || !hasOptions) ? handleDeny : undefined}
      extraActions={request ? extraActions : undefined}
    />
  )
}

export { ApprovalBar }
