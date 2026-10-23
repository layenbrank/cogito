/**
 * Clipchamp 窗 Caption 左侧（Decorations.begin）：
 * 项目名可拖拽；撤销/重做/比例/预览全屏仅控件标 data-region=false。
 */
import { Button } from '@cogito/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@cogito/design/components/dropdown-menu'
import { Icon } from '@iconify/react/offline'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import { ASPECT_OPTIONS, type AspectRatio } from '@/views/clipchamp/lib/project'

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
  const updateCanvasAspect = useClipchampStore(function (s) {
    return s.updateCanvasAspect
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
        <DropdownMenu
          onOpenChange={function (open) {
            if (!open) updateCanvasAspect(null)
          }}>
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
          <DropdownMenuContent
            align="center"
            className="w-64">
            {ASPECT_OPTIONS.map(function (option) {
              const isOn = option.ratio === aspect
              return (
                <DropdownMenuItem
                  key={option.ratio}
                  className="items-center gap-2.5 py-2"
                  onMouseEnter={function () {
                    updateCanvasAspect(option.ratio)
                  }}
                  onClick={function () {
                    updateCanvasAspect(null)
                    updateAspect(option.ratio)
                  }}>
                  <AspectFrame ratio={option.ratio} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-medium">{option.title}</span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </span>
                  {isOn ? (
                    <Icon
                      icon="lucide:check"
                      className="size-3.5 text-primary"
                    />
                  ) : (
                    <span className="size-3.5" />
                  )}
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

function AspectFrame(props: { ratio: AspectRatio }) {
  const [w, h] = props.ratio.split(':').map(function (part) {
    return Number(part)
  })
  const box = 28
  const scale = box / Math.max(w, h)
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center"
      aria-hidden>
      <span
        className="rounded-[3px] border border-foreground/70 bg-muted"
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      />
    </span>
  )
}

export { ClipchampCaptionBegin }
