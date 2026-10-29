/**
 * 终端面板容器：标题栏（标题 + 关闭）+ 多 tab 内容。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'

import { TerminalTabs } from '@/features/terminal/terminal-tabs'
import { useTerminalStore } from '@/stores/terminal'

interface TerminalSurfaceProps {
  cwd?: string | null
  emptyCwdMessage?: string
  /** 关闭时回调；默认关闭终端 store 面板并清空会话 */
  onClose?(): void
  title?: string
}

function TerminalSurface(props: TerminalSurfaceProps) {
  const closePanel = useTerminalStore(function (state) {
    return state.closePanel
  })

  function handleClose() {
    if (props.onClose) {
      props.onClose()
      return
    }
    closePanel()
  }

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <Icon
          icon="lucide:terminal"
          className="text-muted-foreground size-3.5 shrink-0"
        />
        <span className="text-muted-foreground truncate text-xs font-medium">
          {props.title ?? '终端'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭终端面板"
            title="关闭终端面板"
            className="text-muted-foreground hover:text-foreground size-6"
            onClick={handleClose}>
            <Icon
              icon="lucide:x"
              className="size-3.5"
            />
          </Button>
        </div>
      </div>
      <TerminalTabs
        cwd={props.cwd}
        emptyCwdMessage={props.emptyCwdMessage}
      />
    </div>
  )
}

export { TerminalSurface }
export type { TerminalSurfaceProps }
