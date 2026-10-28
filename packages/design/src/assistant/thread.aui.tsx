import { Icon } from '@iconify/react/offline'
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  type AssistantState,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type MessagePartStatus,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartStatus
} from '@assistant-ui/react'
import { cn } from 'cn'
import {
  createContext,
  Fragment,
  useContext,
  useMemo,
  type ComponentType,
  type FC,
  type PropsWithChildren
} from 'react'
import { Button } from '../components/button'
import { Skeleton } from '../components/skeleton'
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments
} from './attachment.aui'
import { File } from './file'
import { ThreadFollowupSuggestions } from './follow-up-suggestions.aui'
import { Image } from './image'
import { useAssistantLabels } from './labels'
import { MarkdownText } from './markdown-text'
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from './reasoning.aui'
import { ToolFallback } from './tool-fallback.aui'
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from './tool-group.aui'
import { TooltipIconButton } from './tooltip-icon-button'

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  ToolFallback?: ToolCallMessagePartComponent | undefined
  ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
  ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
  /**
   * 整轮「过程」的折叠壳：**最终回答之前的一切**（思考、工具、中间解说）都装在里面，
   * 最终回答留在外面常驻可见。这是 VS Code Copilot / Cursor / Claude Code 的共同排版
   * ——「过程收成一条、结论留在底部」，边界由 `findResponseStart` 算出来。
   *
   * `running` 是**整条消息**是否在跑（不是过程区的 part 状态）：回合没结束时它保持展开，
   * 结束才回到 `defaultOpen`。app 用它接自己的「折叠回复过程」偏好。
   * 不传就用内置的折叠条（默认折叠，`labels.process` 文案）。
   */
  ProcessGroup?:
    ComponentType<PropsWithChildren<{ group: ThreadGroupPart; running: boolean }>> | undefined
  /**
   * 输入区左下角的自定义动作，渲染在附件按钮之前。
   * app 用它挂自己的工作区引用 / 文件选择 —— 库不关心引用从哪来。
   */
  ComposerStart?: ComponentType | undefined
  /**
   * 覆盖库自带的系统选文件按钮。传 `null` 表示不渲染。
   * app 用 `ComposerStart` 统一接管「文件 / 文件夹 / 图片」入口时用得到 ——
   * 否则输入区会同时出现两个 `+`。
   */
  ComposerAttach?: ComponentType | null | undefined
  /**
   * 输入区右下角的自定义动作，渲染在语音 / 发送之前。
   * app 用它挂模型、审批策略这类属于当前会话的开关。
   */
  ComposerEnd?: ComponentType | undefined
  /**
   * 输入框**下方**的一行（与输入框同宽、跟着它居中或吸底）。
   * app 用它摆「本次任务在哪个工作区、什么执行模式」这类发送前要核对的信息。
   */
  ComposerFooter?: ComponentType | undefined
  /**
   * `@` / `/` 等 TriggerPopover，挂在 `Unstable_TriggerPopoverRoot` 内、与 Input 同级。
   * app 用它接工作区文件 mention、技能 slash —— 库只留槽位。
   */
  ComposerTriggers?: ComponentType | undefined
}

export type ThreadProps = {
  components?: ThreadComponents | undefined
  autoFocus?: boolean | undefined
}

const EMPTY_COMPONENTS: ThreadComponents = {}

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS)

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading)

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading

const ThreadHistorySkeleton: FC = () => {
  const labels = useAssistantLabels()

  return (
    <div
      data-slot="aui_thread-history-skeleton"
      role="status"
      className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] animation-duration-[200ms]">
      <span className="sr-only">{labels.loadingConversation}</span>
      <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
      </div>
      <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-y-2">
        <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
      </div>
    </div>
  )
}

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS, autoFocus = true }) => {
  const isEmpty = useAuiState(isNewChatView)

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot
        isEmpty={isEmpty}
        autoFocus={autoFocus}
      />
    </ThreadComponentsContext.Provider>
  )
}

