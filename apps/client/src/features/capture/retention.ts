import { toast } from 'sonner'

import { POST_CAPTURE_PRUNE, type CapturePruneResult } from '@/apis/capture'
import { formatUsageBytes } from '@/features/capture/model/usage'
import { useSettingsStore } from '@/stores/setting'

const PRUNE_THROTTLE_MS = 60_000
let lastPruneAt = 0
let pruneInFlight: Promise<CapturePruneResult | null> | null = null

/**
 * 读取设置策略并调用 `capture:prune`；节流避免频繁触发。
 */
async function pruneCaptures(options?: {
  force?: boolean
  silent?: boolean
}): Promise<CapturePruneResult | null> {
  const settings = useSettingsStore.getState().settings.capture
  if (!settings.isRetentionEnabled) return null

  const now = Date.now()
  if (!options?.force && now - lastPruneAt < PRUNE_THROTTLE_MS) {
    return null
  }
  if (pruneInFlight) return pruneInFlight

  pruneInFlight = (async function () {
    try {
      await useSettingsStore.getState().toInitialize()
      const capture = useSettingsStore.getState().settings.capture
      if (!capture.isRetentionEnabled) return null

      const result = await POST_CAPTURE_PRUNE({
        policies: [
          {
            kind: 'screenshot',
            days: capture.retention.screenshot.days,
            count: capture.retention.screenshot.count,
            maxBytes: capture.retention.screenshot.maxBytes
          },
          {
            kind: 'recording',
            days: capture.retention.recording.days,
            count: capture.retention.recording.count,
            maxBytes: capture.retention.recording.maxBytes
          }
        ]
      })
      lastPruneAt = Date.now()
      if (!options?.silent && result.ids.length > 0) {
        toast.success(
          `已清理 ${result.ids.length} 项，释放 ${formatUsageBytes(result.freedBytes)}`
        )
      }
      return result
    } catch (error) {
      console.warn('[capture] prune failed', error)
      if (!options?.silent) {
        const text = error instanceof Error ? error.message : String(error)
        toast.error(`清理失败：${text}`)
      }
      return null
    } finally {
      pruneInFlight = null
    }
  })()

  return pruneInFlight
}

export { pruneCaptures }
export type { CapturePruneResult }
