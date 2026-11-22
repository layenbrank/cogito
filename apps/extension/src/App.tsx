import { TooltipProvider } from '@cogito/design/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import localeData from 'dayjs/plugin/localeData'
import { LazyMotion, domMax } from 'motion/react'
import { useMemo } from 'react'
import { RouterProvider } from 'react-router-dom'

import { buildReactRouter } from '@/router/react.tsx'

dayjs.extend(localeData)
dayjs.locale('zh-cn')

/**
 * 应用壳：全局 provider + 路由。
 *
 * 这里先只装 React Query（视图用它取数）；主题/工具提示等按需再加。
 */
function buildQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false
      },
      mutations: { retry: 0 }
    }
  })
}

export default function App() {
  const router = useMemo(function () {
    return buildReactRouter()
  }, [])
  const queryClient = useMemo(function () {
    return buildQueryClient()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={domMax}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </LazyMotion>
    </QueryClientProvider>
  )
}
