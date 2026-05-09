import type { InjectionKey } from 'vue'
import type { AuthClient } from '../core/client.js'

export const AUTH_CLIENT_KEY: InjectionKey<AuthClient> = Symbol('@musikhood-dev/auth-client')

// Aktywne wewnątrz <AuthBoundary>. Gdy true — useAuth() woła /me, polluje, refetchuje.
export const AUTH_PROTECTED_KEY: InjectionKey<boolean> = Symbol(
  '@musikhood-dev/auth-client/protected',
)

// Klucz query — eksponowany żeby konsument mógł invalidate-ować z zewnątrz.
export const ME_QUERY_KEY = ['@musikhood-dev/auth-client', 'me'] as const
