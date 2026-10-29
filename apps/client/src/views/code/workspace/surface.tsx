import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { TerminalTabs } from '@/features/terminal'
import { useCodeStore, type SurfaceTab } from '@/stores/code'
import { Problems } from '@/views/code/workspace/problems.tsx'

function BottomSurface() {
  const isSurfaceOpen = useCodeStore(function (state) {
    return state.isSurfaceOpen
  })
  const surfaceTab = useCodeStore(function (state) {
    return state.surfaceTab
  })
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const problemCounts = useCodeStore(function (state) {
    return state.problemCounts
  })
  const problemCount = problemCounts.errors + problemCounts.warnings

  if (!isSurfaceOpen) return null

  function selectTab(tab: SurfaceTab) {
    useCodeStore.getState().toUpdateSurfaceTab(tab)
  }

  function closeSurface() {
    useCodeStore.getState().toUpdateSurfaceOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border/50 bg-background/92">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 bg-background/70 px-1 backdrop-blur-md">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            'h-6 rounded-sm px-2 text-xs',
            surfaceTab === 'terminal'
              ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
              : 'text-muted-foreground'
          )}
          onClick={function () {
            selectTab('terminal')
          }}>
          <Icon
            icon="lucide:terminal"
            className="mr-1 size-3.5"
          />
          终端
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn(
            'h-6 rounded-sm px-2 text-xs',
            surfaceTab === 'problems'
              ? 'bg-muted text-foreground hover:bg-muted hover:text-foreground'
              : 'text-muted-foreground'
          )}
          onClick={function () {
            selectTab('problems')
          }}>
          <Icon
            icon="lucide:circle-alert"
            className="mr-1 size-3.5"
          />
          问题{problemCount > 0 ? ` (${problemCount})` : ''}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭面板"
          title="关闭面板"
          className="text-muted-foreground ml-auto size-6"
          onClick={closeSurface}>
          <Icon
            icon="lucide:x"
            className="size-3.5"
          />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* 终端用 invisible 保活：切到其他页勿卸载，否则会 kill 全部 PTY */}
        <div
          className={cn(
            'absolute inset-0',
            surfaceTab === 'terminal' ? 'z-10' : 'invisible pointer-events-none z-0'
          )}
          aria-hidden={surfaceTab !== 'terminal'}>
          <TerminalTabs
            cwd={workspaceRoot}
            emptyCwdMessage="请先打开工作区文件夹"
          />
        </div>
        {surfaceTab === 'problems' ? (
          <div className="absolute inset-0 z-10">
            <Problems />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { BottomSurface }
