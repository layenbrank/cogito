import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { buildQueryClient } from '@/utils/query-client'

interface QueryProviderProps {
  children: ReactNode
}

export function QueryProvider(props: QueryProviderProps) {
  const [client] = useState(buildQueryClient)

  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}
