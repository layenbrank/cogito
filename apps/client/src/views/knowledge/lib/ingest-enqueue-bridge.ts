/**
 * 监听 agent 工具 cogito_knowledge_ingest 发出的入队事件（即使知识库页未打开）。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

import { useSpacesStore } from '@/stores/spaces'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'

let unlisten: UnlistenFn | null = null

async function bootstrapIngestEnqueueBridge(): Promise<void> {
  if (unlisten) return
  useIngestQueueStore.getState().bootstrap()
  unlisten = await listen<{ path?: string; spaceId?: string }>(
    'knowledge://enqueue-ingest',
    function (event) {
      const path = event.payload?.path?.trim()
      if (!path) return
      const spaceId = event.payload?.spaceId
      const state = useSpacesStore.getState()
      const enqueue = function () {
        const id = useIngestQueueStore.getState().enqueue(path)
        if (id) toast.message(`已入队 ingest：${path}`)
      }
      if (spaceId && state.activeSpaceID !== spaceId) {
        void state.selectSpace(spaceId).then(enqueue).catch(function (error) {
          console.warn('[ingest-enqueue-bridge] selectSpace failed:', error)
          enqueue()
        })
        return
      }
      enqueue()
    }
  )
}

function disposeIngestEnqueueBridge(): void {
  unlisten?.()
  unlisten = null
}

export { bootstrapIngestEnqueueBridge, disposeIngestEnqueueBridge }
