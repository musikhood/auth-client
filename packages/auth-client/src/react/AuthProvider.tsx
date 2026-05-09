import { useContext, useEffect, useState, type ReactNode } from 'react'
import {
  QueryClient,
  QueryClientContext,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import type { AuthClient } from '../core/client.js'
import { AuthClientContext, ME_QUERY_KEY } from './context.js'

export type AuthProviderProps = {
  client: AuthClient
  children: ReactNode
}

// Wewnętrzny komponent — wpina eventy klienta w cache TanStack Query.
// Wyniesione z AuthProvider, żeby useQueryClient() leciał z gwarantowanego contextu
// (albo zewnętrznego od konsumenta, albo naszego fallbackowego).
function AuthEventsBridge({ client }: { client: AuthClient }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offUnauthorized = client.on('unauthorized', () => {
      queryClient.setQueryData(ME_QUERY_KEY, null)
    })
    const offLogout = client.on('logout', () => {
      queryClient.setQueryData(ME_QUERY_KEY, null)
    })
    const offLogin = client.on('login', () => {
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    })
    return () => {
      offUnauthorized()
      offLogout()
      offLogin()
    }
  }, [client, queryClient])
  return null
}

export function AuthProvider({ client, children }: AuthProviderProps) {
  // Sprawdzamy czy konsument ma własny QueryClientProvider w drzewie.
  // Jeśli tak — używamy jego (dzieli cache z resztą aplikacji).
  // Jeśli nie — robimy fallback, żeby paczka działała "out of the box".
  const externalQueryClient = useContext(QueryClientContext)
  const [fallbackQueryClient] = useState(() => (externalQueryClient ? null : new QueryClient()))

  const inner = (
    <AuthClientContext.Provider value={client}>
      <AuthEventsBridge client={client} />
      {children}
    </AuthClientContext.Provider>
  )

  if (fallbackQueryClient) {
    return <QueryClientProvider client={fallbackQueryClient}>{inner}</QueryClientProvider>
  }
  return inner
}
