import { useEffect, useRef, useState } from 'react'

import { makeCaptureSessionID } from '@/features/capture/history'
import {
  fetchImageFromPath,
  notifyCaptureReady,
  refreshCapture,
  takePendingScreenshot,
  takeScreenshot
} from '@/features/capture/tauri'
import { useCaptureActiveSession } from '@/features/capture/use-capture-active-session'
import { useSettingsStore } from '@/stores/setting'
import { reportCaught } from '@/utils/exception-report'

function useCaptureLifecycle(input: {
  active: boolean
  captureStatus: 'loading' | 'ready' | 'error'
  sourceImage: HTMLImageElement | null
  regionsRef: { current: unknown[] }
  onUpdateSourcePath: (path: string) => void
  onUpdateSourceImage: (image: HTMLImageElement) => void
  onUpdateCaptureStatus: (status: 'loading' | 'ready' | 'error') => void
  onUpdateCaptureError: (error: string | null) => void
}) {
  const [sessionID, onSessionID] = useState(makeCaptureSessionID)
  const sessionIDRef = useRef(sessionID)
  const readyNotifiedRef = useRef(false)

  useEffect(
    function () {
      sessionIDRef.current = sessionID
    },
    [sessionID]
  )

  useEffect(function () {
    void useSettingsStore.getState().toInitialize()
  }, [])

  useEffect(
    function () {
      if (input.captureStatus !== 'ready' || !input.sourceImage) {
        readyNotifiedRef.current = false
        return
      }
      if (readyNotifiedRef.current) return
      readyNotifiedRef.current = true
      let cancelled = false
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!cancelled) void notifyCaptureReady()
        })
      })
      return function () {
        cancelled = true
      }
    },
    [input.captureStatus, input.sourceImage]
  )

  useCaptureActiveSession({
    active: input.active,
    regionsRef: input.regionsRef,
    sessionIDRef,
    onSessionID,
    onUpdateSourcePath: input.onUpdateSourcePath,
    onUpdateSourceImage: input.onUpdateSourceImage,
    onUpdateCaptureStatus: input.onUpdateCaptureStatus,
    onUpdateCaptureError: input.onUpdateCaptureError
  })

  async function retake() {
    input.onUpdateCaptureStatus('loading')
    input.onUpdateCaptureError(null)
    try {
      const result = await refreshCapture()
      const image = await fetchImageFromPath(result.path)
      input.regionsRef.current = result.regions ?? []
      input.onUpdateSourcePath(result.path)
      input.onUpdateSourceImage(image)
      input.onUpdateCaptureStatus('ready')
    } catch (err) {
      reportCaught('capture.pipeline', err)
      input.onUpdateCaptureError(String(err))
      input.onUpdateCaptureStatus('error')
    }
  }

  async function bootstrapCapture(forceFresh = false) {
    input.onUpdateCaptureStatus('loading')
    input.onUpdateCaptureError(null)
    try {
      const result = forceFresh ? await takeScreenshot() : await takePendingScreenshot()
      if (!result) {
        throw new Error('未找到预截图，请点重试')
      }
      // 先交 path：加载期铺冻结帧，避免重拍时又看到一段黑幕
      input.onUpdateSourcePath(result.path)
      const img = await fetchImageFromPath(result.path)
      input.regionsRef.current = result.regions ?? []
      input.onUpdateSourcePath(result.path)
      input.onUpdateSourceImage(img)
      input.onUpdateCaptureStatus('ready')
    } catch (err) {
      reportCaught('capture.pipeline', err)
      input.onUpdateCaptureError(String(err))
      input.onUpdateCaptureStatus('error')
    }
  }

  return {
    sessionID,
    retake,
    bootstrapCapture
  }
}

export { useCaptureLifecycle }
