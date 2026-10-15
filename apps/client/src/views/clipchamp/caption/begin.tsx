/**
 * Clipchamp 窗 Caption 左侧（Decorations.begin）：
 * 项目名可拖拽；撤销/重做/比例/预览全屏仅控件标 data-region=false。
 */
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import { ASPECT_RATIOS } from '@/views/clipchamp/lib/project'

function ClipchampCaptionBegin() {
  const projectName = useClipchampStore(function (s) {
    return s.project.name
  })
  const aspect = useClipchampStore(function (s) {
    return s.project.aspect
  })
  const canUndo = useClipchampStore(function (s) {
    return s.undoStack.length > 0
  })
  const canRedo = useClipchampStore(function (s) {
    return s.redoStack.length > 0
  })
  const isFullscreen = useClipchampStore(function (s) {
    return s.isFullscreen
  })
  const undo = useClipchampStore(function (s) {
    return s.undo
  })
  const redo = useClipchampStore(function (s) {
    return s.redo
  })
  const updateAspect = useClipchampStore(function (s) {
    return s.updateAspect
  })
  const updateFullscreen = useClipchampStore(function (s) {
    return s.updateFullscreen
  })

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
      <span className="truncate px-1 text-sm font-medium">{projectName}</span>

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          disabled={!canUndo}
          title="撤销"
          className="size-7 text-muted-foreground"
          onClick={function () {
            undo()
          }}>
          <Icon
            icon="lucide:undo-2"
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          disabled={!canRedo}
          title="重做"
          className="size-7 text-muted-foreground"
          onClick={function () {
            redo()
          }}>
          <Icon
            icon="lucide:redo-2"
            className="size-3.5"
          />
        </Button>
      </div>

      <div className="mx-auto flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-region="false"
                className="h-7 gap-1.5 border-border/80 bg-background px-2.5 text-xs font-medium shadow-none"
              />
            }>
            <Icon
              icon="lucide:ratio"
              className="size-3.5 text-muted-foreground"
            />
            {aspect}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {ASPECT_RATIOS.map(function (ratio) {
              return (
                <DropdownMenuItem
                  key={ratio}
                  onClick={function () {
                    updateAspect(ratio)
                  }}>
                  {ratio}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-region="false"
          title={isFullscreen ? '退出全屏预览' : '全屏预览'}
          className="size-7 text-muted-foreground"
          onClick={function () {
            updateFullscreen(!isFullscreen)
          }}>
          <Icon
            icon={isFullscreen ? 'lucide:minimize' : 'lucide:maximize'}
            className="size-3.5"
          />
        </Button>
      </div>
    </div>
  )
}

export { ClipchampCaptionBegin }
