import { inject } from 'vue'
import type { AuthClient } from '../core/client.js'
import { AUTH_CLIENT_KEY } from './key.js'

export function useAuthClient(): AuthClient {
  const client = inject(AUTH_CLIENT_KEY, null)
  if (!client) {
    throw new Error(
      'useAuthClient: brak pluginu createAuth(). Wywołaj app.use(createAuth(authClient)).',
    )
  }
  return client
}
