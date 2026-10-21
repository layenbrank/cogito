import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { clearAuthToken, isSessionInvalid } from '@/utils/auth.ts'

function dropInvalidSession(error: unknown): void {
  if (!isSessionInvalid(error)) return
  clearAuthToken()
}

function buildQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: dropInvalidSession
    }),
    mutationCache: new MutationCache({
      onError: dropInvalidSession
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
