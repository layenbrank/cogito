import { cn } from "cn"
import * as ResizablePrimitive from "react-resizable-panels"
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react"

/**
 * 折叠/展开的 flex-basis 过渡由 globals.css 的 `[data-panel]` / `[data-dragging]` 规则统一管理：
 * 拖动分栏时在 Group 上打 `data-dragging` 临时关掉 transition，避免跟手迟滞；
 * 程序化 collapse/expand 不带该标记，于是有 0.2s 平滑过渡。
 */
const DraggingContext = createContext<((dragging: boolean) => void) | null>(null)

function ResizablePanelGroup({
  className,
  children,
  ...props
}: ResizablePrimitive.GroupProps & { children: ReactNode }) {
  const [dragging, setDragging] = useState(false)
  const context = useMemo(() => setDragging, [])

  return (
    <DraggingContext.Provider value={context}>
      <ResizablePrimitive.Group
        data-slot="resizable-panel-group"
        data-dragging={dragging || undefined}
        className={cn(
          "flex h-full w-full aria-[orientation=vertical]:flex-col",
          className
        )}
        {...props}>
        {children}
      </ResizablePrimitive.Group>
    </DraggingContext.Provider>
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  const setDragging = useContext(DraggingContext)

  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      onPointerDown={setDragging ? function () { setDragging(true) } : undefined}
      onPointerUp={setDragging ? function () { setDragging(false) } : undefined}
      onPointerCancel={setDragging ? function () { setDragging(false) } : undefined}
      className={cn(
        "bg-border focus-visible:ring-ring relative flex w-px items-center justify-center ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1.5 after:-translate-x-1/2 hover:bg-primary/40 focus-visible:ring-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1.5 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}>
      {withHandle && (
        <div className="bg-border z-10 flex h-6 w-1 shrink-0 rounded-lg" />
      )}
    </ResizablePrimitive.Separator>
  )
}

const usePanelRef = ResizablePrimitive.usePanelRef

export {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  usePanelRef
}
export type { PanelImperativeHandle } from "react-resizable-panels"
