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
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
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
import { useAssistantLabels, type AssistantLabels } from './labels'
import { findRunNote } from './run-status'
import {
  findResponseStart,
  toProcessDigest,
  toProcessRows,
  toProcessRuns,
  toRunActivityStatus,
  toRunCounts,
  toRunStatus,
  type ProcessDigest,
  type ProcessDigestEntry,
  type ProcessRun,
  type RunActivityStatus
} from './process-state'
import { findMessageMarkdown } from './message-markdown'
import { findMessageMoment, formatMessageTime, toDateTimeAttr } from './message-time'
import { CitedMarkdownText, useMessageSources } from './message-citations'
import { SourceChips } from './sources'
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from './reasoning.aui'
import { ToolFallback } from './tool-fallback.aui'
import { ChatEnter, CHAT_EASE_CLASS } from './chat-motion'
import { useCollapseScrollPin } from './collapse-scroll-pin'
import {
  ComposerQueuedStrip,
  ComposerSendButton,
  findComposerPlaceholder
} from './composer-queue.aui'
import { ComposerChipText, resolveComposerChipLabel } from './composer-chip-text'
import { ComposerInput } from './composer-input.aui'
import {
  ComposerTriggerProvider,
  type ComposerTrigger,
  type ComposerTriggerListProps
} from './composer-trigger'
import { MessageEditComposer } from './edit-message.aui'
import { MessageError } from './error-state.aui'
import { ThreadUserMessageRuler } from './thread-user-ruler.aui'
import { ThreadUserMessageSticky } from './thread-user-sticky.aui'
import { startsNewDay } from './thread-day'
import { TooltipIconButton } from './tooltip-icon-button'
import { UserMessageBadgeSlot } from './user-message-badge'

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart

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
/** 收起态明细的一行：动词（读取 / 运行 / 已思考）已由 labels 翻译，外壳只负责排版 */
export type ProcessSummaryLine = { verb: string; detail?: string }

/**
 * 总折叠收起后仍要交代的「详细信息」：
 * - `detail`：构成行（`4 次工具 · 1 段思考`），跑的时候换成当前那一步；
 * - `lines`：逐步明细（工具一件一条、思考一段一条），最多 `PROCESS_SUMMARY_LINES` 条；
 * - `hidden`：超出上限、没列出来的步数。
 *
 * 由 `AssistantMessage` 现算后交给外壳 —— 宿主覆盖 `ProcessGroup` 时拿到的是同一份，
 * 不用自己再扫一遍 parts。
 */
export type ProcessSummary = {
  detail?: string
  lines: ProcessSummaryLine[]
  hidden: number
}

export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  ToolFallback?: ToolCallMessagePartComponent | undefined
  ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
  ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
  /**
   * 整轮「过程」的外壳（**总折叠**）：思考 / 工具 / 解说按原时序排在它里面，
   * 最终回答留在外面常驻可见。外壳里**仍然是逐块折叠**（思考一段一条、工具一件一行），
   * 所以收起它只是把整轮过程收成一行，展开后每一块还能各自开合。
   *
   * 默认只在过程占不止一行时出现 —— 一次「思考 → 答」只有一行，外面再套一层是噪音。
   * `running` 是整条消息是否在跑：跑的时候自动展开、跑完自动收起（用户点过就以用户为准）。
   * `steps` / `seconds` 只喂折叠行文案：秒数在结算后才传（跑的时候数字一跳一跳）。
   * `summary` 是收起后仍要交代的详细信息（构成 + 逐步明细）：不传就只有一行「过程 · N 步」。
   */
  ProcessGroup?:
    | ComponentType<
        PropsWithChildren<{
          group: ThreadGroupPart
          running: boolean
          steps: number
          seconds?: number
          summary?: ProcessSummary
          /**
           * 这一轮在等人处理（审批 / 补充信息）：`running` 为 false 但**不能自动收起** ——
           * 收起来就把「允许 / 拒绝」按钮藏进折叠里了。用户手动收过仍然以用户为准。
           */
          attention?: boolean
        }>
      >
    | undefined
  /**
   * 过程区之后的一行宿主指标（client 塞首字 / 速度 / token）：套外壳时排在外壳内容最末、
   * 跟着外壳一起收起；过程只有一块（没外壳）时直接跟在那一块后面。
   */
  ProcessFooter?: ComponentType | undefined
  /**
   * 回合小结（排在最终回答之后、只为「跑完的回合」渲染）。
   *
   * client 用它挂 `elements/file-tree` 的改动文件树：一轮改了哪些文件、每个文件
   * 增删多少。**内容由宿主决定** —— 库传 `parts`，没有可小结的东西就返回 `null`。
   * 与过程区不冲突：那个折的是「过程」，这个摊的是「结果」。
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

/** 收起态明细最多列几行：再多就该展开了，剩下折成「还有 N 步」 */
const PROCESS_SUMMARY_LINES = 5

