import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { APPROVAL_POLICIES, findApprovalPolicy } from '@/features/chat/approval.ts'
import { useAgentStore } from '@/stores/agent.ts'

/** 输入区右下角的审批策略。和设置页「模型」里的是同一项，改完下一轮生效 */
export function ApprovalSwitch() {
  const approval = useAgentStore(function (state) {
    return state.settings.chat.approval
  })
  const update = useAgentStore(function (state) {
    return state.update
  })

  const current = findApprovalPolicy(approval)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="工具审批策略"
            title={current?.hint}
            className="text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs font-normal"
          />
        }>
        {current?.label ?? '询问审批'}
        <Icon
          icon="lucide:chevron-down"
          className="size-3.5"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64">
        {APPROVAL_POLICIES.map(function (policy) {
          const isCurrent = policy.value === approval
          return (
            <DropdownMenuItem
              key={policy.value}
              className="items-start gap-2"
              onClick={function () {
                void update('chat', { approval: policy.value })
              }}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{policy.label}</span>
                <span className="text-muted-foreground text-xs leading-snug">{policy.hint}</span>
              </span>
              {isCurrent ? (
                <Icon
                  icon="lucide:check"
                  className="mt-0.5 size-3.5"
                />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
