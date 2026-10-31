import type { ToolCallMessagePartProps, ToolApprovalOption } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle
} from '@cogito/design/assistant/confirmation'
import type { ToolApprovalRecord } from '@cogito/design/assistant/tool-call-state'
import { useState } from 'react'
import { toast } from 'sonner'

import { chatModelPort } from '@/features/agent/port/instance'
import { mapToolCallState } from '@/views/agent/chat/components/parse-tool-result'
import { isKnownKind } from '@/views/agent/chat/components/tool-card-format'

type ApprovalBarProps = Pick<ToolCallMessagePartProps, 'approval' | 'toolCallId'>

/** 四档权限选项的中文文案（goose 常把 kind 原样塞进 name，不能当人话） */
const APPROVAL_OPTION_LABELS: Record<string, string> = {
  'allow-once': '允许一次',
  'allow-always': '始终允许',
  'reject-once': '拒绝一次',
  'reject-always': '始终拒绝'
}

function mapToolApproval(
  toolCallId: string,
  approval: ToolCallMessagePartProps['approval']
): ToolApprovalRecord {
  if (!approval) return undefined
  if (approval.approved === undefined && !approval.resolution) {
    return { id: toolCallId }
  }
  if (approval.approved === false || approval.resolution === 'cancelled') {
    return { id: toolCallId, approved: false }
  }
  return { id: toolCallId, approved: true }
}

function isRejectKind(kind: string) {
  return kind === 'reject-once' || kind === 'reject-always'
}

function findOptionLabel(option: ToolApprovalOption) {
  const byKind = APPROVAL_OPTION_LABELS[option.kind]
  if (byKind) return byKind
  const raw = option.label?.trim()
  if (raw && !/^(allow|reject)[_-](once|always)$/i.test(raw)) return raw
  return option.id
}

function ApprovalBar(props: ApprovalBarProps) {
  const approval = props.approval
  const [submitted, updateSubmitted] = useState(false)
  const state = mapToolCallState(props as ToolCallMessagePartProps)
  const mappedApproval = mapToolApproval(props.toolCallId, approval)

  if (!approval || approval.approved !== undefined || approval.resolution) return null

  const options = approval.options

  /**
   * 中途审批必须走 ACP 端口：assistant-ui 的 `respondToApproval` 在 run 仍进行时会抛
   * 「Tried to respond to a tool approval while a run is in progress」。
   * 追问表单同理只调 `chatModelPort`。
   */
  function deliver(input: { approved: boolean; optionId?: string }) {
    return (
      chatModelPort.respondToApproval?.({
        toolCallId: props.toolCallId,
        approved: input.approved,
        optionId: input.optionId
      }) ?? false
    )
  }

  function handleOption(option: ToolApprovalOption) {
    if (submitted) return
    updateSubmitted(true)
    const approved = !isRejectKind(option.kind)
    const ok = deliver(
      isKnownKind(option.kind)
        ? { approved, optionId: option.id }
        : { approved: true, optionId: option.id }
    )
    if (ok) {
      toast.success(findOptionLabel(option), { duration: 1000 })
      return
    }
    updateSubmitted(false)
    toast.error('这次审批已经失效，请重新发送', { duration: 2000 })
  }

  function handleBinary(approved: boolean) {
    if (submitted) return
    updateSubmitted(true)
    const ok = deliver({ approved })
    if (ok) {
      toast.success(approved ? '已放行' : '已拒绝', { duration: 1000 })
      return
    }
    updateSubmitted(false)
    toast.error('这次审批已经失效，请重新发送', { duration: 2000 })
  }

  return (
    <Confirmation
      approval={mappedApproval}
      state={state}
      className="border-border/80 bg-muted/30 gap-0 px-2.5 py-1.5">
      <ConfirmationRequest>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon
              icon="lucide:shield-alert"
              className="text-muted-foreground size-3.5 shrink-0"
            />
            <ConfirmationTitle className="text-muted-foreground truncate text-xs">
              {approval.prompt ?? '需要你确认后才会执行'}
            </ConfirmationTitle>
          </div>
          {options && options.length > 0 ? (
            <ConfirmationActions className="shrink-0 flex-nowrap justify-end gap-1.5 self-auto">
              {options.map(function (option) {
                const reject = isRejectKind(option.kind)
                return (
                  <ConfirmationAction
                    key={option.id}
                    size="xs"
                    variant={reject ? 'outline' : 'default'}
                    className={
                      reject
                        ? 'border-border text-muted-foreground hover:text-foreground'
                        : ''
                    }
                    disabled={submitted}
                    onClick={function () {
                      handleOption(option)
                    }}>
                    {findOptionLabel(option)}
                  </ConfirmationAction>
                )
              })}
            </ConfirmationActions>
          ) : (
            <ConfirmationActions className="shrink-0 flex-nowrap justify-end gap-1.5 self-auto">
              <ConfirmationAction
                size="xs"
                variant="outline"
                className="border-border text-muted-foreground hover:text-foreground"
                disabled={submitted}
                onClick={function () {
                  handleBinary(false)
                }}>
                拒绝
              </ConfirmationAction>
              <ConfirmationAction
                size="xs"
                className=""
                disabled={submitted}
                onClick={function () {
                  handleBinary(true)
                }}>
                放行
              </ConfirmationAction>
            </ConfirmationActions>
          )}
        </div>
      </ConfirmationRequest>
    </Confirmation>
  )
}

export { ApprovalBar }
