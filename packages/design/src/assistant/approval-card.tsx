/**
 * Approval card（对齐 assistant-ui `elements/approval-card`）
 *
 * 「代理要做一件有后果的事，先问一句」的一张纸卡：图标块 + 标题 / 副标题 +
 * 可选的等宽命令面板与明细表 + 右对齐的动作按钮。答完之后 footer 换成收据
 * （执行中 / 已完成 / 已拒绝），卡片留在原位 —— 对话里看得到这一步是怎么过的。
 *
 * 与 `confirmation.tsx` 的分工：那个是可组合原语（`Confirmation` + `ConfirmationRequest` +
 * `ConfirmationActions`），适合内联一条细窄的确认；本元素是一张自带布局的整卡，
 * 命令 / 明细 / 收据都在里面，宿主只管状态与回执。
 *
 * 元素本体是收费产物，结构 / 行为 / 无障碍按官网渲染出的 DOM 与 `.md` 契约自写：
 * - `role="group"` + `aria-labelledby` 指标题，`description` 同时进 `aria-describedby`；
 * - `state` 只有四档，除 `request` 外 footer 是 `role="status"` 的实时收据；
 * - `variant="destructive"` 只改色调（图标块与主按钮），不是另一套结构；
 * - `command` 可选：应用类动作不必假装成终端命令。
 *
 * 三按钮（Deny / Always allow / Allow once）是元素契约。本仓多一个 `extraActions`：
 * ACP 会声明四档权限（allow-once / allow-always / reject-once / reject-always），
 * 三档之外的那些插在 Deny 左侧；不给时渲染与元素页逐字一致。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { Fragment, useId, type ReactNode } from 'react'

import {
  findApprovalStatusIcon,
  isApprovalRequest,
  type ApprovalDetail,
  type ApprovalState,
  type ApprovalVariant
} from './approval-card-state'
import { field, ghostButton, inkButton, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 三档之外的动作（ACP 的 reject-always、协议将来新增的档位） */
interface ApprovalCardAction {
  key: string
  label: string
  onSelect: () => void
}

interface ApprovalCardProps extends Omit<React.ComponentProps<'div'>, 'children' | 'title'> {
  /** 四态：`request` 之外 footer 变收据 */
  state: ApprovalState
  /** 这张卡要做什么（同时是读屏的卡片名，`aria-labelledby` 指它） */
  title: string
  /** 一句补充：谁要做什么 */
  subtitle?: string
  /** 更长的说明，进 `aria-describedby` */
  description?: string
  /** 等宽面板里那条命令（应用类动作可以不给） */
  command?: string
  /** 结构化明细：标签 / 值两列 */
  details?: readonly ApprovalDetail[]
  /** `destructive` 只改色调：图标块与主按钮走失败色，结构不变 */
  variant?: ApprovalVariant
  /** 替换默认的终端图标（图标是渲染层的事，不该从工具参数里猜） */
  icon?: ReactNode
  /** 主按钮：这一次允许 */
  allowOnceLabel?: string
  /** 次级按钮：以后都允许 */
  alwaysAllowLabel?: string
  /** 拒绝 */
  denyLabel?: string
  /** 收据文案覆盖：具体结果可以写成「已发布 0.14.1」 */
  statusLabel?: string
  /** 已经提交、还在等服务端回执：按钮禁用（元素页没有这一步） */
  pending?: boolean
  onAllowOnce?: () => void
  onAlwaysAllow?: () => void
  onDeny?: () => void
  /** 三档之外的动作，排在 Deny 左侧（不给时与元素页一致） */
  extraActions?: readonly ApprovalCardAction[]
}

/** 无底色的动作按钮：元素页三个按钮里有两个长这样 */
function ApprovalCardButton(props: {
  slot: string
  label: string
  pending: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-slot={props.slot}
      disabled={props.pending}
      onClick={props.onSelect}
      className={cn(ghostButton, 'h-8 px-3.5 text-xs font-medium whitespace-nowrap')}>
      {props.label}
    </button>
  )
}