/**
 * 明细条目 → 一行「动词 + 参数」：动词走 labels（读取 / 运行 / 已思考），参数已截断。
 * `active` 只对思考块有意义：进行中是「思考中…」，跑完才是「已思考」—— 同一个词
 * 两处混用就会出现「已思考」却在流式增长的怪状态。
 */
function formatDigestEntry(
  entry: ProcessDigestEntry,
  labels: AssistantLabels,
  active = false
): ProcessSummaryLine {
  if (entry.kind === 'tool') {
    return { verb: labels.timelineVerb(entry.toolName), detail: entry.detail }
  }
  if (entry.kind === 'thinking') {
    return { verb: active ? labels.working : labels.reasoning(), detail: entry.hint }
  }
  return { verb: labels.processNote, detail: entry.text }
}

/**
 * 收起态要显示的信息：跑的时候是「当前这一步」，结算后是「这一轮构成了什么」。
 * 明细与构成行都从 part 现算，不读渲染结果 —— 收起与否都指向同一份事实。
 */
function toProcessSummary(
  digest: ProcessDigest,
  labels: AssistantLabels,
  running: boolean
): ProcessSummary {
  const total = digest.entries.length
  const lastIndex = total - 1
  /**
   * 跑的时候列**最近**几步（收起来的多半是想看「现在走到哪」）；
   * 结算后从第一步开始列（回看「这一轮怎么走过来的」）。两头的尾巴都折成「还有 N 步」。
   */
  const startIndex = running ? Math.max(0, total - PROCESS_SUMMARY_LINES) : 0
  const lines = digest.entries
    .slice(startIndex, startIndex + PROCESS_SUMMARY_LINES)
    .map(function (entry, offset) {
      return formatDigestEntry(entry, labels, running && startIndex + offset === lastIndex)
    })
  const last = digest.entries[lastIndex]
  const current = last ? formatDigestEntry(last, labels, running) : undefined
  const hidden = Math.max(0, total - lines.length)
  /**
   * 结算后的构成行只在**清单列不全**时给：5 条以内清单已经把工具 / 思考 / 说明逐条摆出来了，
   * 头顶再报一遍「4 次工具 · 1 段思考」就是同一件事说两遍；超过 5 条才用它交代被折掉的总量。
   */
  const detail = running
    ? current && [current.verb, current.detail].filter(Boolean).join(' · ')
    : hidden > 0
      ? labels.processDetail(digest.tools, digest.thoughts, digest.notes)
      : ''

  return {
    detail: detail || undefined,
    lines,
    hidden
  }
}

/**
 * 收起态的明细清单：把整轮过程摊成几行（工具一件一条、思考一段一条），
 * 让「收起」不至于变成「什么都不知道」。点一下展开，展开后这里就不排了 ——
 * 明细由各块自己的折叠条接管，同一信息不重复摆两遍。
 */