const ThreadRoot: FC<{ isEmpty: boolean; autoFocus: boolean }> = ({ isEmpty, autoFocus }) => {
  const { Welcome = ThreadWelcome, ComposerFooter } = useContext(ThreadComponentsContext)

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ['--thread-max-width' as string]: '46rem',
        ['--composer-bg' as string]: 'var(--color-card)',
        ['--composer-radius' as string]: '1.125rem',
        ['--composer-padding' as string]: '12px'
      }}>
      {/*
       * 输入框必须在 Viewport **之外**：Qoder / client 同款。
       * 放进 overflow 滚动区再用 sticky/mt-auto，空态内容不够高时仍会跟欢迎区挤在中间。
       */}
      {/*
       * turnAnchor=bottom：流式时跟底滚动（Cursor / 经典 chat）。
       * top 会默认关掉 autoScroll，长过程输出时视口不跟着走。
       */}
      <ThreadPrimitive.Viewport
        turnAnchor="bottom"
        autoScroll
        data-slot="aui_thread-viewport"
        className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto scroll-smooth">
        <div
          data-slot="aui_thread-viewport-inner"
          className="mx-auto flex min-h-full w-full max-w-(--thread-max-width) flex-col px-5 pt-6 sm:px-6">
          <AuiIf condition={isNewChatView}>
            <div className="flex flex-1 flex-col items-center justify-center py-6">
              <Welcome />
            </div>
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className={cn('flex flex-col gap-y-7 empty:hidden', isEmpty ? 'mb-0' : 'mb-8')}>
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>
        </div>
      </ThreadPrimitive.Viewport>

      {/*
       * dock 不用 gap：可选子项（suggestions / followups）存在与否会吃掉 gap，
       * 造成输入区整体高度跳变。间距改由「有内容的块」自己带 margin。
       */}
      <div
        data-slot="aui_thread-composer-dock"
        className="aui-thread-viewport-footer relative mx-auto flex w-full max-w-(--thread-max-width) shrink-0 flex-col px-5 pt-1 pb-4 sm:px-6 md:pb-5">
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-x-0 -top-8 h-8 bg-linear-to-t to-transparent"
        />
        <ThreadScrollToBottom />
        <ThreadFollowupSuggestions />
        <Composer autoFocus={autoFocus} />
        {ComposerFooter ? (
          <div className="mt-2">
            <ComposerFooter />
          </div>
        ) : null}
        <AuiIf condition={(s) => s.thread.suggestions.length > 0}>
          <ThreadSuggestions />
        </AuiIf>
      </div>
    </ThreadPrimitive.Root>
  )
}

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext)
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)

  if (isEditing) return <EditComposer />
  if (role === 'user') return <UserMessage />
  return <AssistantMessageComponent />
}

const ThreadScrollToBottom: FC = () => {
  const labels = useAssistantLabels()

  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={labels.scrollToBottom}
        variant="outline"
        className="aui-thread-scroll-to-bottom border-border/60 bg-card/90 hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 shadow-md backdrop-blur-md disabled:invisible dark:border-border dark:bg-card/80">
        <Icon icon="lucide:arrow-down" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  )
}

const ThreadWelcome: FC = () => {
  const labels = useAssistantLabels()

  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        {labels.welcome}
      </h1>
    </div>
  )
}

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions mt-2 flex w-full flex-wrap items-center justify-center gap-2 px-4">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  )
}

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger
        send
        asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion text-foreground hover:bg-muted/80 border-border/50 bg-card/70 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap shadow-xs backdrop-blur-sm transition-colors">
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  )
}

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const labels = useAssistantLabels()
  const { ComposerTriggers } = useContext(ThreadComponentsContext)
  const hasMessages = useAuiState(function (state) {
    return state.thread.messages.length > 0
  })

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className={[
              'border-border/50 dark:border-border/60 flex w-full cursor-text flex-col gap-2.5',
              'rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding)',
              'shadow-[0_1px_2px_oklch(0_0_0/0.04),0_10px_28px_-12px_oklch(0_0_0/0.12)]',
              'dark:shadow-[0_1px_2px_oklch(0_0_0/0.35),0_14px_36px_-14px_oklch(0_0_0/0.55)]',
              'transition-[border-color,box-shadow] duration-200',
              'focus-within:border-ring/45 focus-within:shadow-[0_1px_2px_oklch(0_0_0/0.04),0_10px_28px_-12px_oklch(0_0_0/0.12),0_0_0_3px_color-mix(in_oklab,var(--color-ring)_16%,transparent)]',
              'dark:focus-within:shadow-[0_1px_2px_oklch(0_0_0/0.35),0_14px_36px_-14px_oklch(0_0_0/0.55),0_0_0_3px_color-mix(in_oklab,var(--color-ring)_22%,transparent)]',
              'data-[dragging=true]:border-ring data-[dragging=true]:border-dashed',
              'data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_45%,var(--color-card))]'
            ].join(' ')}>
            <ComposerAttachments />
            <ComposerPrimitive.Input
              placeholder={
                hasMessages ? labels.composerPlaceholderContinue : labels.composerPlaceholder
              }
              className="aui-composer-input caret-primary placeholder:text-muted-foreground/55 w-full resize-none bg-transparent px-2.5 py-0.5 text-sm leading-6 outline-none"
              rows={2}
              minRows={2}
              maxRows={6}
              autoFocus={autoFocus}
              enterKeyHint="send"
              aria-label={labels.messageInput}
            />
            <ComposerAction />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
        {ComposerTriggers ? <ComposerTriggers /> : null}
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  )
}

