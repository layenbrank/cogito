import { Icon } from '@iconify/react/offline'
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAui,
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
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
  type FC,
  type PropsWithChildren
} from 'react'
import { Button } from '../components/button'
import { Skeleton } from '../components/skeleton'
import { COPIED_DURATION_MS, useAssistantActions } from './actions'
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments
} from './attachment.aui'
import { File } from './file'
import { ThreadFollowupSuggestions } from './follow-up-suggestions.aui'
import { Image } from './image'
import { useAssistantLabels } from './labels'
import { findMessageMarkdown } from './message-markdown'
import { CitedMarkdownText } from './message-citations'
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from './reasoning.aui'
import { ToolFallback } from './tool-fallback.aui'
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from './tool-group.aui'
import { ChatEnter, CHAT_EASE_CLASS } from './chat-motion'
import {
  ComposerQueuedStrip,
  ComposerSendButton,
  findComposerPlaceholder
} from './composer-queue.aui'
import { ComposerInput } from './composer-input.aui'
import { ComposerTriggerProvider, type ComposerTrigger, type ComposerTriggerListProps } from './composer-trigger'
import { ThreadUserMessageRuler } from './thread-user-ruler.aui'
import { ThreadUserMessageSticky } from './thread-user-sticky.aui'
import { startsNewDay } from './thread-day'
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
   * 输入框内、附件列表之上的队列/草稿预览（AI Elements Queue）。
   */
  ComposerQueue?: ComponentType | undefined
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
   * 输入框内 `@` / `/` 等触发器的**配置**（token、候选源、选中行为）。
   * 库只负责「文本+光标 → 命中窗口 → 候选列表 → 选中」，具体行为完全由 app 决定：
   * 插 chip、挂附件、执行命令、插 prompt 模板都行。
   */
  ComposerTriggers?: readonly ComposerTrigger[] | undefined
  /**
   * 渲染触发器候选列表。不传就不显示面板。
   * 组件内用 `useComposerTrigger()` 拿到 `items` / `activeIndex` / `isLoading`。
   */
  ComposerTriggerList?: ComponentType<ComposerTriggerListProps> | undefined
  /**
   * 输入框内 Ctrl/Cmd+V 带文件时接管粘贴（截图、从资源管理器复制的文件）。
   * 纯文本粘贴不受影响（没有 files 就不拦）；不传就退回浏览器默认行为。
   */
  ComposerPaste?: ((files: readonly File[]) => void | Promise<void>) | undefined
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
  const showUserRuler = useAuiState(function (state) {
    if (isNewChatView(state)) return false
    if (isHistoryLoadingView(state)) return false
    return state.thread.messages.some(function (message) {
      return message.role === 'user'
    })
  })

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ['--thread-max-width' as string]: '46rem',
        ['--composer-bg' as string]: 'var(--color-card)',
        /* Elements InputGroup 是 rounded-md；聊天气泡区略大一档仍保持克制 */
        ['--composer-radius' as string]: '0.875rem',
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
      <div
        data-slot="aui_thread-viewport-shell"
        className="relative min-h-0 flex-1">
        {showUserRuler ? <ThreadUserMessageRuler /> : null}
        {showUserRuler ? <ThreadUserMessageSticky /> : null}
        <ThreadPrimitive.Viewport
          turnAnchor="bottom"
          autoScroll
          data-slot="aui_thread-viewport"
          // 流式跟底不要 scroll-smooth：每帧插值会让滚动条疯狂跳动
          className="h-full min-h-0 overflow-x-clip overflow-y-auto">
          <div
            data-slot="aui_thread-viewport-inner"
            className="relative mx-auto flex min-h-full w-full max-w-(--thread-max-width) flex-col px-5 pt-6 sm:px-6">
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
              className={cn('flex flex-col gap-y-8 empty:hidden', isEmpty ? 'mb-0' : 'mb-8')}>
              <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
              <div
                aria-hidden
                data-slot="aui_thread-scroll-anchor"
                className="pointer-events-none h-px w-full shrink-0 overflow-anchor-auto"
              />
            </div>
          </div>
        </ThreadPrimitive.Viewport>
      </div>

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
        {/*
         * 只有欢迎态用「欢迎页式」建议；一旦有消息，就交给 composer 上方的
         * ThreadFollowupSuggestions。两者读的是同一份 thread.suggestions，
         * 这里不补 isEmpty 会同时渲染出双份候选。
         */}
        <AuiIf condition={(s) => s.thread.isEmpty && s.thread.suggestions.length > 0}>
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
  return (
    <>
      <ThreadDayMarker />
      {role === 'user' ? <UserMessage /> : <AssistantMessageComponent />}
    </>
  )
}

