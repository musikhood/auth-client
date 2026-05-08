import type { App, Plugin } from 'vue'
import type { AuthClient } from '../core/client.js'
import { AUTH_CLIENT_KEY } from './key.js'

export type AuthPlugin = Plugin & { client: AuthClient }

export function createAuth(client: AuthClient): AuthPlugin {
  const plugin: AuthPlugin = {
    client,
    install(app: App) {
      app.provide(AUTH_CLIENT_KEY, client)
    },
  }
  return plugin
}
