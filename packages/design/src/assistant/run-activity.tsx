/**
 * Run activity（对齐 assistant-ui `elements/run-activity`）
 *
 * 一轮「干过活」的回合收成一条 disclosure：折叠条是「已工作 4.8s」，展开是
 * 按原时序排好的活动流水（解说 / 思考 / 工具）。**最终回答不进折叠**，
 * 常驻在 disclosure 之后 —— 这也是 Cursor / Codex / Claude Code 的共同排版：
 * 过程收成一条、结论留在底部。
 *
 * 与 `reasoning.tsx` / `tool-group.aui.tsx` 的分工：
 * - 那些是「段」级别的折叠（一段思考、一组工具），一轮里会出现好几条；
 * - 这里是「整轮」级别的折叠，一轮只有一条，段级别的东西都摊成条目。
 *
 * 三处不能折：
 * 1. `attention`（审批 / 出错 / 无法归类的 part）永远在折叠区外面 ——
 *    审批按钮藏在折叠里等于把流程卡死；
 * 2. `children`（最终回答）同理，模型说完了什么必须一眼看见；
 * 3. 条目为空时不出折叠按钮，只留一行状态（空壳点了也是空的）。
 *
 * 元素本体是收费产物，官网只给示例块与渲染出的 DOM；结构、状态与行为都在本仓自写，
 * 字号走本仓档位（元信息 `text-xs`、正文 `text-sm`），不照搬元素页的 px。
 */
import { Icon } from '@iconify/react/offline'
import { useScrollLock } from '@assistant-ui/react'
import { cn } from 'cn'
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { CHAT_DURATION_MS, CHAT_EASE_CLASS } from './chat-motion'
import { useCollapseScrollPin } from './collapse-scroll-pin'
import { useAssistantLabels } from './labels'
import { TOOL_ROW_HEIGHT_CLASS } from './tool-row'

/** 与 runtime 的 message.status 一一对应；`requires-action` 是「等人处理」，不是跑完了 */
type RunActivityStatus =
  | 'running'
  | 'requires-action'
  | 'complete'
  | 'cancelled'
  | 'error'
  | 'incomplete'

type RunActivityEntryKind = 'commentary' | 'reasoning' | 'tool'

interface RunActivityEntry {
  /** 稳定 id（`tool-<toolCallId>` / `reasoning-<index>` / `commentary-<index>`），供 React key 与测试定位 */
  readonly id: string
  readonly kind: RunActivityEntryKind
  /** 折叠条「最近一条活动」用的短标签；running 时它替换掉「工作中」 */
  readonly label?: string
  readonly content: ReactNode
}

interface RunActivityProps {
  status: RunActivityStatus
  /** 折叠条前缀：已工作 / 工作中 / 等待确认 …（running 时由调用方换成最近一条活动） */
  statusLabel: ReactNode
  /** 结算时长（`4.8s`）；running 时不传 —— 每帧跳秒会把整条消息拉进重绘 */
  durationLabel?: ReactNode
  entries?: readonly RunActivityEntry[]
  /** 需要用户处理的块（审批 / 出错 / 无法归类的 part）：常驻可见，不进折叠 */
  attention?: ReactNode
  /** 展开态里、条目之后的附加内容（app 塞耗时统计 / 轨迹这类调试面板） */
  extra?: ReactNode
  /** 受控展开；不传则自己管 */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 跳过高度动画：一次展开几十步时用 */
  instant?: boolean
  className?: string
  /** 最终回答：元素只负责把它排在折叠区之后 */
  children?: ReactNode
}

