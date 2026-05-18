import { createContext } from 'react'
import type { AuthClient } from '../core/client.js'

export const AuthClientContext = createContext<AuthClient | null>(null)

// Aktywne wewnątrz <AuthBoundary>. Niesie tryb boundary oraz info czy guest
// chce sprawdzać /me (gdy podano onAuthenticated).
//   - 'protected':       useAuth() woła /me + polluje
//   - 'guest-passive':   useAuth() NIE woła /me (formularz od razu)
//   - 'guest-checking':  useAuth() woła /me raz (żeby zdecydować o auto-redirect)
//   - null:              poza boundary, useAuth() nie woła /me wcale, user=null
export type AuthProtectedMode = 'protected' | 'guest-passive' | 'guest-checking'
export const AuthProtectedContext = createContext<AuthProtectedMode | null>(null)

// Klucz query używany przez useMe — eksportujemy go, żeby konsument mógł
// invalidate-ować z zewnątrz (np. po update profilu).
export const ME_QUERY_KEY = ['@musikhood-dev/auth-client', 'me'] as const
