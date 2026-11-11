import {
  toolApprovalAcceptsText,
  useScrollLock,
  useToolCallElapsed,
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus
} from '@assistant-ui/react'
import { cn } from 'cn'
import { memo, useCallback, useRef, useState } from 'react'
import { Button } from '../components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { Textarea } from '../components/textarea'
import { useCollapseScrollPin } from './collapse-scroll-pin'
import { CHAT_DURATION_MS } from './chat-motion'
import { field, mono } from './elements/surfaces'
import { useAssistantLabels, type AssistantLabels } from './labels'
import { ToolCallRow } from './tool-call'
import { TOOL_ROW_HEIGHT_CLASS } from './tool-row'

const ANIMATION_DURATION = CHAT_DURATION_MS

export type ToolFallbackRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'open' | 'onOpenChange'
> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function ToolFallbackRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolFallbackRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)
  const armCollapsePin = useCollapseScrollPin(collapsibleRef)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) lockScroll()
      else armCollapsePin(ANIMATION_DURATION)
      if (!isControlled) {
        setUncontrolledOpen(open)
      }
      controlledOnOpenChange?.(open)
    },
    [lockScroll, armCollapsePin, isControlled, controlledOnOpenChange]
  )

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn('aui-tool-fallback-root group/tool-fallback-root w-full', className)}
      style={
        {
          '--animation-duration': `${ANIMATION_DURATION}ms`
        } as React.CSSProperties
      }
      {...props}>
      {children}
    </Collapsible>
  )
}

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return '<1s'
  const seconds = ms / 1000
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

function ToolFallbackDuration({ className, ...props }: React.ComponentProps<'span'>) {
  const elapsedMs = useToolCallElapsed()
  if (elapsedMs === undefined) return null

  return (
    <span
      data-slot="tool-fallback-duration"
      className={cn(
        'aui-tool-fallback-duration text-muted-foreground text-xs tabular-nums',
        className
      )}
      {...props}>
      {formatToolDuration(elapsedMs)}
    </span>
  )
}

/**
 * 折叠行的高度是**常数**，不是「padding + 行高凑出来的」。
 *
 * 一次回答里常有几十次工具调用：只要某一行因为图标 / 耗时 / 状态多带一点内边距，
 * 行高就会参差不齐，读起来像排版坏了。所以高度写死成 `h-7`（28px），
 * `toolTriggerClassName()` 是唯一出口 —— 测试锁的也是它，而不是某个 class 的散落副本。
 */
const TOOL_TRIGGER_ROW_CLASS = TOOL_ROW_HEIGHT_CLASS

/**
 * 折叠行对齐 assistant-ui `elements/tool-call`：**不再是带框的小卡片**。
 * 一行就是「箭头 + 说法 + 参数芯片 + 右端状态」，静止时和正文同一层级、只在 hover 时提亮 ——
 * 元素页把边界交给排版（等宽芯片、状态图标），不靠底色和描边：
 * 一次回合几十行时，几十个描边盒子读起来像表格，反而更吵。
 *
 * 行高仍然是常数（`TOOL_TRIGGER_ROW_CLASS` = 28px），与命令卡 / diff 抬头对齐。
 */
const TOOL_TRIGGER_BASE_CLASS =
  'aui-tool-fallback-trigger group/trigger text-muted-foreground hover:text-foreground/90 data-open:text-foreground flex w-full items-center gap-2 rounded-md text-sm transition-colors outline-hidden'

/**
 * Trigger 的 `className` 还允许是 base-ui 的「按状态取类名」函数形式，
 * 所以 helper 两种形式都得吃得下：字符串进字符串出，函数进函数出。
 * 折叠行的高度仍然由 `TOOL_ROW_HEIGHT_CLASS` 单点决定。
 */
type ToolTriggerClassName = React.ComponentProps<typeof CollapsibleTrigger>['className']
type ToolTriggerClassNameFn = Extract<ToolTriggerClassName, (...args: never[]) => unknown>
type ToolTriggerState = ToolTriggerClassNameFn extends (state: infer State) => unknown
  ? State
  : never

/** 折叠行的类名：高度固定，其余与状态相关的差异交给内部图标 / 文案 */
function toolTriggerClassName(): string
function toolTriggerClassName(className: string | undefined): string
function toolTriggerClassName(className: ToolTriggerClassName): string | ToolTriggerClassNameFn
function toolTriggerClassName(className?: ToolTriggerClassName): string | ToolTriggerClassNameFn {
  if (typeof className === 'function') {
    return function (state: ToolTriggerState) {
      return cn(TOOL_TRIGGER_ROW_CLASS, TOOL_TRIGGER_BASE_CLASS, className(state))
    }
  }
  return cn(TOOL_TRIGGER_ROW_CLASS, TOOL_TRIGGER_BASE_CLASS, className)
}

