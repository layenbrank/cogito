import { useEffect, useLayoutEffect, useRef } from 'react'

import { clearCaptureSession, makeCaptureSessionID } from '@/features/capture/history'
import { fetchImageFromPath, takePendingScreenshot } from '@/features/capture/tauri'
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
          // 不再回退 `takeScreenshot()`：那会在截屏态里再抓一次（conceal/reveal + 抓帧），
          // 多 200~400ms 并闪一次实时桌面。pending 是一次性契约，落空就是这次抓帧失败，
          // 交给错误面板的「重试」（`forceFresh`）处理。
          if (!pending) throw new Error('未找到预截图，请点重试')
          // 先把 path 交出去：加载期用冻结帧铺底，用户立刻看到画面而不是黑幕
          inputRef.current.onUpdateSourcePath(pending.path)
          return pending
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
