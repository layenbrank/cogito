import { Toaster } from '@cogito/design/components/sonner'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { useSyncExternalStore } from 'react'

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import localeData from 'dayjs/plugin/localeData'

import { Suspense, useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { QueryProvider } from '@/components/provider/query'
import { useAutomationRunner } from '@/features/automation/use-automation-runner'
import { useBrowserStore } from '@/features/browser/store'
import { useCaptureCommands } from '@/features/capture/commands'
import { readMotionConfig, subscribeAppearance } from '@/features/window/appearance'
import { useKeyboard } from '@/keyboard/react'
import { router } from '@/routers/index'

dayjs.extend(localeData)
dayjs.locale('zh-cn')

function useAppearanceMotion() {
  return useSyncExternalStore(subscribeAppearance, readMotionConfig, function () {
    return 'user' as const
  })
}

function App() {
  const reducedMotion = useAppearanceMotion()
  useKeyboard()
  useCaptureCommands()
  useAutomationRunner()

  // 前端刷新（HMR / 重新加载）会把 zustand 里的 tabs 清空，但 webview 还活在
  // Rust 那边 —— 挂载时回灌一次，`@` 面板和面板子 tab 才能继续列出已有页面。
  // 失败不打扰用户：没有浏览器能力时本来就没标签页可回灌。
  useEffect(function () {
    void useBrowserStore.getState().hydrate().catch(function (error: unknown) {
      console.warn('[app] 回灌浏览器标签页失败:', error)
    })
  }, [])

  return (
    <>
      <TooltipProvider>
        <LazyMotion features={domMax}>
          <MotionConfig reducedMotion={reducedMotion}>
            <QueryProvider>
              <Fallback.ErrorBoundary>
                <Suspense fallback={<Fallback.Route />}>
                  <RouterProvider router={router} />
                </Suspense>
              </Fallback.ErrorBoundary>
            </QueryProvider>
          </MotionConfig>
        </LazyMotion>
      </TooltipProvider>
      <Toaster />
    </>
  )
}

export default App