/**
 * 跨天时的分隔条：会话首条也起一条（历史会话通常跨天，第一条没有上下文可参照）。
 * 放在消息流里当兄弟节点，所以用负 margin 抵掉一部分 `gap-y`，别把天与天拉太开。
 */
const ThreadDayMarker: FC = () => {
  const labels = useAssistantLabels()
  const createdAt = useAuiState(function (state) {
    return state.message.createdAt
  })
  const previousCreatedAt = useAuiState(function (state) {
    if (state.message.index <= 0) return undefined
    return state.thread.messages[state.message.index - 1]?.createdAt
  })

  if (!startsNewDay(createdAt, previousCreatedAt)) return null

  return (
    <div
      data-slot="aui_thread-day-marker"
      role="separator"
      aria-label={labels.dayLabel(createdAt)}
      className="-mb-4 flex items-center gap-2.5 px-1">
      <span className="bg-border h-px flex-1" />
      <span className="text-muted-foreground text-xs">{labels.dayLabel(createdAt)}</span>
      <span className="bg-border h-px flex-1" />
    </div>
  )
}

const ThreadScrollToBottom: FC = () => {
  const labels = useAssistantLabels()

  // 仅按钮点击用 smooth；Viewport 不加 scroll-smooth，避免流式跟底每帧插值乱跳
  // 显隐用 opacity + 微位移，避免 disabled:invisible 瞬时切断过渡
  return (
    <ThreadPrimitive.ScrollToBottom
      asChild
      behavior="smooth">
      <TooltipIconButton
        tooltip={labels.scrollToBottom}
        variant="outline"
        size="icon"
        className={cn(
          'aui-thread-scroll-to-bottom border-border/50 bg-background/90 absolute -top-12 z-10 size-8 self-center rounded-full shadow-xs',
          'backdrop-blur-md supports-backdrop-filter:bg-background/75',
          'transition-[opacity,transform,background-color,box-shadow,border-color] duration-200',
          CHAT_EASE_CLASS,
          'motion-reduce:transition-none',
          'hover:border-border hover:bg-muted hover:shadow-sm',
          'active:bg-accent-active',
          'disabled:pointer-events-none disabled:opacity-0 disabled:translate-y-1 disabled:shadow-none'
        )}>
        <Icon
          icon="lucide:arrow-down"
          className="size-4"
        />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  )
}