function ProcessOutline(props: { summary?: ProcessSummary; onOpen: () => void }) {
  const labels = useAssistantLabels()
  const lines = props.summary?.lines ?? []
  if (lines.length === 0) return null

  return (
    <div className="ps-4">
      <button
        type="button"
        data-slot="aui_assistant-process-outline"
        aria-expanded={false}
        className="text-muted-foreground hover:text-foreground flex w-full min-w-0 flex-col gap-0.5 pb-0.5 text-start text-xs transition-colors"
        onClick={props.onOpen}>
        {lines.map(function (line, index) {
          return (
            <span
              key={index}
              className="flex min-w-0 items-baseline gap-1.5">
              <span className="aui_assistant-process-outline-verb shrink-0 opacity-80">
                {line.verb}
              </span>
              {line.detail ? (
                <span
                  title={line.detail}
                  className="aui_assistant-process-outline-detail min-w-0 truncate opacity-60">
                  {line.detail}
                </span>
              ) : null}
            </span>
          )
        })}
        {props.summary && props.summary.hidden > 0 ? (
          <span className="aui_assistant-process-outline-more opacity-50">
            {labels.processMore(props.summary.hidden)}
          </span>
        ) : null}
      </button>
    </div>
  )
}

/**
 * 内置的总折叠外壳：过程按块排在里面，外层只负责「整轮收成一行」。
 *
 * 开合：跑的时候自动展开（能看见在干什么），结算后自动收起；用户点过之后以用户为准。
 * 自动收起**晚一帧**并先钉滚动（`useCollapseScrollPin`）—— 同一 commit 收起来，
 * 面板高度已归零，贴底读回答的人会看到正文被顶上跳一截。
 * 内容不走 `ReasoningText`（那是给思考正文准备的，带 60vh 内层滚动）——
 * 这里装的是会自己折叠的块，不需要第二层滚动条。
 */