function ApprovalCard({
  state,
  title,
  subtitle,
  description,
  command,
  details,
  variant = 'default',
  icon,
  allowOnceLabel,
  alwaysAllowLabel,
  denyLabel,
  statusLabel,
  pending = false,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
  extraActions,
  className,
  ...props
}: ApprovalCardProps) {
  const labels = useAssistantLabels()
  const titleId = useId()
  const descriptionId = useId()

  const request = isApprovalRequest(state)
  const receipt =
    statusLabel ??
    (state === 'running'
      ? labels.approvalRunning
      : state === 'done'
        ? labels.approvalDone
        : labels.approvalDenied)

  return (
    <div
      data-slot="approval-card"
      data-variant={variant}
      data-state={state}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-3.5 rounded-[20px] p-4', className)}
      {...props}>
      <div
        data-slot="approval-card-header"
        className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            variant === 'destructive'
              ? 'bg-destructive/10 text-destructive'
              : 'bg-foreground/[0.05] text-muted-foreground'
          )}>
          {icon ?? (
            <Icon
              icon="lucide:terminal"
              aria-hidden
              className="size-4"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-col">
          <p
            id={titleId}
            data-slot="approval-card-title"
            className="text-sm font-medium break-words">
            {title || labels.approvalDefaultTitle}
          </p>
          {subtitle ? (
            <p
              data-slot="approval-card-subtitle"
              className="text-muted-foreground text-xs break-words">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {description ? (
        <p
          id={descriptionId}
          data-slot="approval-card-description"
          className="text-muted-foreground text-xs leading-relaxed break-words">
          {description}
        </p>
      ) : null}

      {command ? (
        <div
          data-slot="approval-card-command"
          className={cn(
            field,
            'text-foreground/70 overflow-x-auto rounded-xl px-3.5 py-2.5 font-mono text-xs whitespace-pre-wrap'
          )}>
          {command}
        </div>
      ) : null}

      {details && details.length > 0 ? (
        <dl
          data-slot="approval-card-details"
          className={cn(
            field,
            'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl px-3.5 py-2.5 text-xs'
          )}>
          {details.map(function (detail) {
            return (
              <Fragment key={detail.label}>
                <dt className="text-muted-foreground">{detail.label}</dt>
                <dd className="text-foreground/80 min-w-0 truncate text-end">{detail.value}</dd>
              </Fragment>
            )
          })}
        </dl>
      ) : null}

      {request ? (
        <div
          data-slot="approval-card-actions"
          className="flex min-h-8 flex-wrap items-center justify-end gap-2">
          {extraActions?.map(function (action) {
            return (
              <ApprovalCardButton
                key={action.key}
                slot="approval-card-extra"
                label={action.label}
                pending={pending}
                onSelect={action.onSelect}
              />
            )
          })}
          {onDeny ? (
            <ApprovalCardButton
              slot="approval-card-deny"
              label={denyLabel ?? labels.approvalDeny}
              pending={pending}
              onSelect={onDeny}
            />
          ) : null}
          {onAlwaysAllow ? (
            <ApprovalCardButton
              slot="approval-card-always-allow"
              label={alwaysAllowLabel ?? labels.approvalAlwaysAllow}
              pending={pending}
              onSelect={onAlwaysAllow}
            />
          ) : null}
          {onAllowOnce ? (
            <button
              type="button"
              data-slot="approval-card-allow-once"
              disabled={pending}
              onClick={onAllowOnce}
              className={cn(
                inkButton,
                'h-8 px-3.5 text-xs font-medium whitespace-nowrap',
                variant === 'destructive' && 'bg-destructive text-background hover:opacity-90'
              )}>
              {allowOnceLabel ?? labels.approvalAllowOnce}
            </button>
          ) : null}
        </div>
      ) : (
        // 收据：读屏要跟着播（等这一步的人不会盯着卡片看）
        <div
          data-slot="approval-card-status"
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex min-h-8 items-center justify-end gap-1.5 text-xs">
          <Icon
            icon={findApprovalStatusIcon(state)}
            aria-hidden
            className={cn(
              'size-3.5',
              state === 'running' && 'animate-spin motion-reduce:animate-none'
            )}
          />
          <span className={cn(state === 'running' && 'shimmer shimmer-contrast motion-reduce:animate-none')}>
            {receipt}
          </span>
        </div>
      )}
    </div>
  )
}

export { ApprovalCard }
export type { ApprovalCardAction, ApprovalCardProps }
