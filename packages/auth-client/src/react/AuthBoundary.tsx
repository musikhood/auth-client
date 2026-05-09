import type { ReactNode } from 'react'
import { AuthProtectedContext } from './context.js'

export type AuthBoundaryProps = {
  children: ReactNode
}

// Wszystko wewnątrz <AuthBoundary> ma "tryb chroniony" — useAuth() w tym poddrzewie
// woła /me, polluje co 30s i odświeża po focusie. Poza boundary useAuth() zwraca
// user: null bez żadnych requestów (stan publicznej strony, np. /login).
//
// W typowej aplikacji owijamy boundary chroniony layout (lub root, jeśli cała
// aplikacja jest za auth gate).
export function AuthBoundary({ children }: AuthBoundaryProps) {
  return <AuthProtectedContext.Provider value={true}>{children}</AuthProtectedContext.Provider>
}
