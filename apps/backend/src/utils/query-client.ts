import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { clearAuthToken, isSessionInvalid } from '@/utils/auth.ts'
import { reportUnknown } from '@/utils/exception-report.ts'

function dropInvalidSession(error: unknown): void {
  if (!isSessionInvalid(error)) return
  clearAuthToken()
}

function reportQueryError(error: unknown, kind: 'query' | 'mutation'): void {
  dropInvalidSession(error)
  reportUnknown(error, { kind: `react-query.${kind}` }, kind === 'mutation' ? 'error' : 'warning')
}

function buildQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError(error) {
        reportQueryError(error, 'query')
      }
    }),
    mutationCache: new MutationCache({
      onError(error) {
        reportQueryError(error, 'mutation')
      }
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry(failureCount, error) {
          if (isSessionInvalid(error)) return false
          return failureCount < 1
        },
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: 0
      }
    }
  })
}

export { buildQueryClient }