function ToolFallbackTrigger({
  toolName,
  detail,
  status,
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  toolName: string
  /** 主要参数（路径 / 命令 / 查询词）：行里的等宽芯片，没有就不出现 */
  detail?: string
  status?: ToolCallMessagePartStatus
}) {
  const statusType = status?.type ?? 'complete'
  const isRunning = statusType === 'running'
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  // 只有「跑砸了」才换叉：取消是用户自己的决定，长度截断也不是失败
  const isFailed = statusType === 'incomplete' && !isCancelled
  const labels = useAssistantLabels()

  return (
    <CollapsibleTrigger
      data-slot="tool-fallback-trigger"
      className={toolTriggerClassName(className)}
      {...props}>
      <ToolCallRow
        label={toolName}
        activeLabel={labels.toolCallActive(toolName)}
        query={detail}
        running={isRunning}
        failed={isFailed}
        waiting={statusType === 'requires-action'}
        cancelled={isCancelled}
        trailing={<ToolFallbackDuration />}
      />
    </CollapsibleTrigger>
  )
}

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-fallback-content"
      className={cn(
        'aui-tool-fallback-content relative overflow-hidden text-sm outline-none',
        'group/collapsible-content data-closed:pointer-events-none',
        className
      )}
      {...props}>
      {/* 块自带内边距（见 `auiBlockClass`）：这里只管间距，不再缩进到行的文字起点 */}
      <div className="flex flex-col gap-2 pt-1 pb-2">{children}</div>
    </CollapsibleContent>
  )
}

/** 展开区里每一块的表面：与 `elements/tool-call` 的面板块同源（`field` + 12px 圆角 + 内边距） */
const auiBlockClass = cn(field, 'rounded-2xl px-3.5 pt-2.5 pb-2')

/**
 * 展开后的第一块：原始请求（参数文本）。
 *
 * 版式对齐 `elements/tool-call` 的面板块：`field` 表面 + 等宽小标题 + 等宽正文。
 * 以前是一整块 `bg-muted/50` 的 pre、没有标题 —— 读者分不清这团 JSON 是请求还是结果。
 */
function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  argsText?: string
}) {
  const labels = useAssistantLabels()
  if (!argsText) return null

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn(auiBlockClass, 'aui-tool-fallback-args', className)}
      {...props}>
      <p
        data-slot="tool-fallback-args-header"
        className={cn(mono, 'mb-1')}>
        {labels.toolCallRequest}
      </p>
      <pre className="aui-tool-fallback-args-value text-muted-foreground font-mono text-xs whitespace-pre-wrap break-words">
        {argsText}
      </pre>
    </div>
  )
}

const formatUnknownValue = (value: unknown, space?: number): string => {
  if (typeof value === 'string') return value

  try {
    if (value instanceof Error) return String(value)

    const json = JSON.stringify(value, null, space)
    if (json !== undefined) return json
  } catch {}

  try {
    return String(value)
  } catch {
    return '[Unserializable value]'
  }
}

/** 展开后的第二块：结果。版式与请求块同源（小标题 + 正文），只有正文的字色深一档 */
function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  result?: unknown
}) {
  const labels = useAssistantLabels()
  if (result === undefined) return null

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn(auiBlockClass, 'aui-tool-fallback-result', className)}
      {...props}>
      <p
        data-slot="tool-fallback-result-header"
        className={cn(mono, 'mb-1')}>
        {labels.toolCallResult}
      </p>
      <pre className="aui-tool-fallback-result-content text-foreground/90 text-xs leading-relaxed whitespace-pre-wrap break-words">
        {formatUnknownValue(result, 2)}
      </pre>
    </div>
  )
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  status?: ToolCallMessagePartStatus
}) {
  const labels = useAssistantLabels()
  if (status?.type !== 'incomplete') return null

  const error = status.error
  const errorText = error === undefined || error === null ? null : formatUnknownValue(error)

  if (!errorText) return null

  const isCancelled = status.reason === 'cancelled'
  const headerText = isCancelled ? labels.toolCancelledReason : labels.toolError

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn('aui-tool-fallback-error', className)}
      {...props}>
      <p className="aui-tool-fallback-error-header text-muted-foreground font-semibold">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">{errorText}</p>
    </div>
  )
}

/** 审批四类决策的默认文案；宿主给 `option.label` 时以它为准 */
const approvalOptionDefaultLabels = (labels: AssistantLabels): Record<string, string> => ({
  'allow-once': labels.toolApprove,
  'allow-always': labels.toolAllowAlways,
  'reject-once': labels.toolDeny,
  'reject-always': labels.toolDenyAlways
})

