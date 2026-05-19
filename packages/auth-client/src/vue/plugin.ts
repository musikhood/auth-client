import type { App, Plugin } from 'vue'
import type { AuthClient } from '../core/client.js'
import { AUTH_CLIENT_KEY } from './key.js'

export type AuthPlugin = Plugin & { client: AuthClient }

export type AuthPluginOptions = {
  // Opcjonalna funkcja nawigacji (np. router.push z vue-router). Gdy podana,
  // paczka używa jej dla wszystkich redirectów zamiast `window.location.href`.
  // Soft navigation = brak hard reloadu = toasty i state przeżywają redirect.
  navigate?: (path: string) => void
}

// Konsument Vue MUSI zainstalować VueQueryPlugin samodzielnie (zwykle przed createAuth):
//   import { VueQueryPlugin } from '@tanstack/vue-query'
//   app.use(VueQueryPlugin)
//   app.use(createAuth(authClient, { navigate: (p) => router.push(p) }))
export function createAuth(client: AuthClient, options?: AuthPluginOptions): AuthPlugin {
  const plugin: AuthPlugin = {
    client,
    install(app: App) {
      app.provide(AUTH_CLIENT_KEY, client)
      if (options?.navigate) {
        client.setRedirect(options.navigate)
      }
    },
  }
  return plugin
}
