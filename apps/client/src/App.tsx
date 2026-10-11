import { Toaster } from '@i-thinking/design/components/sonner'
import { TooltipProvider } from '@i-thinking/design/components/tooltip'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import localeData from 'dayjs/plugin/localeData'

import { Suspense } from 'react'
import { RouterProvider } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { QueryProvider } from '@/components/provider/query'
import { router } from '@/routers/index'

dayjs.extend(localeData)
dayjs.locale('zh-cn')

function App() {
  return (
    <>
      <TooltipProvider>
        <LazyMotion features={domMax}>
          <MotionConfig reducedMotion="user">
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
