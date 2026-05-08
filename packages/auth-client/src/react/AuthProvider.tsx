import { useEffect, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AuthClient } from '../core/client.js'
import { AuthClientContext, ME_QUERY_KEY } from './context.js'

export type AuthProviderProps = {
  client: AuthClient
  children: ReactNode
}

export function AuthProvider({ client, children }: AuthProviderProps) {
  const queryClient = useQueryClient()

  useEffect(() => {
    // Po unauthorized lub logout zerujemy cache /me — kolejny render który
    // czyta useMe() dostanie świeży, pusty stan zamiast starych danych usera.
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

  return <AuthClientContext.Provider value={client}>{children}</AuthClientContext.Provider>
}
