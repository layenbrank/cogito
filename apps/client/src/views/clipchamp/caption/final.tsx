/**
 * Clipchamp 窗 Caption 右侧（Decorations.final）：保存 / 恢复 / 导出预设与导出。
 * final 槽本身已在共享 Caption 内 data-region=false，无需再包一层。
 */
import { Button } from '@i-thinking/design/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@i-thinking/design/components/dropdown-menu'

import { useState } from 'react'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import { ExportDialog } from '@/views/clipchamp/caption/export-dialog'
import { EXPORT_PRESETS } from '@/views/clipchamp/lib/project'

function ClipchampCaptionFinal() {
  const isExporting = useClipchampStore(function (s) {
    return s.isExporting
  })
  const exportProgress = useClipchampStore(function (s) {
    return s.exportProgress
  })
  const exportPresetId = useClipchampStore(function (s) {
    return s.exportPresetId
  })
  const updateExportPreset = useClipchampStore(function (s) {
    return s.updateExportPreset
  })
  const persistProject = useClipchampStore(function (s) {
    return s.persistProject
  })
  const restoreProject = useClipchampStore(function (s) {
    return s.restoreProject
  })
  const [isExportOpen, setExportOpen] = useState(false)

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={function () {
          persistProject()
        }}>
        保存
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={function () {
          restoreProject()
        }}>
        恢复
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
            />
          }>
          {EXPORT_PRESETS.find(function (p) {
            return p.id === exportPresetId
          })?.label || '预设'}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {EXPORT_PRESETS.map(function (preset) {
            return (
              <DropdownMenuItem
                key={preset.id}
                onClick={function () {
                  updateExportPreset(preset.id)
                }}>
                {preset.label}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type="button"
        size="sm"
        className="h-7 min-w-[4.25rem] px-3 text-xs font-medium shadow-none"
        disabled={isExporting}
        onClick={function () {
          setExportOpen(true)
        }}>
        {isExporting
          ? typeof exportProgress === 'number'
            ? `导出 ${exportProgress}%`
            : '导出中…'
          : '导出'}
        </Button>
      <ExportDialog
        key={isExportOpen ? 'open' : 'closed'}
        open={isExportOpen}
        onOpenChange={setExportOpen}
      />
    </div>
  )
}

export { ClipchampCaptionFinal }
