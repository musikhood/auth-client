import { useContext } from 'react'
import { AuthClientContext } from './context.js'
import type { AuthClient } from '../core/client.js'

export function useAuthClient(): AuthClient {
  const client = useContext(AuthClientContext)
  if (!client) {
    throw new Error(
      'useAuthClient: brak <AuthProvider>. Owinął <App /> w <AuthProvider client={...}>.',
    )
  }
  return client
}
