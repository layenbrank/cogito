import { Icon } from '@iconify/react/offline'
import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  type AssistantState,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type MessagePartStatus,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartStatus,
  useMessagePartText
} from '@assistant-ui/react'
import { cn } from 'cn'
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
  type ReactNode
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
import { useAssistantLabels, type AssistantLabels } from './labels'
import { findRunNote } from './run-status'
import type { RunActivityEntry, RunActivityStatus } from './run-activity'
import {
  findRunStatusLabel,
  formatRunDuration,
  partNeedsAttention,
  toActivityLabel,
  toActivitySegments,
  toRunActivityStatus,
  type PartLike
} from './run-activity-state'
import { findMessageMarkdown } from './message-markdown'
import { findMessageMoment, formatMessageTime, toDateTimeAttr } from './message-time'
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
import { ComposerChipText, resolveComposerChipLabel } from './composer-chip-text'
import { ComposerInput } from './composer-input.aui'
import { ComposerTriggerProvider, type ComposerTrigger, type ComposerTriggerListProps } from './composer-trigger'
import { MessageEditComposer } from './edit-message.aui'
import { MessageError } from './error-state.aui'
import { ThreadUserMessageRuler } from './thread-user-ruler.aui'
import { ThreadUserMessageSticky } from './thread-user-sticky.aui'
import { startsNewDay } from './thread-day'
import { TooltipIconButton } from './tooltip-icon-button'

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart

/**
 * 整轮活动流水的渲染契约（对应 `ThreadComponents.RunActivity`）。
 * 过程区已经按原时序切好，app 只负责外壳与文案；
 * `children` 是最终回答 —— 必须排在折叠区之后、常驻可见。
 */
export type ThreadRunActivityProps = {
  status: RunActivityStatus
  /** 折叠条前缀；running 时给的是「最近一条活动」的标签 */
  statusLabel: ReactNode
  /** 结算时长（`4.8s`）；running 时不传 */
  durationLabel?: ReactNode
  /** 过程区条目：解说 / 思考 / 工具，按原时序 */
  entries: readonly RunActivityEntry[]
  /** 需要用户处理的块（审批 / 出错 / 无法归类的 part）：常驻可见，不进折叠 */
  attention?: ReactNode
  /** 展开态里的附加内容（app 塞耗时统计 / 轨迹这类面板） */
  extra?: ReactNode
  /** 这一轮是否还在跑 */
  running: boolean
  /** 最终回答 */
  children?: ReactNode
}

/**
 * 回合小结的渲染契约（对应 `ThreadComponents.RunSummary`）。
 *
 * 排在**最终回答之后**，只在回合跑完时挂（流式中途挂上去会跟着每次写入闪变）。
 * 内容完全由宿主决定：库只给 `parts` 与结束状态，不猜「这一轮改了什么」——
 * 没有内容可写就返回 `null`，那一轮就什么都不渲染。
 */