const ComposerAction: FC = () => {
  const { ComposerStart, ComposerAttach, ComposerEnd } = useContext(ThreadComponentsContext)
  const labels = useAssistantLabels()

  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {ComposerStart ? <ComposerStart /> : null}
        {ComposerAttach === null ? null : ComposerAttach ? (
          <ComposerAttach />
        ) : (
          <ComposerAddAttachment />
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {ComposerEnd ? <ComposerEnd /> : null}
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip={labels.startDictation}
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate text-muted-foreground hover:text-foreground size-7 rounded-full"
                aria-label={labels.startDictation}>
                <Icon
                  icon="lucide:mic"
                  className="aui-composer-dictate-icon size-4"
                />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip={labels.stopDictation}
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
                aria-label={labels.stopDictation}>
                <Icon
                  icon="lucide:square"
                  className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current"
                />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip={labels.send}
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-send bg-primary text-primary-foreground hover:bg-primary-hover size-8 rounded-full shadow-sm"
              aria-label={labels.send}>
              <Icon
                icon="lucide:arrow-up"
                className="aui-composer-send-icon size-4"
              />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel bg-foreground text-background hover:bg-foreground/90 size-8 rounded-full shadow-sm"
              aria-label={labels.stopGenerating}>
              <Icon
                icon="lucide:square"
                className="aui-composer-cancel-icon size-3 fill-current"
              />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  )
}

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message whitespace-pre-wrap wrap-break-word" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

/** 过程区的 part 只读这一段就够：切段按 `type`，折叠条的状态按 `status` */
interface PartLike {
  readonly type: string
  readonly status: MessagePartStatus | ToolCallMessagePartStatus
  readonly text?: string
}

/** 过程区的一段：连续的工具调用 / 推理各自成段（段上挂折叠条），其余 part 各占一段 */
interface ProcessRun {
  kind: 'tool' | 'reasoning' | 'single'
  indices: number[]
}

/**
 * 最终回答的起点：从末尾往回找**最后一段非空正文**，紧邻它的正文段一起算进来。
 *
 * 边界是**算出来的**，不要求模型标注「哪段是总结」（VS Code Copilot 的
 * `getFinalResponseStartIndex` 是同一思路）。找不到正文就返回 `parts.length`
 * —— 那一轮还没给出结论，整条都算过程。
 */
function findResponseStart(parts: readonly PartLike[]): number {
  let start = -1
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type !== 'text' || !part.text?.trim()) continue
    start = index
    break
  }
  if (start < 0) return parts.length

  while (start > 0 && parts[start - 1].type === 'text') start -= 1
  return start
}

/** 按 part 类型切段：同类且相邻才合成一段，所以解说不影响工具段的完整性 */
function toProcessRuns(parts: readonly PartLike[], from: number, to: number): ProcessRun[] {
  const runs: ProcessRun[] = []
  for (let index = from; index < to; index += 1) {
    const type = parts[index].type
    const kind: ProcessRun['kind'] =
      type === 'tool-call' ? 'tool' : type === 'reasoning' ? 'reasoning' : 'single'
    const last = runs[runs.length - 1]
    if (last && kind !== 'single' && last.kind === kind) {
      last.indices.push(index)
      continue
    }
    runs.push({ kind, indices: [index] })
  }
  return runs
}

/** 段状态：有 part 在跑就是 running，否则随最后一个（与库的 `getGroupStatus` 同规则） */
function toRunStatus(
  parts: readonly PartLike[],
  indices: readonly number[]
): MessagePartStatus | ToolCallMessagePartStatus {
  for (const index of indices) {
    if (parts[index].status.type === 'running') return parts[index].status
  }
  const last = indices[indices.length - 1]
  return parts[last].status
}