const KNOWN_APPROVAL_KINDS = ['allow-once', 'allow-always', 'reject-once', 'reject-always']

const isKnownKind = (kind: string) => KNOWN_APPROVAL_KINDS.includes(kind)

const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always'

const approvalOptionLabel = (option: ToolApprovalOption, labels: AssistantLabels) =>
  option.label ??
  (isKnownKind(option.kind) ? approvalOptionDefaultLabels(labels)[option.kind] : undefined) ??
  option.id

/**
 * A request that declares how it wants to be presented is asking a question,
 * not gating an action, so a refusal is not one of the answers it accepts.
 */
const isQuestion = (approval: ToolCallMessagePart['approval']) =>
  approval?.display === 'select' || approval?.display === 'text'

const offersInterruptAction = (
  status: ToolCallMessagePartStatus | undefined,
  approval: ToolCallMessagePart['approval'],
  interrupt: ToolCallMessagePart['interrupt']
) =>
  status?.type !== 'requires-action' ||
  status.reason !== 'interrupt' ||
  approval != null ||
  interrupt != null

function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  status,
  ...props
}: React.ComponentProps<'div'> &
  Partial<
    Pick<ToolCallMessagePartProps, 'addResult' | 'resume' | 'respondToApproval' | 'status'>
  > & {
    interrupt?: ToolCallMessagePart['interrupt']
    approval?: ToolCallMessagePart['approval']
  }) {
  const [submitted, setSubmitted] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState<string | null>(null)
  const labels = useAssistantLabels()

  if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined))
    return null

  if (!offersInterruptAction(status, approval, interrupt)) return null

  // A declared option list is a host constraint: the kit never adds an
  // approval path beyond it, and preserves a refusal path only where the
  // request is an action the user may refuse.
  const declaredOptions = respondToApproval ? approval?.options : undefined
  const acceptsText =
    approval != null && respondToApproval != null && toolApprovalAcceptsText(approval)

  // A refused response leaves the request open, so the controls come back
  // rather than staying spent on a decision the runtime never recorded.
  const submit = (send: () => Promise<void> | void) => {
    setSubmitted(true)
    setError(null)
    void (async () => {
      try {
        await send()
      } catch (sendError) {
        setSubmitted(false)
        setError(sendError instanceof Error ? sendError.message : String(sendError))
      }
    })()
  }

  const respond = (approved: boolean) => {
    if (submitted) return
    if (approval != null && approval.approved === undefined && respondToApproval) {
      submit(() => respondToApproval({ approved, ...typedAnswer() }))
    } else if (interrupt) {
      submit(() => resume?.({ approved }))
    } else if (status?.type === 'requires-action' && status.reason === 'interrupt') {
      return
    } else {
      submit(() => addResult?.(approved ? labels.toolApprovedResult : labels.toolDeniedResult))
    }
  }

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted) return
    setConfirmingId(null)
    // A custom kind has no decision class for the runtime to derive, and
    // responding without one throws; picking a declared option is an answer,
    // so it resolves as approved.
    submit(() =>
      respondToApproval?.(
        isKnownKind(option.kind)
          ? { optionId: option.id, ...typedAnswer() }
          : { optionId: option.id, approved: true, ...typedAnswer() }
      )
    )
  }

  const typedAnswer = () => (answer.trim() ? { text: answer } : {})

  const submitAnswer = () => {
    if (submitted || !answer.trim()) return
    submit(() => respondToApproval?.({ text: answer }))
  }

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id)
    } else {
      respondWithOption(option)
    }
  }

  const confirming =
    confirmingId != null ? declaredOptions?.find((o) => o.id === confirmingId) : undefined

  const question = isQuestion(approval)

  const promptText = approval?.prompt ? (
    <p className="aui-tool-fallback-approval-prompt text-foreground">{approval.prompt}</p>
  ) : null

  const errorText = error ? (
    <p
      role="alert"
      className="aui-tool-fallback-approval-error text-destructive text-xs">
      {error}
    </p>
  ) : null

  const answerField = acceptsText ? (
    <div className="aui-tool-fallback-approval-answer flex flex-col items-start gap-2">
      <Textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        disabled={submitted}
        aria-label={question ? (approval?.prompt ?? labels.toolAnswerLabel) : labels.toolNoteLabel}
        placeholder={question ? labels.toolAnswerPlaceholder : labels.toolNotePlaceholder}
      />
      {question && (
        <Button
          size="sm"
          onClick={submitAnswer}
          disabled={submitted || !answer.trim()}>
          {labels.toolAnswerSend}
        </Button>
      )}
    </div>
  ) : null

  if (confirming) {
    const confirmMeta = typeof confirming.confirm === 'object' ? confirming.confirm : undefined
    const confirmDescription = confirmMeta?.description ?? confirming.description
    return (
      <div
        data-slot="tool-fallback-approval-confirm"
        className={cn('aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1', className)}
        {...props}>
        <p className="aui-tool-fallback-approval-confirm-title font-semibold">
          {confirmMeta?.title ?? `${approvalOptionLabel(confirming, labels)}?`}
        </p>
        {confirmDescription && (
          <p className="aui-tool-fallback-approval-confirm-description text-muted-foreground">
            {confirmDescription}
          </p>
        )}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code className="aui-tool-fallback-approval-confirm-grant bg-muted rounded px-1.5 py-0.5 text-xs">
                  {grant}
                </code>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => respondWithOption(confirming)}
            disabled={submitted}>
            {labels.toolConfirm}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmingId(null)}
            disabled={submitted}>
            {labels.toolBack}
          </Button>
        </div>
      </div>
    )
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = declaredOptions.filter((o) => isAllowKind(o.kind))
    const customOptions = declaredOptions.filter((o) => !isKnownKind(o.kind))
    const rejectOptions = declaredOptions.filter((o) => isKnownKind(o.kind) && !isAllowKind(o.kind))
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn('aui-tool-fallback-approval flex flex-col gap-2 pt-1', className)}
        {...props}>
        {promptText}
        <div className="flex flex-wrap items-center gap-2">
          {[...allowOptions, ...customOptions, ...rejectOptions].map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={option === allowOptions[0] ? 'default' : 'outline'}
              onClick={() => handleOption(option)}
              disabled={submitted}>
              {approvalOptionLabel(option, labels)}
            </Button>
          ))}
          {rejectOptions.length === 0 && !question && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => respond(false)}
              disabled={submitted}>
              {labels.toolDeny}
            </Button>
          )}
        </div>
        {answerField}
        {errorText}
      </div>
    )
  }

  // A question carries no decision to fabricate, so it renders only what the
  // request declared, even when that leaves nothing to act on here.
  if (question) {
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn('aui-tool-fallback-approval flex flex-col gap-2 pt-1', className)}
        {...props}>
        {promptText}
        {answerField}
        {errorText}
      </div>
    )
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn('aui-tool-fallback-approval flex flex-col gap-2 pt-1', className)}
      {...props}>
      {promptText}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => respond(true)}
          disabled={submitted}>
          {labels.toolApprove}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(false)}
          disabled={submitted}>
          {labels.toolDeny}
        </Button>
      </div>
      {answerField}
      {errorText}
    </div>
  )
}

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval
}) => {
  const isCancelled = status?.type === 'incomplete' && status.reason === 'cancelled'
  const isRequiresAction = status?.type === 'requires-action'
  const shouldRenderApproval =
    isRequiresAction && offersInterruptAction(status, approval, interrupt)

  const [open, setOpen] = useState(isRequiresAction)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) setOpen(true)
  }

  return (
    <ToolFallbackRoot
      open={open}
      onOpenChange={setOpen}>
      <ToolFallbackTrigger
        toolName={toolName}
        status={status}
      />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          argsText={argsText}
          className={cn(isCancelled && 'opacity-60')}
        />
        {shouldRenderApproval && (
          <ToolFallbackApproval
            addResult={addResult}
            resume={resume}
            interrupt={interrupt}
            approval={approval}
            respondToApproval={respondToApproval}
            status={status}
          />
        )}
        {!isCancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}

const ToolFallback = memo(ToolFallbackImpl) as unknown as ToolCallMessagePartComponent & {
  Root: typeof ToolFallbackRoot
  Trigger: typeof ToolFallbackTrigger
  Content: typeof ToolFallbackContent
  Args: typeof ToolFallbackArgs
  Result: typeof ToolFallbackResult
  Error: typeof ToolFallbackError
  Approval: typeof ToolFallbackApproval
}

ToolFallback.displayName = 'ToolFallback'
ToolFallback.Root = ToolFallbackRoot
ToolFallback.Trigger = ToolFallbackTrigger
ToolFallback.Content = ToolFallbackContent
ToolFallback.Args = ToolFallbackArgs
ToolFallback.Result = ToolFallbackResult
ToolFallback.Error = ToolFallbackError
ToolFallback.Approval = ToolFallbackApproval

export {
  TOOL_TRIGGER_ROW_CLASS,
  ToolFallback,
  ToolFallbackApproval,
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
  toolTriggerClassName
}
