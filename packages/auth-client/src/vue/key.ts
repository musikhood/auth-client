import type { InjectionKey } from 'vue'
import type { AuthClient } from '../core/client.js'

export const AUTH_CLIENT_KEY: InjectionKey<AuthClient> = Symbol('@musikhood-dev/auth-client')

// Tryb boundary — null poza boundary, 'protected' / 'guest' wewnątrz.
export type AuthProtectedMode = 'protected' | 'guest'
export const AUTH_PROTECTED_KEY: InjectionKey<AuthProtectedMode | null> = Symbol(
  '@musikhood-dev/auth-client/protected',
)

// Klucz query — eksponowany żeby konsument mógł invalidate-ować z zewnątrz.
export const ME_QUERY_KEY = ['@musikhood-dev/auth-client', 'me'] as const
