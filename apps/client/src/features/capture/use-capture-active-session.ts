import { useEffect, useLayoutEffect, useRef } from 'react'

import { clearCaptureSession, makeCaptureSessionID } from '@/features/capture/history'
import { fetchImageFromPath, takePendingScreenshot, takeScreenshot } from '@/features/capture/tauri'
import { reportCaught } from '@/utils/exception-report'

function useCaptureActiveSession(input: {
  active: boolean
  regionsRef: { current: unknown[] }
  sessionIDRef: { current: string }
  onSessionID: (id: string) => void
  onUpdateSourcePath: (path: string) => void
  onUpdateSourceImage: (image: HTMLImageElement) => void
  onUpdateCaptureStatus: (status: 'loading' | 'ready' | 'error') => void
  onUpdateCaptureError: (error: string | null) => void
}) {
  const bootstrapStartedRef = useRef(false)
  const inputRef = useRef(input)

  useLayoutEffect(
    function () {
      inputRef.current = input
    },
    [input]
  )

  useEffect(
    function () {
      const snapshot = inputRef.current
      if (!snapshot.active) {
        bootstrapStartedRef.current = false
        clearCaptureSession(snapshot.sessionIDRef.current)
        return
      }
      if (bootstrapStartedRef.current) return
      bootstrapStartedRef.current = true
      const nextSession = makeCaptureSessionID()
      snapshot.sessionIDRef.current = nextSession
      snapshot.onSessionID(nextSession)
      let cancelled = false

      takePendingScreenshot(function () {
        return cancelled
      })
        .then(function (pending) {
          if (cancelled) return null
          if (pending) return pending
          return takeScreenshot()
        })
        .then(function (result) {
          if (cancelled || !result) return null
          return fetchImageFromPath(result.path).then(function (img) {
            return { result, img }
          })
        })
        .then(function (bundle) {
          if (cancelled || !bundle) return
          const live = inputRef.current
          live.regionsRef.current = bundle.result.regions ?? []
          live.onUpdateSourcePath(bundle.result.path)
          live.onUpdateSourceImage(bundle.img)
          live.onUpdateCaptureStatus('ready')
        })
        .catch(function (err) {
          if (cancelled) return
          reportCaught('capture.pipeline', err)
          const live = inputRef.current
          live.onUpdateCaptureError(String(err))
          live.onUpdateCaptureStatus('error')
        })

      return function () {
        cancelled = true
      }
    },
    [input.active]
  )
}

export { useCaptureActiveSession }