const ThreadWelcome: FC = () => {
  const labels = useAssistantLabels()

  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in animate-in fill-mode-both text-2xl font-medium tracking-tight duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
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
    <div className="aui-thread-welcome-suggestion-display fade-in animate-in fill-mode-both duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]">
      <SuggestionPrimitive.Trigger
        send
        asChild>
        <Button
          variant="ghost"
          className="aui-thread-welcome-suggestion text-foreground hover:bg-accent h-auto gap-1.5 rounded-full border px-4 py-1.5 text-sm font-normal whitespace-nowrap shadow-none transition-colors">
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  )
}

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const labels = useAssistantLabels()
  const { ComposerTriggers, ComposerTriggerList, ComposerQueue, ComposerPaste } = useContext(
    ThreadComponentsContext
  )
  const placeholder = useAuiState(function (state) {
    return findComposerPlaceholder(
      labels,
      state.thread.messages.length > 0,
      state.thread.isRunning,
      state.thread.capabilities.queue
    )
  })

  return (
    <ComposerTriggerProvider triggers={ComposerTriggers}>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            onPaste={function (event) {
              if (!ComposerPaste) return
              const files = Array.from(event.clipboardData?.files ?? [])
              if (files.length === 0) return
              // 有文件时不要往输入框里落一串文件名
              event.preventDefault()
              void ComposerPaste(files)
            }}
            className={[
              /* 聚焦只换边色，不用 ring-[3px]（聊天气泡区会显得过粗） */
              'border-input flex w-full cursor-text flex-col gap-2.5',
              'rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding)',
              'shadow-xs transition-[border-color,box-shadow] duration-150 outline-none',
              'focus-within:border-ring/60',
              'dark:bg-input/30',
              'data-[dragging=true]:border-ring data-[dragging=true]:border-dashed',
              'data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_45%,var(--color-card))]'
            ].join(' ')}>
            <ComposerQueuedStrip />
            {ComposerQueue ? <ComposerQueue /> : null}
            <ComposerAttachments />
            <ComposerInput
              placeholder={placeholder}
              autoFocus={autoFocus}
              aria-label={labels.messageInput}
            />
            <ComposerAction />
          </div>
        </ComposerPrimitive.AttachmentDropzone>
        {ComposerTriggerList ? <ComposerTriggerList /> : null}
      </ComposerPrimitive.Root>
    </ComposerTriggerProvider>
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
        <AuiIf condition={(s) => !s.thread.isRunning || s.thread.capabilities.queue}>
          <ComposerSendButton />
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel bg-foreground text-background hover:bg-foreground/90 size-8 rounded-lg shadow-none"
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

/** 段内各状态计数（`ThreadGroupPart.counts` 所需），计数之和 = indices.length */
function toGroupCounts(
  parts: readonly PartLike[],
  indices: readonly number[]
): ThreadGroupPart['counts'] {
  let running = 0
  let complete = 0
  let incomplete = 0
  let requiresAction = 0
  for (const index of indices) {
    switch (parts[index].status.type) {
      case 'running':
        running += 1
        break
      case 'complete':
        complete += 1
        break
      case 'requires-action':
        requiresAction += 1
        break
      default:
        incomplete += 1
        break
    }
  }
  return { running, complete, incomplete, requiresAction }
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
  const status = useAuiState(function (state) {
    return state.message.status
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
        Text: CitedMarkdownText,
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
      // 流式中平铺工具卡：外层 Collapsible 在受控开合 + 高度动画下容易把内容裁成 0，
      // 看起来像「没有工具记录」。回合结束后再由 ProcessShell / ToolGroup 收纳。
      if (isRunning) {
        content = <Fragment>{children}</Fragment>
      } else {
        const group: ThreadGroupPart = {
          type: 'group-tool',
          status: toRunStatus(parts, run.indices),
          counts: toGroupCounts(parts, run.indices),
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
      }
    } else if (run.kind === 'reasoning') {
      const group: ThreadGroupPart = {
        type: 'group-reasoning',
        status: toRunStatus(parts, run.indices),
        counts: toGroupCounts(parts, run.indices),
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
      className="relative -mb-7.5 pb-7.5">
      <ChatEnter
        data-slot="aui_assistant-message-enter"
        className="min-w-0"
        offset={5}>
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
                counts: toGroupCounts(parts, processIndices),
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
            className="text-muted-foreground mt-1 flex max-w-fit items-center gap-2 py-1 text-sm"
            aria-label={labels.working}
            aria-live="polite">
            <Icon
              icon="lucide:sparkles"
              className="size-3.5 shrink-0 opacity-70"
            />
            <span className="shimmer motion-reduce:animate-none leading-none">
              {labels.working}
            </span>
          </div>
        ) : null}

        <MessageError />

        {/*
         * 用户按了停止：正文留下、末尾标一句，别让人误以为是失败。
         * `error` 交给 MessageError，这里只接「中断 / 截断」两种。
         */}
        {status?.type === 'incomplete' && status.reason !== 'error' ? (
          <div
            data-slot="aui_assistant-message-stopped"
            className="text-muted-foreground mt-1.5 flex items-center gap-1.5 text-xs">
            <Icon
              icon="lucide:square"
              className="size-2.5 shrink-0 fill-current opacity-70"
            />
            <span>{labels.stoppedRun}</span>
          </div>
        ) : null}
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn('ms-2 flex items-center', ACTION_BAR_HEIGHT)}>
        <BranchPicker />
        <AssistantActionBar />
      </div>
      </ChatEnter>
    </MessagePrimitive.Root>
  )
}

const AssistantActionBar: FC = () => {
  const labels = useAssistantLabels()
  const actions = useAssistantActions()
  const aui = useAui()
  const isCopied = useAuiState(function (state) {
    return state.message.isCopied
  })
  const canAct = useAuiState(function (state) {
    return (
      (state.message.role !== 'assistant' || state.message.status?.type !== 'running') &&
      state.message.parts.some(function (part) {
        return part.type === 'text' && part.text.length > 0
      })
    )
  })
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    function () {
      return function () {
        if (copiedTimerRef.current === undefined) return
        clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = undefined
        aui.message.setIsCopied(false)
      }
    },
    [aui]
  )

  function findMarkdown(): string {
    // 优先读 UI 同源的 parts；getCopyText() 只扫 content，在部分 runtime 下可能缺段
    return findMessageMarkdown(parts) || aui.message.getCopyText()
  }

  function markCopied() {
    if (copiedTimerRef.current !== undefined) clearTimeout(copiedTimerRef.current)
    aui.message.setIsCopied(true)
    copiedTimerRef.current = setTimeout(function () {
      copiedTimerRef.current = undefined
      aui.message.setIsCopied(false)
    }, COPIED_DURATION_MS)
  }

  function onCopy() {
    const text = findMarkdown()
    if (!text) return
    void Promise.resolve(actions.copyText(text)).then(
      function () {
        markCopied()
      },
      function (error: unknown) {
        console.error('[assistant] copy failed:', error)
      }
    )
  }

  function onExport() {
    const text = findMarkdown()
    if (!text) return
    const filename = `message-${Date.now()}.md`
    void Promise.resolve(actions.exportMarkdown(text, filename)).catch(function (error: unknown) {
      console.error('[assistant] markdown export failed:', error)
    })
  }

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground col-start-3 row-start-2 -ms-1 flex gap-1">
      <TooltipIconButton
        tooltip={labels.copy}
        disabled={!canAct}
        onClick={onCopy}>
        {isCopied ? (
          <Icon
            icon="lucide:check"
            className="fade-in animate-in duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        ) : (
          <Icon
            icon="lucide:copy"
            className="fade-in animate-in duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
          />
        )}
      </TooltipIconButton>
      <TooltipIconButton
        tooltip={labels.exportMarkdown}
        disabled={!canAct}
        onClick={onExport}>
        <Icon icon="lucide:download" />
      </TooltipIconButton>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip={labels.reload}>
          <Icon icon="lucide:refresh-cw" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
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
  const messageId = useAuiState(function (state) {
    return state.message.id
  })

  return (
    <ChatEnter
      data-slot="aui_user-message-enter"
      offset={4}>
      <MessagePrimitive.Root
        data-slot="aui_user-message-root"
        data-role="user"
        data-user-message-id={messageId}
        className="grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 [&:where(>*)]:col-start-2">
        <UserMessageAttachments />

        <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0 max-w-[min(100%,36rem)] justify-self-end">
          <div
            className={[
              'aui-user-message-content peer text-foreground wrap-break-word empty:hidden',
              'rounded-lg bg-secondary px-4 py-3 text-sm leading-6 shadow-xs'
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
    </ChatEnter>
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
      className="flex flex-col px-2">
      <ComposerPrimitive.Root className="aui-edit-composer-root border-input ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-xs dark:bg-input/30">
        <ComposerInput
          className="aui-edit-composer-input text-foreground min-h-14 bg-transparent px-4 pt-3.5 pb-1 text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">          <ComposerPrimitive.Cancel asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-md px-3.5">
              {labels.cancel}
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button
              size="sm"
              className="h-8 rounded-md px-3.5 shadow-xs">
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
