/**
 * 监听 agent 工具 app_knowledge_ingest 发出的入队事件（即使知识库页未打开）。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'

import { useKnowledgeBaseStore } from '@/stores/knowledge-base'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'

let unlisten: UnlistenFn | null = null

async function bootstrapIngestEnqueueBridge(): Promise<void> {
  if (unlisten) return
  useIngestQueueStore.getState().bootstrap()
  unlisten = await listen<{ path?: string; baseId?: string }>(
    'knowledge://enqueue-ingest',
    function (event) {
      const path = event.payload?.path?.trim()
      if (!path) return
      const baseId = event.payload?.baseId
      const state = useKnowledgeBaseStore.getState()
      const enqueue = function () {
        const id = useIngestQueueStore.getState().enqueue(path)
        if (id) toast.message(`已入队 ingest：${path}`)
      }
      if (baseId && state.activeBaseID !== baseId) {
        void state.selectBase(baseId).then(enqueue).catch(function (error) {
          console.warn('[ingest-enqueue-bridge] selectBase failed:', error)
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