function RunActivityLabel(props: { status: RunActivityStatus; statusLabel: ReactNode; durationLabel?: ReactNode }) {
  const isRunning = props.status === 'running'

  return (
    <span
      data-slot="run-activity-label"
      aria-live={isRunning ? 'polite' : undefined}
      className="flex min-w-0 items-center gap-1.5">
      {/*
       * 心跳点：running 时这条折叠条往往是界面上**唯一还在动的东西** —— 文案可能只是一个
       * 短标签（「思考」「调用 shell」），不跟着动就会被读成「已经停了」。
       * 6px 的点不抢视线，但一眼就是活的（与工具行 spinner 同一套语言）。
       */}
      {isRunning ? (
        <span
          data-slot="run-activity-pulse"
          aria-hidden
          className="bg-primary/70 size-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none"
        />
      ) : null}
      <span
        className={cn('text-start tabular-nums', isRunning && 'shimmer motion-reduce:animate-none')}>
        {props.statusLabel}
        {props.durationLabel ? <> {props.durationLabel}</> : null}
      </span>
    </span>
  )
}

function RunActivity({
  status,
  statusLabel,
  durationLabel,
  entries = [],
  attention,
  extra,
  open,
  defaultOpen = false,
  onOpenChange,
  instant = false,
  className,
  children
}: RunActivityProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const labels = useAssistantLabels()
  /**
   * 展开状态：**用户在中间点过就以用户为准**，否则跟着运行状态走 ——
   * 运行中默认摊开（能看见在做什么），结算后自动收成一条（不占地方）。
   * 这是 Cursor / Copilot 的手感：跑的时候要看，跑完不想看。
   */
  const [userOpen, updateUserOpen] = useState<boolean | null>(null)
  const shouldAutoOpen = status === 'running' || defaultOpen
  /**
   * 自动开合**晚一帧**生效：结算时先把滚动钉住，再由下一帧塌下去。
   * 直接按状态算的话，DOM 在提交里就收起来了 —— 那一刻面板高度已经归零，
   * `armCollapsePin` 量不到东西，贴底的用户会看到正在读的回答被顶上跳一截。
   */
  const [autoOpen, updateAutoOpen] = useState(shouldAutoOpen)
  const isOpen = open !== undefined ? open : (userOpen ?? autoOpen)
  // 懒挂载：收起时不保留整棵工具/思考 DOM（长回合省内存），展开过一次再常驻
  const [hasOpened, updateHasOpened] = useState(isOpen)
  if (isOpen && !hasOpened) updateHasOpened(true)
  const lockScroll = useScrollLock(rootRef, instant ? 0 : CHAT_DURATION_MS)
  const armCollapsePin = useCollapseScrollPin(rootRef)

  const isControlled = open !== undefined
  const hasEntries = entries.length > 0
  const animationMs = instant ? 0 : CHAT_DURATION_MS

  // 自动开合晚一帧生效（见上）：这一帧 DOM 还开着，才量得到要钉住的高度。
  // 用 layout effect（而不是 effect）：钉完立刻塌，用户不会先看到一帧完整时间线。
  useLayoutEffect(
    function () {
      if (autoOpen === shouldAutoOpen) return
      if (!shouldAutoOpen && userOpen === null && !isControlled) {
        armCollapsePin(animationMs)
      }
      // 这里不是在「用 effect 同步状态」，而是把**自动收起**推迟到能测量之后：
      // 同一个 commit 里收起，面板高度已经归零，滚动钉不住。
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 见上，延迟一帧以先钉住滚动
      updateAutoOpen(shouldAutoOpen)
    },
    [animationMs, armCollapsePin, autoOpen, isControlled, shouldAutoOpen, userOpen]
  )

  const handleOpenChange = useCallback(
    function (next: boolean) {
      // 展开：锁 scrollTop，避免贴底 followBottom 把内容往上抽
      // 收起：钉住折叠条（冻 scrollTop 在贴底会更抖）
      if (next) lockScroll()
      else armCollapsePin(animationMs)
      if (next) updateHasOpened(true)
      if (!isControlled) updateUserOpen(next)
      onOpenChange?.(next)
    },
    [animationMs, armCollapsePin, isControlled, lockScroll, onOpenChange]
  )

  return (
    <div
      data-slot="run-activity"
      data-status={status}
      className={cn('flex min-w-0 flex-col gap-2', className)}>
      {attention}

      {hasEntries ? (
        <Collapsible
          ref={rootRef}
          open={isOpen}
          onOpenChange={handleOpenChange}
          className="group/run-activity w-full"
          style={
            {
              '--animation-duration': `${animationMs}ms`
            } as React.CSSProperties
          }>
          <CollapsibleTrigger
            data-slot="run-activity-trigger"
            className={cn(
              // 折叠条是这条流水**唯一的开关**：给足 28px 可点高度 + hover 底色。
              // 以前是 `py-1`（≈24px）的纯文字行，鼠标得瞄着那一小行才点得中。
              TOOL_ROW_HEIGHT_CLASS,
              '-ms-1.5',
              // 扁平行：弱色正文 + 小 chevron，不做卡片头
              'group/trigger text-muted-foreground hover:text-foreground active:text-foreground focus-visible:ring-ring/50 flex max-w-full origin-left items-center gap-1.5 rounded-md px-1.5 text-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-[3px]'
            )}>
            <Icon
              icon="lucide:chevron-right"
              data-slot="run-activity-trigger-chevron"
              className={cn(
                'size-3.5 shrink-0 opacity-70',
                `transition-transform duration-(--animation-duration) ${CHAT_EASE_CLASS} motion-reduce:transition-none`,
                'group-data-open/trigger:rotate-90',
                'group-data-panel-open/trigger:rotate-90'
              )}
            />
            <RunActivityLabel
              status={status}
              statusLabel={statusLabel}
              durationLabel={durationLabel}
            />
          </CollapsibleTrigger>

          <CollapsibleContent
            data-slot="run-activity-content"
            className={cn(
              'relative overflow-hidden text-sm outline-none',
              'group/collapsible-content data-closed:pointer-events-none',
              instant && 'transition-none!'
            )}>
            {hasOpened ? (
              <>
                {/* 时间线轨道：左侧一条竖线，条目按原时序排（元素页同款 <ol>） */}
                <ol
                  data-slot="run-activity-entries"
                  className="border-border ms-1.5 flex min-w-0 flex-col gap-2 border-s ps-3.5 pt-2 text-sm wrap-break-word">
                  {entries.map(function (entry) {
                    return (
                      <li
                        key={entry.id}
                        data-activity-kind={entry.kind}
                        data-activity-id={entry.id}
                        className={cn(
                          'min-w-0',
                          entry.kind === 'reasoning' && 'text-muted-foreground',
                          // 解说按正文读，但行距收一档，免得一条流水占满屏
                          entry.kind === 'commentary' &&
                            '[&_.aui-md-p]:my-1 [&_.aui-md-p]:first:mt-0 [&_.aui-md-p]:last:mb-0 [&_.aui-md-ol]:my-1 [&_.aui-md-ul]:my-1',
                          entry.kind === 'tool' && 'my-0'
                        )}>
                        {entry.content}
                      </li>
                    )
                  })}
                </ol>
                {extra}
                {/*
                 * 长流水展开之后总得有个「收回去」的落点：一条时间线几十步，
                 * 想收起还得滚回最上面点那行字，不符合习惯。
                 */}
                <button
                  type="button"
                  data-slot="run-activity-collapse"
                  onClick={function () {
                    handleOpenChange(false)
                  }}
                  className="-ms-1 mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
                  <Icon
                    icon="lucide:chevron-up"
                    className="size-3.5 shrink-0 opacity-70"
                  />
                  {labels.runCollapse}
                </button>
              </>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        // 没有条目（比如只有审批卡）：不出空折叠按钮，只留一行状态
        <div
          data-slot="run-activity-status"
          className="text-muted-foreground flex items-center py-1 text-xs">
          <RunActivityLabel
            status={status}
            statusLabel={statusLabel}
            durationLabel={durationLabel}
          />
        </div>
      )}

      {children}
    </div>
  )
}

export { RunActivity }
// 纯函数在 `run-activity-state.ts`（可单测）；这里保留原导出面，调用方无需改 import
export { formatRunDuration, toActivityLabel } from './run-activity-state'
export type {
  RunActivityEntry,
  RunActivityEntryKind,
  RunActivityProps,
  RunActivityStatus
}
