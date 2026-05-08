import type { InjectionKey } from 'vue'
import type { AuthClient } from '../core/client.js'

export const AUTH_CLIENT_KEY: InjectionKey<AuthClient> = Symbol('@musikhood-dev/auth-client')

// Klucz query — eksponowany żeby konsument mógł invalidate-ować z zewnątrz.
export const ME_QUERY_KEY = ['@musikhood-dev/auth-client', 'me'] as const
