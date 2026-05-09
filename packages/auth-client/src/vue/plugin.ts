import type { App, Plugin } from 'vue'
import type { AuthClient } from '../core/client.js'
import { AUTH_CLIENT_KEY } from './key.js'

export type AuthPlugin = Plugin & { client: AuthClient }

// Konsument Vue MUSI zainstalować VueQueryPlugin samodzielnie (zwykle przed createAuth):
//   import { VueQueryPlugin } from '@tanstack/vue-query'
//   app.use(VueQueryPlugin)
//   app.use(createAuth(authClient))
// Świadoma decyzja: nie auto-installujemy, bo to wymusiłoby vue-query jako twardą
// dependency (zwiększyłoby bundle dla konsumentów React).
export function createAuth(client: AuthClient): AuthPlugin {
  const plugin: AuthPlugin = {
    client,
    install(app: App) {
      app.provide(AUTH_CLIENT_KEY, client)
    },
  }
  return plugin
}
