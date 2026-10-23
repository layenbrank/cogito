import { useState } from 'react'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'

import { useClipchampStore } from '@/stores/clipchamp.ts'
import {
  EXPORT_PRESETS,
  fitExportPreset,
  type ExportPreset
} from '@/views/clipchamp/lib/project'

const FPS_OPTIONS = [24, 30, 60]

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ExportDialog(props: ExportDialogProps) {
  const { open, onOpenChange } = props
  const aspect = useClipchampStore(function (s) {
    return s.project.aspect
  })
  const exportPresetId = useClipchampStore(function (s) {
    return s.exportPresetId
  })
  const isExporting = useClipchampStore(function (s) {
    return s.isExporting
  })
  const updateExportPreset = useClipchampStore(function (s) {
    return s.updateExportPreset
  })
  const exportVideo = useClipchampStore(function (s) {
    return s.exportVideo
  })

  const current =
    EXPORT_PRESETS.find(function (preset) {
      return preset.id === exportPresetId
    }) ?? EXPORT_PRESETS[0]

  const [presetId, setPresetId] = useState(current.id)
  const [fps, setFps] = useState(current.fps)
  const [videoBitrate, setVideoBitrate] = useState(current.videoBitrate)
  const [audioBitrate, setAudioBitrate] = useState(current.audioBitrate)

  function applyPreset(preset: ExportPreset) {
    const fitted = fitExportPreset(preset, aspect)
    setPresetId(preset.id)
    setFps(fitted.fps)
    setVideoBitrate(fitted.videoBitrate)
    setAudioBitrate(fitted.audioBitrate)
  }

  const fitted = fitExportPreset(
    EXPORT_PRESETS.find(function (preset) {
      return preset.id === presetId
    }) ?? current,
    aspect
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>导出</DialogTitle>
          <DialogDescription>
            当前画幅 {aspect}，输出 {fitted.width}×{fitted.height}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {EXPORT_PRESETS.map(function (preset) {
              const isOn = preset.id === presetId
              return (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={isOn ? 'default' : 'outline'}
                  className="h-7 px-2.5 text-xs shadow-none"
                  onClick={function () {
                    applyPreset(preset)
                  }}>
                  {preset.label}
                </Button>
              )
            })}
          </div>

          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">帧率</span>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={fps}
              onChange={function (event) {
                setFps(Number(event.target.value))
              }}>
              {FPS_OPTIONS.map(function (value) {
                return (
                  <option
                    key={value}
                    value={value}>
                    {value} fps
                  </option>
                )
              })}
            </select>
          </label>

          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">视频码率</span>
            <Input
              value={videoBitrate}
              className="h-8 w-28 text-xs"
              onChange={function (event) {
                setVideoBitrate(event.target.value)
              }}
            />
          </label>

          <label className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground">音频码率</span>
            <Input
              value={audioBitrate}
              className="h-8 w-28 text-xs"
              onChange={function (event) {
                setAudioBitrate(event.target.value)
              }}
            />
          </label>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isExporting}
            onClick={function () {
              onOpenChange(false)
            }}>
            取消
          </Button>
          <Button
            type="button"
            disabled={isExporting}
            onClick={function () {
              const preset: ExportPreset = {
                ...fitted,
                fps,
                videoBitrate: videoBitrate.trim() || fitted.videoBitrate,
                audioBitrate: audioBitrate.trim() || fitted.audioBitrate
              }
              updateExportPreset(preset.id)
              onOpenChange(false)
              void exportVideo(preset)
            }}>
            选择路径并导出
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ExportDialog }
