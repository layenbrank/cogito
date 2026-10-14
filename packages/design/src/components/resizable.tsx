import { cn } from 'cn'
import * as ResizablePrimitive from 'react-resizable-panels'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'

/**
 * 折叠/展开的宽度过渡由 globals.css 的 `[data-panel]` / `[data-dragging]` 规则统一管理：
 * 拖动分栏时在 Group 上打 `data-dragging` 临时关掉 transition，避免跟手迟滞；
 * 程序化 collapse/expand 不带该标记，于是有 0.2s 平滑过渡。各 app 不必再自己写过渡。
 */

/**
 * 拖拽期的 Group 状态。
 *
 * `isDragging` 只用来关过渡（跟手）；`isArmed` 表示「指针已落在某个把手上」——顺序很关键：
 * 面板必须在**按下之前**退出 collapsible。实测（Chromium + 真实指针事件）拖拽途中改
 * `collapsible` 这类注册类 prop，这次拖拽就只跟到第一次移动然后卡住；悬停比按下早一个
 * 手势阶段，在这里换 prop 才是安全的。
 */
interface DragContextValue {
  /** 把手被悬停或正在拖拽 */
  isArmed: boolean
  /** 拖拽中：只用来打 data-dragging 关掉过渡，跟手 */
  startDrag: () => void
  /** 把手悬停状态变化（true 时会先广播 `subscribeArm`） */
  armHandle: (hovered: boolean) => void
  /** 「预备」瞬间的通知：面板在这里拍下自己的收起态（早于按下，且只拍一次） */
  subscribeArm: (listener: () => void) => () => void
}

const DragContext = createContext<DragContextValue>({
  isArmed: false,
  startDrag: function () {},
  armHandle: function () {},
  subscribeArm: function () {
    return function () {}
  }
})

function ResizablePanelGroup({
  className,
  children,
  ...props
}: ResizablePrimitive.GroupProps & { children: ReactNode }) {
  const [isDragging, updateDragging] = useState(false)
  const [isHandleHovered, updateHandleHovered] = useState(false)
  const armListeners = useRef(new Set<() => void>())

  const api = useMemo<DragContextValue>(
    function () {
      return {
        isArmed: isHandleHovered || isDragging,
        startDrag: function () {
          updateDragging(true)
        },
        armHandle: function (hovered) {
          if (hovered) {
            armListeners.current.forEach(function (listener) {
              listener()
            })
          }
          updateHandleHovered(hovered)
        },
        subscribeArm: function (listener) {
          const listeners = armListeners.current
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        }
      }
    },
    [isHandleHovered, isDragging]
  )

  // 拖拽可能在指针离开把手、失去指针捕获甚至窗口失焦时结束，
  // 只靠把手上的 pointerup 会漏事件；漏了就会一直挂着 data-dragging（过渡全被关掉）。
  useEffect(
    function () {
      if (!isDragging) return
      function stop() {
        updateDragging(false)
      }
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
      window.addEventListener('blur', stop)
      return function () {
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
        window.removeEventListener('blur', stop)
      }
    },
    [isDragging]
  )

  return (
    <DragContext.Provider value={api}>
      <ResizablePrimitive.Group
        data-slot="resizable-panel-group"
        data-dragging={isDragging || undefined}
        className={cn('flex h-full w-full aria-[orientation=vertical]:flex-col', className)}
        {...props}>
        {children}
      </ResizablePrimitive.Group>
    </DragContext.Provider>
  )
}

function ResizablePanel({
  collapsible,
  collapsibleOnDrag = true,
  panelRef,
  ...props
}: ResizablePrimitive.PanelProps & {
  /**
   * 拖拽时是否允许面板被「吸」到 `collapsedSize`（默认允许，即库默认行为）。
   *
   * 置 false：拖拽只把面板夹在 `minSize`，不会一路吸成 0 而意外收起。实现方式是在指针
   * 落到把手上时（`pointerenter`，早于按下）临时把 `collapsible` 关掉 —— 库的吸附只在
   * collapsible 生效，松手即恢复，按钮触发的 `collapse()` / `expand()` 不受影响。
   *
   * 已经在收起状态的面板不动它：0 宽的面板一旦失去 collapsible 会被库夹回 `minSize`，
   * 于是「悬停把手」这个动作本身就会把它弹开。
   *
   * 已知取舍：指针停在把手上时，这一小段时间内的程序化 `collapse()` 会因库自身的
   * collapsible 前置判断而空跑（指针离开把手后即恢复正常）。
   */
  collapsibleOnDrag?: boolean
}) {
  const { isArmed, subscribeArm } = useContext(DragContext)
  // 「预备」那一刻的判定结果：拍一次、冻结到松手，免得拖到一半改 prop（库的拖拽会失效）
  const [isSnapSuppressed, updateSnapSuppressed] = useState(false)

  useEffect(
    function () {
      return subscribeArm(function () {
        // 回调查引用问不了尺寸：只有 ref 对象能问 isCollapsed()
        updateSnapSuppressed(
          typeof panelRef === 'function' ? false : !(panelRef?.current?.isCollapsed() ?? false)
        )
      })
    },
    [subscribeArm, panelRef]
  )

  const canCollapse = collapsible && !(isArmed && isSnapSuppressed && !collapsibleOnDrag)

  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      collapsible={canCollapse}
      panelRef={panelRef}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  const { startDrag, armHandle } = useContext(DragContext)

  // 只对鼠标「预备」：触屏/笔的 enter 和 down 几乎同时到达，prop 换到一半会让这次拖拽卡死，
  // 那种情况保持库默认的吸附行为即可
  function handleEnter(event: ReactPointerEvent<HTMLDivElement>) {
    armHandle(event.pointerType === 'mouse')
  }

  function handleLeave() {
    armHandle(false)
  }

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // 库会写 data-separator=inactive|hover|active|focus|disabled：
        // 悬停 / 拖拽 / 聚焦各自上色（比 CSS :hover 的命中区更大，且不跟 active 抢优先级）
        // `after` 的 10px 命中带要和库的 resizeTargetMinimumSize.fine 默认值一致：
        // collapsibleOnDrag 靠 pointerenter 提前「预备」，命中带对不上就会有像素级漏网
        'group/handle bg-border focus-visible:ring-ring relative flex w-px items-center justify-center ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2 data-[separator=focus]:bg-primary/40 data-[separator=hover]:bg-primary/50 data-[separator=active]:bg-primary focus-visible:ring-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-2.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90',
        className
      )}
      onPointerDown={startDrag}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      {...props}>
      {withHandle && (
        <div className="bg-border group-data-[separator=hover]/handle:bg-primary/70 group-data-[separator=active]/handle:bg-primary z-10 flex h-6 w-1 shrink-0 rounded-lg transition-colors" />
      )}
    </ResizablePrimitive.Separator>
  )
}

const usePanelRef = ResizablePrimitive.usePanelRef

export { ResizableHandle, ResizablePanel, ResizablePanelGroup, usePanelRef }
export type { PanelImperativeHandle } from 'react-resizable-panels'
