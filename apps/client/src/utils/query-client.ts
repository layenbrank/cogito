import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { reportUnknown } from '@/utils/exception-report.ts'

function buildQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError(error) {
        reportUnknown(error, { kind: 'react-query.query' }, 'warning')
      }
    }),
    mutationCache: new MutationCache({
      onError(error) {
        reportUnknown(error, { kind: 'react-query.mutation' }, 'error')
      }
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: 0
      }
    }
  })
}

export { buildQueryClient }