/** 内置过程摘要壳：回合结束后默认收起，点开回看（流式中不挂这层） */
function DefaultProcessGroup(
  props: PropsWithChildren<{ group: ThreadGroupPart; running: boolean }>
) {
  const labels = useAssistantLabels()

  return (
    <ReasoningRoot
      variant="ghost"
      defaultOpen={false}>
      <ReasoningTrigger
        active={false}
        label={labels.process(props.group.indices.length)}
      />
      <ReasoningContent>
        <ReasoningText>{props.children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

const AssistantFile: FileMessagePartComponent = (props) => (
  <div
    data-slot="aui_assistant-message-file"
    className="py-1">
    <File {...props} />
  </div>
)

const AssistantImage: ImageMessagePartComponent = (props) => (
  <div
    data-slot="aui_assistant-message-image"
    className="py-1">
    <Image {...props} />
  </div>
)

/**
 * 助手消息 = [过程折叠区][最终回答]。
 *
 * 过程区装「最终回答之前的一切」并保持**原时序**（`toProcessRuns` 只把同类相邻的合并），
 * 最终回答常驻可见 —— 见 `ThreadComponents.ProcessGroup` 的说明。
 *
 * 叶子 part 统一走 `MessagePrimitive.PartByIndex`：注册过的工具 / data UI 由库优先接管
 * （`MessagePartComponent` 内部查 `toolUIs` / `dataRenderers`），这里只提供兜底组件。
 */
const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    ProcessGroup: ProcessShell = DefaultProcessGroup
  } = useContext(ThreadComponentsContext)

  const labels = useAssistantLabels()
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  const isRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })

  const responseStart = findResponseStart(parts)
  const processRuns = useMemo(
    function () {
      return toProcessRuns(parts, 0, responseStart)
    },
    [parts, responseStart]
  )
  const processIndices = useMemo(
    function () {
      return parts.slice(0, responseStart).map(function (_part, index) {
        return index
      })
    },
    [parts, responseStart]
  )
  const partComponents = useMemo(
    function () {
      return {
        Text: MarkdownText,
        Reasoning,
        File: AssistantFile,
        Image: AssistantImage,
        tools: { Fallback: ToolFallbackComponent }
      }
    },
    [ToolFallbackComponent]
  )

  function renderLeaf(index: number) {
    return (
      <MessagePrimitive.PartByIndex
        key={index}
        index={index}
        components={partComponents}
      />
    )
  }

  function renderRun(run: ProcessRun, runIndex: number) {
    const children = run.indices.map(function (index) {
      return renderLeaf(index)
    })
    let content = <Fragment>{children}</Fragment>

    if (run.kind === 'tool') {
      const group: ThreadGroupPart = {
        type: 'group-tool',
        status: toRunStatus(parts, run.indices),
        indices: run.indices
      }
      content = ToolGroup ? (
        <ToolGroup group={group}>{children}</ToolGroup>
      ) : (
        <ToolGroupRoot variant="ghost">
          <ToolGroupTrigger
            count={run.indices.length}
            active={group.status.type === 'running'}
          />
          <ToolGroupContent>{children}</ToolGroupContent>
        </ToolGroupRoot>
      )
    } else if (run.kind === 'reasoning') {
      const group: ThreadGroupPart = {
        type: 'group-reasoning',
        status: toRunStatus(parts, run.indices),
        indices: run.indices
      }
      const running = group.status.type === 'running'
      content = ReasoningGroup ? (
        <ReasoningGroup group={group}>{children}</ReasoningGroup>
      ) : (
        <ReasoningRoot
          variant="ghost"
          streaming={running}>
          <ReasoningTrigger
            active={running}
            label={running ? labels.working : labels.reasoning()}
          />
          <ReasoningContent aria-busy={running}>
            <ReasoningText>{children}</ReasoningText>
          </ReasoningContent>
        </ReasoningRoot>
      )
    }

    return <Fragment key={runIndex}>{content}</Fragment>
  }

  /**
   * 只有**动过手**的回合才加外层折叠区：一次「思考 → 答」不该出现两条折叠条
   * （里层那条思考条自己就够用，与改造前一致）。VS Code Copilot 的口径也是如此
   * —— 步数 < 2 的回合不折。
   */
  const hasToolCalls = processIndices.some(function (index) {
    return parts[index].type === 'tool-call'
  })

  // 最后一段不是正文（还在跑、或刚起工具）时补一个脉冲点，别让消息区空着
  const lastPart = parts[parts.length - 1]
  const showIndicator =
    isRunning &&
    (lastPart === undefined || (lastPart.type !== 'text' && lastPart.type !== 'reasoning'))

  const ACTION_BAR_PT = 'pt-1.5'
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]">
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-1 text-sm leading-7 wrap-break-word">
        {/*
         * 对齐 Cursor / Copilot：流式中每段思考/工具扁平罗列，段结束即各自收起；
         * 整轮结束后才收成一条「过程 · N 步」摘要（可点开回看），勿用外层壳挂到整轮 running。
         */}
        {processIndices.length > 0 ? (
          hasToolCalls && !isRunning ? (
            <ProcessShell
              group={{
                type: 'group-process',
                status: toRunStatus(parts, processIndices),
                indices: processIndices
              }}
              running={false}>
              {processRuns.map(renderRun)}
            </ProcessShell>
          ) : (
            processRuns.map(renderRun)
          )
        ) : null}

        {parts.slice(responseStart).map(function (_part, offset) {
          return renderLeaf(responseStart + offset)
        })}

        {showIndicator ? (
          // 轻量指示器即可：勿再套 Collapsible/ReasoningRoot，
          // 流式时 part 频繁切换会与侧栏受控折叠叠成 Maximum update depth。
          <div
            data-slot="aui_assistant-message-indicator"
            className="text-muted-foreground bg-muted/35 ring-border/40 mt-1 flex max-w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm ring-1"
            aria-label={labels.working}
            aria-live="polite">
            <Icon
              icon="lucide:sparkles"
              className="size-3.5 shrink-0"
            />
            <span className="shimmer motion-reduce:animate-none leading-none">
              {labels.working}
            </span>
          </div>
        ) : null}

        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn('ms-2 flex items-center', ACTION_BAR_HEIGHT)}>
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}