export type ThreadRunSummaryProps = {
  /** 这一轮的 part（含工具调用），宿主自己挑要统计的部分 */
  parts: readonly { readonly type: string }[]
  /** 回合怎么结束的（complete / cancelled / error …），宿主可据此只在小结有意义时渲染 */
  status: RunActivityStatus
}

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
   * 整轮「活动流水」折叠条（`elements/run-activity` 口径）：把过程区收成
   * 一条「已工作 4.8s」+ 时间线（解说 / 思考 / 工具按原时序排），最终回答留在外面。
   *
   * 与 `ProcessGroup` 的区别是**谁拥有排版**：`ProcessGroup` 只接管「过程区的外壳」，
   * 里面还是分段渲染（思考一条、工具一组）；这里直接把过程区摊成条目，
   * 一轮只有一条折叠条。传了它才走这条路径 —— 没传的 app 沿用分段渲染。
   */
  RunActivity?: ComponentType<ThreadRunActivityProps> | undefined
  /**
   * 回合小结（排在最终回答之后、只为「跑完的回合」渲染）。
   *
   * client 用它挂 `elements/file-tree` 的改动文件树：一轮改了哪些文件、每个文件
   * 增删多少。**内容由宿主决定** —— 库传 `parts`，没有可小结的东西就返回 `null`。
   * 与 `RunActivity` 不冲突：那个折的是「过程」，这个摊的是「结果」。
   */
  RunSummary?: ComponentType<ThreadRunSummaryProps> | undefined
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
  /**
   * 把文件**拖进**输入框时接管（与 `ComposerPaste` 对称）。
   *
   * 粘贴走 `clipboardData.files`、拖拽走 `DataTransfer.files`，两条入口语义必须一致，
   * 否则同一张截图「粘进来是 @引用、拖进来是附件」。不传就退回
   * `AttachmentDropzone` 的默认行为（只挂附件，不接工作区引用）。
   */
  ComposerDrop?: ((files: readonly File[]) => void | Promise<void>) | undefined
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

  if (isEditing) return <MessageEditComposer />
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
  const { ComposerTriggers, ComposerTriggerList, ComposerQueue, ComposerPaste, ComposerDrop } =
    useContext(ThreadComponentsContext)
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
      <ComposerPrimitive.Root className="@container aui-composer-root relative flex w-full flex-col">
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
            onDragOver={function (event) {
              if (!ComposerDrop) return
              if (!event.dataTransfer?.types.includes('Files')) return
              // 不 preventDefault 的话浏览器会把文件当导航目标（整页跳走）
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={function (event) {
              if (!ComposerDrop) return
              const files = Array.from(event.dataTransfer?.files ?? [])
              if (files.length === 0) return
              // 同时挡住 AttachmentDropzone 的附件通道：否则同一张图会走两条语义
              event.preventDefault()
              event.stopPropagation()
              void ComposerDrop(files)
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
            {/*
             * 队列面板与默认条**二选一**：外部传了 ComposerQueue 就只渲染它，
             * 否则退回 design 包里那条只有「立即发 / 删除」的默认条。
             * 两个都渲染会让同一条排队消息在输入框上方出现两遍。
             */}
            {ComposerQueue ? <ComposerQueue /> : <ComposerQueuedStrip />}
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
    <div className="aui-composer-action-wrapper relative flex min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {ComposerStart ? <ComposerStart /> : null}
        {ComposerAttach === null ? null : ComposerAttach ? (
          <ComposerAttach />
        ) : (
          <ComposerAddAttachment />
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        {ComposerEnd ? (
          <div className="min-w-0">
            <ComposerEnd />
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1.5">
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
    </div>
  )
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

/* ------------------------------ 整轮活动流水 ------------------------------ */

interface RunActivityModel {
  entries: RunActivityEntry[]
  attention: ReactNode[]
  /** running 时折叠条上显示的「最近一条活动」 */
  latestLabel: string | undefined
}

/**
 * 把过程区摊成活动流水：解说 / 思考进条目，工具进条目（审批与失败例外），
 * 未知 part 进 attention。`latestLabel` 取最后一条有标签的条目 —— 流式中
 * 折叠条显示它，用户不用展开也知道现在在干什么。
 */
function buildRunActivity(
  parts: readonly PartLike[],
  to: number,
  renderLeaf: (index: number) => ReactNode,
  labels: AssistantLabels
): RunActivityModel {
  const entries: RunActivityEntry[] = []
  const attention: ReactNode[] = []
  let latestLabel: string | undefined

  for (const segment of toActivitySegments(parts, 0, to)) {
    const first = segment.indices[0]

    if (segment.kind === 'other') {
      for (const index of segment.indices) attention.push(renderLeaf(index))
      continue
    }

    if (segment.kind === 'tool') {
      const part = parts[first]
      if (partNeedsAttention(part)) {
        attention.push(renderLeaf(first))
        continue
      }
      const label = part.toolName ? labels.runToolActivity(part.toolName) : undefined
      entries.push({
        id: `tool-${part.toolCallId ?? first}`,
        kind: 'tool',
        label,
        content: renderLeaf(first)
      })
      latestLabel = label ?? latestLabel
      continue
    }

    if (segment.kind === 'reasoning') {
      // 折叠条 running 时显示的是「最近一条活动」，所以这一段**还在跑**时必须给实时文案
      // （「思考中…」）；给完成时的 `labels.reasoning()` 会退化成光秃秃的「思考」，
      // 看起来像会话已经终止（用户反馈的原话：只剩「思考」两个字，像卡住了）。
      const segmentRunning = toRunStatus(parts, segment.indices).type === 'running'
      const label = segmentRunning ? labels.working : labels.reasoning()
      entries.push({
        id: `reasoning-${first}`,
        kind: 'reasoning',
        label,
        content: segment.indices.map(function (index) {
          return renderLeaf(index)
        })
      })
      latestLabel = label
      continue
    }

    const label = toActivityLabel(parts[segment.indices[segment.indices.length - 1]].text)
    entries.push({
      id: `commentary-${first}`,
      kind: 'commentary',
      label,
      content: segment.indices.map(function (index) {
        return renderLeaf(index)
      })
    })
    latestLabel = label ?? latestLabel
  }

  return { entries, attention, latestLabel }
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
 * 回合尾注：这一轮怎么结束的（完成 / 停止 / 截断 / 中断）。
 * 口径与文案在 `run-status.ts`，这里只负责渲染。
 */
const AssistantRunStatus: FC = () => {
  const labels = useAssistantLabels()
  const status = useAuiState(function (state) {
    return state.message.status
  })
  const isLast = useAuiState(function (state) {
    return state.message.isLast
  })
  const createdAt = useAuiState(function (state) {
    return state.message.createdAt
  })
  const totalStreamTime = useAuiState(function (state) {
    return state.message.metadata.timing?.totalStreamTime
  })
  const note = findRunNote(status, isLast, labels)
  // 时间挂在「这一轮结束那一刻」：还在跑时它没有意义（会在每次写入后跳）
  const moment = status?.type === 'running' ? undefined : findMessageMoment(createdAt, totalStreamTime)
  const stamp = formatMessageTime(moment)
  if (!note && !stamp) return null

  return (
    <div
      data-slot="aui_assistant-message-run-status"
      data-tone={note?.tone ?? 'time'}
      className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-1.5 text-xs"
      aria-live="polite">
      {note ? (
        <>
          <Icon
            icon={note.icon}
            className={cn('shrink-0 opacity-70', note.iconClassName)}
          />
          <span>{note.text}</span>
        </>
      ) : null}
      {note && stamp ? (
        <span
          aria-hidden
          className="bg-border/70 h-3 w-px"
        />
      ) : null}
      {/* 失败 / 截断的回合同样有时间：那正是「什么时候断的」最要紧的场面 */}
      {stamp ? (
        <time
          data-slot="aui_message-time"
          dateTime={toDateTimeAttr(moment)}
          className="font-mono tabular-nums opacity-80">
          {stamp}
        </time>
      ) : null}
    </div>
  )
}

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
    ProcessGroup: ProcessShell = DefaultProcessGroup,
    RunActivity: RunActivityShell,
    RunSummary: RunSummaryShell
  } = useContext(ThreadComponentsContext)

  const labels = useAssistantLabels()
  const parts = useAuiState(function (state) {
    return state.message.parts
  })
  const isRunning = useAuiState(function (state) {
    return state.message.status?.type === 'running'
  })
  const messageStatus = useAuiState(function (state) {
    return state.message.status
  })
  /** 回合的结算时长（毫秒）：活动流水折叠条拿它写「已工作 4.8s」 */
  const totalStreamTime = useAuiState(function (state) {
    return state.message.metadata.timing?.totalStreamTime
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

  /**
   * 整轮活动流水：app 传了 `RunActivity` 才走这条路径。
   * 只有「动过手」的回合才收成一条 —— 一次「思考 → 答」没有展开的必要，
   * 里层那条思考条自己就够用（与改造前一致）。
   */
  const usesRunActivity = RunActivityShell !== undefined && hasToolCalls
  const runActivity = usesRunActivity
    ? buildRunActivity(parts, responseStart, renderLeaf, labels)
    : null
  const runStatus = toRunActivityStatus(messageStatus)
  const runIsRunning = runStatus === 'running'
  const runDurationLabel =
    runIsRunning || totalStreamTime === undefined || totalStreamTime <= 0
      ? undefined
      : formatRunDuration(totalStreamTime)
  // running 时折叠条显示「最近一条活动」：用户不用展开就知道现在在跑什么
  const runStatusLabel = runIsRunning
    ? (runActivity?.latestLabel ?? labels.runWorking)
    : findRunStatusLabel(runStatus, labels, runDurationLabel !== undefined)

  /** 最终回答：两条渲染路径共用，常驻可见 */
  const finalAnswer = parts.slice(responseStart).map(function (_part, offset) {
    return renderLeaf(responseStart + offset)
  })

  // 最后一段不是「正在跑的正文」时补一个脉冲点，别让消息区空着。
  // 注意 `reasoning` 已跑完（status 不是 running）也要补：模型想完还没吐第一个字的空档里，
  // 界面上就只剩一行「已思考」，看着像会话断了（用户反馈：只剩「思考」两个字，像卡住）。
  const lastPart = parts[parts.length - 1]
  const lastPartRunning = lastPart !== undefined && lastPart.status.type === 'running'
  const showIndicator =
    !usesRunActivity &&
    isRunning &&
    (lastPart === undefined || (lastPart.type !== 'text' && !lastPartRunning))

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
        {usesRunActivity && runActivity ? (
          /*
           * 活动流水：一轮一条折叠条（「已工作 4.8s」/ 运行中是「最近一条活动」），
           * 展开是解说 / 思考 / 工具的原始时序；最终回答由元素排在折叠区之后。
           * 审批与失败的工具进 attention，永远在折叠区外面。
           */
          <RunActivityShell
            status={runStatus}
            statusLabel={runStatusLabel}
            durationLabel={runDurationLabel}
            entries={runActivity.entries}
            attention={
              runActivity.attention.length > 0 ? (
                <div
                  data-slot="aui_assistant-message-attention"
                  className="mb-1 flex flex-col gap-1">
                  {runActivity.attention}
                </div>
              ) : undefined
            }
            running={isRunning}>
            {finalAnswer}
          </RunActivityShell>
        ) : (
          <>
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

            {finalAnswer}
          </>
        )}

        {/*
         * 回合小结：排在最终回答之后，**只在回合结束时**挂 —— 流式中途挂上去会跟着
         * 每次写入闪变（还没写完的文件先出现、再跳数字）；等审批时也不算结束。
         * 宿主组件自己决定有没有内容，没有改过文件就返回 null，这里不会留下空壳。
         */}
        {RunSummaryShell && runStatus !== 'running' && runStatus !== 'requires-action' ? (
          <div
            data-slot="aui_assistant-message-run-summary"
            className="mt-3">
            <RunSummaryShell
              parts={parts}
              status={runStatus}
            />
          </div>
        ) : null}

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
         * 回合尾注：跑完 / 停止 / 截断 / 中断各给一句话。
         * 正文末尾没有字的时候，用户分不清「模型说完了」和「界面悄悄断了」。
         */}
        <AssistantRunStatus />
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

/** 已发送气泡：directive 与 composer 同款 chip，不露 `:file[...]{...}` 原文 */
const UserTextPart: TextMessagePartComponent = function UserTextPart() {
  const { text } = useMessagePartText()
  return (
    <ComposerChipText
      text={text}
      resolveLabel={resolveComposerChipLabel}
    />
  )
}

/** 气泡默认封顶 11 行左右：历史会话里一屏能多看几条，超了就收起来给「展开全文」 */
const USER_BUBBLE_MAX_HEIGHT_PX = 264

/**
 * 用户气泡正文：超过封顶高度就裁掉并给一个展开开关。
 *
 * 只在**折叠态**量 `scrollHeight`（展开后两者相等，再量会把按钮收回去）；
 * 量的是外层受 `max-height` 约束的盒子，所以 `scrollHeight` 仍是全文高度。
 */
const UserMessageBody: FC = () => {
  const labels = useAssistantLabels()
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(
    function measure() {
      const node = ref.current
      if (!node || expanded) return
      setOverflowing(node.scrollHeight > node.clientHeight + 1)
    },
    [expanded]
  )

  return (
    <div
      data-slot="aui_user-message-body-shell"
      className="relative min-w-0">
      <div
        ref={ref}
        data-slot="aui_user-message-body"
        data-expanded={expanded || undefined}
        data-overflowing={overflowing || undefined}
        style={
          overflowing && !expanded ? { maxHeight: `${USER_BUBBLE_MAX_HEIGHT_PX}px` } : undefined
        }
        className={[
          'aui-user-message-content text-foreground wrap-break-word empty:hidden',
          'rounded-lg bg-secondary px-4 py-3 text-sm leading-6 shadow-xs',
          'overflow-hidden'
        ].join(' ')}>
        <MessagePrimitive.Parts
          components={{ Text: UserTextPart, File: UserFilePart, Image: UserImagePart }}
        />
      </div>
      {/* 裁断处渐隐，避免看起来像「消息就到这儿」 */}
      {overflowing && !expanded ? (
        <div
          aria-hidden
          data-slot="aui_user-message-fade"
          className="from-secondary pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-linear-to-t to-transparent"
        />
      ) : null}
      {overflowing ? (
        <button
          type="button"
          data-slot="aui_user-message-expand"
          aria-expanded={expanded}
          onClick={function () {
            setExpanded(function (value) {
              return !value
            })
          }}
          className={cn(
            'text-muted-foreground hover:text-foreground mt-1 ms-1 inline-flex items-center gap-1 rounded text-xs',
            'transition-colors duration-150 underline-offset-2 hover:underline',
            CHAT_EASE_CLASS,
            'motion-reduce:transition-none'
          )}>
          <Icon
            icon={expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'}
            className="size-3"
          />
          {expanded ? labels.userMessageCollapse : labels.userMessageExpand}
        </button>
      ) : null}
    </div>
  )
}

const UserMessage: FC = () => {
  const messageId = useAuiState(function (state) {
    return state.message.id
  })
  const createdAt = useAuiState(function (state) {
    return state.message.createdAt
  })
  // 只有附件、没有正文时不挂编辑按钮（旧界面靠 peer-empty 干这件事）
  const hasText = useAuiState(function (state) {
    return state.message.parts.some(function (part) {
      return part.type === 'text' && part.text.trim().length > 0
    })
  })
  const stamp = formatMessageTime(createdAt)

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
          <UserMessageBody />
          <div
            className={cn(
              'aui-user-action-bar-wrapper absolute inset-s-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 rtl:translate-x-full',
              hasText ? undefined : 'hidden'
            )}>
            <UserActionBar />
          </div>
          {/* 消息时间：年月日时分秒，端点对齐气泡右边 */}
          {stamp ? (
            <time
              data-slot="aui_user-message-time"
              dateTime={toDateTimeAttr(createdAt)}
              className="text-muted-foreground/70 mt-1 block text-end font-mono text-xs tabular-nums">
              {stamp}
            </time>
          ) : null}
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
