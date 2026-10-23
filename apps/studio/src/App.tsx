import { Toaster } from '@cogito/design/components/sonner'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { MotionConfig } from 'motion/react'
import { Suspense } from 'react'
import { RouterProvider } from 'react-router-dom'

import { Fallback } from '@/components/fallback'
import { QueryProvider } from '@/components/provider/query'
import { router } from './routers'

function App() {
  return (
    <>
      <TooltipProvider>
        <MotionConfig reducedMotion="user">
          <QueryProvider>
            <Fallback.ErrorBoundary>
              <Suspense fallback={<Fallback.Route />}>
                <RouterProvider router={router} />
              </Suspense>
            </Fallback.ErrorBoundary>
          </QueryProvider>
        </MotionConfig>
      </TooltipProvider>
      <Toaster />
    </>
  )
}

export default App
