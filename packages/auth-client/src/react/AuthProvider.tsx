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
  // Opcjonalna funkcja nawigacji (np. React Router useNavigate). Gdy podana,
  // paczka używa jej dla wszystkich redirectów zamiast `window.location.href`.
  // Soft navigation = brak hard reloadu = toasty i state przeżywają redirect.
  navigate?: (path: string) => void
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

// Wpina prop `navigate` do clienta przez setRedirect. Zawsze odpiętypo unmount,
// żeby stary navigate (np. po HMR) nie żył w referencji.
function AuthRedirectBridge({
  client,
  navigate,
}: {
  client: AuthClient
  navigate: (path: string) => void
}) {
  useEffect(() => {
    client.setRedirect(navigate)
    return () => client.setRedirect(null)
  }, [client, navigate])
  return null
}

export function AuthProvider({ client, children, navigate }: AuthProviderProps) {
  // Sprawdzamy czy konsument ma własny QueryClientProvider w drzewie.
  // Jeśli tak — używamy jego (dzieli cache z resztą aplikacji).
  // Jeśli nie — robimy fallback, żeby paczka działała "out of the box".
  const externalQueryClient = useContext(QueryClientContext)
  const [fallbackQueryClient] = useState(() => (externalQueryClient ? null : new QueryClient()))

  const inner = (
    <AuthClientContext.Provider value={client}>
      <AuthEventsBridge client={client} />
      {navigate ? <AuthRedirectBridge client={client} navigate={navigate} /> : null}
      {children}
    </AuthClientContext.Provider>
  )

  if (fallbackQueryClient) {
    return <QueryClientProvider client={fallbackQueryClient}>{inner}</QueryClientProvider>
  }
  return inner
}
