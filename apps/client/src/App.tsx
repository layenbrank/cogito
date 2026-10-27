import { Toaster } from '@cogito/design/components/sonner'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { useSyncExternalStore } from 'react'

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import localeData from 'dayjs/plugin/localeData'

import { Suspense } from 'react'
import { RouterProvider } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { QueryProvider } from '@/components/provider/query'
import { useAutomationRunner } from '@/features/automation/use-automation-runner'
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
