import { Button } from '@i-thinking/design/components/button'
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { toast } from 'sonner'

import { pickAndImportRecordings } from '@/features/capture/import-recording'
import { useGalleryStore } from '@/stores/gallery'
import { CapturePane } from '@/views/capture/capture-pane'
import type { GalleryMedia } from '@/views/gallery/model/media'

interface CaptureOutletContext {
  albumID: string | null
  medias: GalleryMedia[]
}

function CaptureRecording() {
  const context = useOutletContext<CaptureOutletContext>()
  const toReadMedias = useGalleryStore(function (state) {
    return state.toReadMedias
  })
  const [importing, onImporting] = useState(false)

  async function onImport() {
    onImporting(true)
    try {
      const ids = await pickAndImportRecordings()
      if (ids.length > 0) {
        await toReadMedias({ skipHydrate: true })
        toast.success(`已导入 ${ids.length} 个录屏`)
      }
    } catch (error) {
      toast.error(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      onImporting(false)
    }
  }

  const importButton = (
    <Button
      size="sm"
      className="h-6 gap-1 rounded-sm px-2 text-xs"
      disabled={importing}
      onClick={function () {
        void onImport()
      }}>
      导入录屏
    </Button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-border px-3 py-1.5">
        {importButton}
      </div>
      <div className="min-h-0 flex-1">
        <CapturePane
          kind="recording"
          medias={context.medias}
          albumID={context.albumID}
          emptyHint="还没有录屏。可以导入本机视频；清理只移除记录，不会删除原位置文件。"
          emptyAction={importButton}
        />
      </div>
    </div>
  )
}

export default CaptureRecording