export function DefaultProcessGroup(
  props: PropsWithChildren<{
    group: ThreadGroupPart
    running: boolean
    steps: number
    seconds?: number
    summary?: ProcessSummary
    attention?: boolean
  }>
) {
  const labels = useAssistantLabels()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const armCollapsePin = useCollapseScrollPin(rootRef)
  /**
   * 用户在中间点过就以用户为准，否则跟着「这一轮是否在跑」走：
   * 跑的时候要看，跑完不想看（Cursor / Copilot 的手感）。
   */
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  /**
   * 「该展开」的时机：在跑，或者卡在等人处理。审批按钮（允许 / 拒绝）是必须点到的，
   * 自动收起来等于把它藏了 —— 这一条与「跑完就收」不冲突，只是不把 actionable 的状态算成跑完。
   */
  const wantsOpen = props.running || props.attention === true
  /**
   * 自动开合**晚一帧**生效：结算时先把滚动钉住，再由下一帧塌下去。
   * 同一 commit 里收起来，面板高度已经归零，`armCollapsePin` 量不到东西 ——
   * 贴底读回答的人会看到正文被顶上跳一截。
   */
  const [autoOpen, setAutoOpen] = useState(wantsOpen)
  const isOpen = userOpen ?? autoOpen

  // 用 layout effect（而不是 effect）：钉完立刻塌，用户不会先看到一帧完整过程
  useLayoutEffect(
    function () {
      if (autoOpen === wantsOpen) return
      if (!wantsOpen && userOpen === null) armCollapsePin()
      // 不是「用 effect 同步状态」，而是把自动收起推迟到能测量之后
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上
      setAutoOpen(wantsOpen)
    },
    [armCollapsePin, autoOpen, wantsOpen, userOpen]
  )

  /**
   * 「N 步」只在**没有明细清单**时写：收起后清单已经把每一步列出来了，再报一次总数
   * 就是同一件事说两遍（工具 + 思考 + 说明正好等于步数）。
   */
  const showSteps = props.running || (props.summary?.lines.length ?? 0) === 0
  /**
   * 折叠行那一格只在「没有别处能读到」时才写：
   * - 跑着 + 展开：给**当前这一步**；
   * - 跑着 + 收起：清单最后一行就是当前这一步，不复述；
   * - 结算 + 收起：清单列得全就没有 detail，只有被截断时才有构成行；
   * - 结算 + 展开：块就在下面，构成行是同一份内容的复述。
   */
  const showDetail = props.running ? isOpen : !isOpen
  const detail = showDetail ? props.summary?.detail : undefined

  return (
    <div
      ref={rootRef}
      data-slot="aui_assistant-process-shell"
      className="min-w-0">
      <ReasoningRoot
        variant="ghost"
        open={isOpen}
        onOpenChange={function (next) {
          setUserOpen(next)
        }}
        streaming={props.running}>
        <ReasoningTrigger
          active={props.running}
          label={labels.process(showSteps ? props.steps : undefined, props.seconds)}
          detail={detail}
        />
        <ReasoningContent aria-busy={props.running}>
          <div
            data-slot="aui_assistant-process-blocks"
            className="flex min-w-0 flex-col gap-1 pt-1">
            {props.children}
          </div>
        </ReasoningContent>
        {/* 收起时仍要交代「刚才走了哪几步」：展开后由各块的折叠条接管，这里不再重复 */}
        {isOpen ? null : (
          <ProcessOutline
            summary={props.summary}
            onOpen={function () {
              setUserOpen(true)
            }}
          />
        )}
      </ReasoningRoot>
    </div>
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
  const moment =
    status?.type === 'running' ? undefined : findMessageMoment(createdAt, totalStreamTime)
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
 * 助手消息 = 过程区（总折叠 + 子折叠）+ 最终回答。
 *
 * 两层各管一件事：外层（`ProcessGroup`）收起 = 整轮过程收成一行；里层每块自己开合
 * （思考一段一条、工具一件一行，中间解说直接摊开）。只留外层就看不见走了哪几步，
 * 只留里层在几十步的一轮里会摊满一屏 —— 两层都要，才是 Cursor 那种分层读法。
 *
 * 叶子 part 统一走 `MessagePrimitive.PartByIndex`：注册过的工具 / data UI 由库优先接管
 * （`MessagePartComponent` 内部查 `toolUIs` / `dataRenderers`），这里只提供兜底组件。
 */
/**
 * 消息级来源芯片行（assistant-ui `elements/sources`）。
 *
 * 位置很关键：它属于**消息**，不属于某一张工具卡 —— 一条回答里可能调了三次联网检索，
 * 用户要看的是「这条回答参考了哪些东西」，而不是「第三个工具调用的返回里有什么」。
 * 数据走 `useMessageSources`：与正文 `[1]` 角标同一份 aggregator，已按出现顺序去重。
 */
const MessageSources: FC = () => {
  const sources = useMessageSources()
  if (sources.length === 0) return null
  return (
    <div
      data-slot="aui_assistant-message-sources"
      className="-mx-1 mt-2">
      <SourceChips
        sources={sources}
        variant="muted"
      />
    </div>
  )
}

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    ProcessGroup: ProcessShell = DefaultProcessGroup,
    RunSummary: RunSummaryShell,
    ProcessFooter
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
  /** 哪一步做完的结算时长（毫秒）：总折叠行上写「· 5 秒」 */
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
    // 工具件件平铺：每张工具卡自己就是一条折叠行（`ToolFallback.Root`），
    // 再套一层「N 次工具调用」只是把这一轮的手脚又收成一条 —— 宿主显式要分组时才给（`ToolGroup`）。
    let content = <Fragment>{children}</Fragment>

    if (run.kind === 'reasoning') {
      const group: ThreadGroupPart = {
        type: 'group-reasoning',
        status: toRunStatus(parts, run.indices),
        counts: toRunCounts(parts, run.indices),
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
    } else if (run.kind === 'tool' && ToolGroup && run.indices.length > 1) {
      // 可选：宿主传了 `ToolGroup` 就把连续工具收成一组（默认不分组）
      const group: ThreadGroupPart = {
        type: 'group-tool',
        status: toRunStatus(parts, run.indices),
        counts: toRunCounts(parts, run.indices),
        indices: run.indices
      }
      content = <ToolGroup group={group}>{children}</ToolGroup>
    }

    return <Fragment key={runIndex}>{content}</Fragment>
  }

  const runStatus = toRunActivityStatus(messageStatus)
  const runIsRunning = runStatus === 'running'
  /**
   * 过程占几行（思考一段一行、工具**一件一行**、解说各一行）：总折叠上的「N 步」按行算。
   * 按块算会把「连续 5 次工具调用」写成「1 步」，与展开后看到的五行对不上。
   */
  const processSteps = toProcessRows(processRuns)
  /**
   * 总折叠只在过程不止一行时套：一次「思考 → 答」只有一行，
   * 外面再套一层「过程 · 1 步」纯属噪音。
   */
  const useProcessShell = processSteps > 1
  /**
   * 结算后才写「用了多久」：跑的时候这个数一跳一跳，写进总折叠行只是噪音；
   * 至少 1 秒（快到不足 1 秒的回合显示「0 秒」比不写还奇怪）。
   */
  const processSeconds =
    !runIsRunning && totalStreamTime !== undefined && totalStreamTime > 0
      ? Math.max(1, Math.round(totalStreamTime / 1000))
      : undefined
  /** 过程块本身：每一块自己折叠，外面套不套壳都一样排 */
  const processBlocks = processRuns.map(renderRun)
  /** 收起后要显示的详细信息：构成 + 逐步明细（工具一件一条） */
  const processDigest = useMemo(
    function () {
      return toProcessDigest(parts, processRuns)
    },
    [parts, processRuns]
  )
  const processSummary = useMemo(
    function () {
      return toProcessSummary(processDigest, labels, runIsRunning)
    },
    [processDigest, labels, runIsRunning]
  )
  /**
   * 过程区尾注（首字 / 速度 / token）：跟着过程区走，套不套外壳都挂、收起时一起藏。
   * 过程为空（直接就是一段回答）时不给 —— 那时这些指标只是在回答头顶多一行数字。
   */
  const processFooter =
    ProcessFooter && processSteps > 0 ? (
      <div className="mt-1">
        <ProcessFooter />
      </div>
    ) : null

  /** 最终回答：按原时序排在最末，常驻可见 */
  const finalAnswer = parts.slice(responseStart).map(function (_part, offset) {
    return renderLeaf(responseStart + offset)
  })

  // 最后一段不是「正在跑的正文」时补一个脉冲点，别让消息区空着。
  // 注意 `reasoning` 已跑完（status 不是 running）也要补：模型想完还没吐第一个字的空档里，
  // 界面上就只剩一行「已思考」，看着像会话断了（用户反馈：只剩「思考」两个字，像卡住）。
  const lastPart = parts[parts.length - 1]
  const lastPartRunning = lastPart !== undefined && lastPart.status.type === 'running'
  const showIndicator =
    isRunning && (lastPart === undefined || (lastPart.type !== 'text' && !lastPartRunning))

  // 供「最占上下文 Top 5」跳转定位（与 user 消息的 data-user-message-id 对齐）
  const messageId = useAuiState(function (state) {
    return state.message.id
  })

  const ACTION_BAR_PT = 'pt-1.5'
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      data-message-id={messageId}
      className="relative -mb-7.5 pb-7.5">
      <ChatEnter
        data-slot="aui_assistant-message-enter"
        className="min-w-0"
        offset={5}>
        <div
          data-slot="aui_assistant-message-content"
          className="text-foreground px-1 text-sm leading-7 wrap-break-word">
          {/*
           * 过程区 = **总折叠 + 子折叠**。
           * 外层（`ProcessGroup`）只在过程不止一行时出现：收起它 = 一行构成 + 逐步明细；
           * 展开后每块自己还能收（思考一段一条、工具一件一行）。最终回答在外壳外面，永远可见。
           */}
          {useProcessShell ? (
            <ProcessShell
              group={{
                type: 'group-process',
                status: toRunStatus(parts, processIndices),
                counts: toRunCounts(parts, processIndices),
                indices: processIndices
              }}
              running={runIsRunning}
              steps={processSteps}
              seconds={processSeconds}
              summary={processSummary}
              attention={runStatus === 'requires-action'}>
              {processBlocks}
              {processFooter}
            </ProcessShell>
          ) : (
            <Fragment>
              {processBlocks}
              {processFooter}
            </Fragment>
          )}

          {finalAnswer}

          {/*
           * 来源芯片行：跟在最终回答后面，属于这条消息（不是某张工具卡）。
           * 没有来源时组件自己返回 null，这里不留空壳。
           */}
          <MessageSources />

          {/*
           * 回合小结：排在最终回答之后，**只在回合结束时**挂 —— 流式中途挂上去会跟着
           * 每次写入闪变（还没写完的文件先出现、再跳数字）；等审批时也不算结束。
           * 宿主组件自己决定有没有内容，没有改过文件就返回 null，这里不会留下空壳。
           */}
          {RunSummaryShell && runStatus !== 'running' && runStatus !== 'requires-action' ? (
            <div
              data-slot="aui_assistant-message-run-summary"
              className="mt-3 -mx-1">
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

/** 气泡封顶 11 行左右：历史会话里一屏能多看几条；超出的部分在框里滚，不做展开 / 收起 */
const USER_BUBBLE_MAX_HEIGHT_PX = 264

/**
 * 用户气泡正文：长消息**一律封顶 264px 并在框里滚动**，不做展开 / 收起。
 *
 * 高度既然已经限死，多一颗开关只会添乱 —— 它得挂在框的下沿才顺手，而框一长高就把它
 * 顶下去几百像素（这就是「跳」的来源）；挂上面又反直觉。所以干脆不要开关：滚轮/触摸
 * 在气泡内部滑到底就能读完，底部渐隐负责提示「还有」。
 *
 * 量法：直接跟封顶高度比。max-height 是常量，`scrollHeight` 就是全文高度；别比
 * `clientHeight` —— 没封顶时两者相等，永远量不出溢出。正文长度进依赖，改过的重量一次。
 */
const UserMessageBody: FC = () => {
  const [overflowing, setOverflowing] = useState(false)
  /** 滚到底就撤掉渐隐，否则最后一行永远被那 40px 盖着 */
  const [atBottom, setAtBottom] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  /** 正文长度：编辑过的消息要重量一次；数字选择器取值稳定，不逐字重渲染 */
  const contentLength = useAuiState(function (state) {
    let total = 0
    for (const part of state.message.parts) {
      if (part.type === 'text') total += part.text.length
    }
    return total
  })

  useLayoutEffect(
    function measure() {
      const node = ref.current
      if (!node) return
      setOverflowing(node.scrollHeight > USER_BUBBLE_MAX_HEIGHT_PX + 1)
    },
    [contentLength]
  )

  return (
    <div
      data-slot="aui_user-message-body-shell"
      className="min-w-0">
      {/* 单独包一层 relative：渐隐只盖气泡本身，不外溢 */}
      <div className="relative">
        <div
          ref={ref}
          data-slot="aui_user-message-body"
          data-overflowing={overflowing || undefined}
          style={{ maxHeight: USER_BUBBLE_MAX_HEIGHT_PX }}
          className={[
            'aui-user-message-content text-foreground wrap-break-word empty:hidden',
            'rounded-lg bg-secondary px-4 py-3 text-sm leading-6 shadow-xs',
            'overflow-y-auto'
          ].join(' ')}
          onScroll={function trackFade(event) {
            const node = event.currentTarget
            setAtBottom(node.scrollTop + node.clientHeight >= node.scrollHeight - 1)
          }}>
          <MessagePrimitive.Parts
            components={{ Text: UserTextPart, File: UserFilePart, Image: UserImagePart }}
          />
        </div>
        {/* 下面还有内容时压一层渐隐，滚到底自动消失 */}
        {overflowing && !atBottom ? (
          <div
            aria-hidden
            data-slot="aui_user-message-fade"
            className="from-secondary pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-linear-to-t to-transparent"
          />
        ) : null}
      </div>
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
          {/* 元信息行：模式徽标 + 消息时间（年月日时分秒），端点对齐气泡右边 */}
          <div className="mt-1 flex items-center justify-end gap-2">
            <UserMessageBadgeSlot />
            {stamp ? (
              <time
                data-slot="aui_user-message-time"
                dateTime={toDateTimeAttr(createdAt)}
                className="text-muted-foreground/70 block font-mono text-xs tabular-nums">
                {stamp}
              </time>
            ) : null}
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
