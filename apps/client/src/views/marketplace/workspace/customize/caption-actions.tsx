import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { invoke } from '@tauri-apps/api/core'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification'
import { useRef } from 'react'
import { toast } from 'sonner'
import { CHANNELS } from '@/shared/ipc/channels'

import {
  exportTiles,
  parseTileWrite
} from '@/views/marketplace/workspace/customize/tile-io'
import { useMirrorStore } from '@/stores/mirror.ts'

async function notify(body: string) {
  try {
    let permissionGranted = await isPermissionGranted()
    if (!permissionGranted) {
      const permission = await requestPermission()
      permissionGranted = permission === 'granted'
    }
    if (permissionGranted) {
      sendNotification({
        title: import.meta.env.VITE_APP_TITLE,
        body
      })
    }
  } catch (notifyError) {
    console.warn('[Customize] notification failed:', notifyError)
  }
}

/** 定制模式顶栏操作：导入 / 导出磁贴 JSON */
function CaptionActions() {
  const fileRef = useRef<HTMLInputElement>(null)
  const mirror = useMirrorStore((state) => state.active.mirror)
  const magneticTiles = useMirrorStore((state) => state.magneticTiles)
  const toInsertMagneticTile = useMirrorStore((state) => state.toInsertMagneticTile)

  async function handleExport() {
    const mirrorID = mirror?.id
    if (!mirrorID) {
      toast.error('请先选择镜像')
      return
    }

    try {
      const tiles = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
        params: { mirrorID }
      })
      const exported = await exportTiles(tiles)
      if (!exported) return

      toast.success('导出成功')
      await notify('导出成功')
    } catch (error) {
      console.error('[Customize] export failed:', error)
      const detail = error instanceof Error ? error.message : '导出失败'
      toast.error(detail)
      await notify(detail)
    }
  }

  function handleImport(file: File) {
    const mirrorID = mirror?.id
    if (!mirrorID) {
      toast.error('请先选择镜像')
      return
    }

    const reader = new FileReader()
    const baseIndex = magneticTiles.length

    reader.addEventListener(
      'load',
      function () {
        const text = reader.result
        try {
          const parsed = JSON.parse(text as string) as MagneticTile[]
          if (!Array.isArray(parsed) || parsed.length === 0) {
            toast.warning('导入文件为空')
            return
          }
          const writes = parsed.map(function (item, index) {
            return parseTileWrite(item, mirrorID, baseIndex + index)
          })
          void toInsertMagneticTile(writes).then(
            function () {
              toast.success(`已导入 ${writes.length} 个磁贴`)
            },
            function (error) {
              console.error('[Customize] import failed:', error)
              toast.error(error instanceof Error ? error.message : '导入失败')
            }
          )
        } catch (error) {
          console.error('Invalid JSON file', error)
          toast.error('JSON 格式无效')
        }
      },
      { once: true }
    )

    reader.readAsText(file, 'utf-8')
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={function (event) {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) handleImport(file)
        }}
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="导入"
              className="rounded-md text-muted-foreground"
              onClick={function () {
                fileRef.current?.click()
              }}
            />
          }>
          <Icon
            icon="lucide:upload"
            aria-hidden
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">导入</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="导出"
              className="rounded-md text-muted-foreground"
              onClick={function () {
                void handleExport()
              }}
            />
          }>
          <Icon
            icon="lucide:download"
            aria-hidden
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">导出</TooltipContent>
      </Tooltip>
    </>
  )
}

export { CaptionActions }