const AssistantActionBar: FC = () => {
  const labels = useAssistantLabels()

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200">
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip={labels.copy}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <Icon
              icon="lucide:check"
              className="animate-in zoom-in-50 fade-in duration-200 ease-out"
            />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <Icon
              icon="lucide:copy"
              className="animate-in zoom-in-75 fade-in duration-150"
            />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={labels.reload}>
          <Icon icon="lucide:refresh-cw" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip={labels.more}
            className="data-[state=open]:bg-accent">
            <Icon icon="lucide:ellipsis" />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-32 overflow-hidden rounded-xl border p-1.5">
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <Icon
                icon="lucide:download"
                className="size-4"
              />
              {labels.exportMarkdown}
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  )
}

const UserFilePart: FileMessagePartComponent = (part) => (
  <div
    data-slot="aui_user-message-file"
    className="py-1">
    <File {...part} />
  </div>
)

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div
    data-slot="aui_user-message-image"
    className="py-1">
    <Image {...part} />
  </div>
)

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user">
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 max-w-[min(100%,36rem)]">
        <div
          className={[
            'aui-user-message-content peer text-foreground wrap-break-word empty:hidden',
            'rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-6',
            'bg-primary/8 ring-primary/12 shadow-xs ring-1',
            'dark:bg-primary/14 dark:ring-primary/18'
          ].join(' ')}>
          <MessagePrimitive.Parts components={{ File: UserFilePart, Image: UserImagePart }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute inset-s-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  )
}

const UserActionBar: FC = () => {
  const labels = useAssistantLabels()

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end">
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton
          tooltip={labels.edit}
          className="aui-user-action-edit">
          <Icon icon="lucide:pencil" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  )
}

const EditComposer: FC = () => {
  const labels = useAssistantLabels()

  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]">
      <ComposerPrimitive.Root className="aui-edit-composer-root border-border/50 dark:border-border/60 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-2xl border bg-(--composer-bg) shadow-md">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3.5">
              {labels.cancel}
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button
              size="sm"
              className="h-8 rounded-full px-3.5 shadow-xs">
              {labels.update}
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  const labels = useAssistantLabels()

  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        'aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs',
        className
      )}
      {...rest}>
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip={labels.previous}>
          <Icon icon="lucide:chevron-left" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip={labels.next}>
          <Icon icon="lucide:chevron-right" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
