import { createContext } from 'react'
import type { AuthClient } from '../core/client.js'

export const AuthClientContext = createContext<AuthClient | null>(null)

// Aktywne wewnątrz <AuthBoundary>. Gdy false — useAuth() nie woła /me,
// nie polluje, nie odświeża. Gdy true — pełny tryb chroniony.
export const AuthProtectedContext = createContext<boolean>(false)

// Klucz query używany przez useMe — eksportujemy go, żeby konsument mógł
// invalidate-ować z zewnątrz (np. po update profilu).
export const ME_QUERY_KEY = ['@musikhood-dev/auth-client', 'me'] as const
