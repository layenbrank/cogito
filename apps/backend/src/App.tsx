import { Toaster } from '@cogito/design/components/sonner'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { LazyMotion, MotionConfig, domMax } from 'motion/react'
import { Suspense } from 'react'
import { RouterProvider } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.tsx'
import { QueryProvider } from '@/components/provider/query.tsx'
import { router } from '@/routers/index.tsx'

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
