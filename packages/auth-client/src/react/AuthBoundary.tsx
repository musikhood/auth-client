import { useEffect, type ReactNode } from 'react'
import { AuthProtectedContext } from './context.js'
import { useAuth } from './useAuth.js'

export type AuthBoundaryProps = {
  children: ReactNode
  // Renderowane podczas pierwszego /me (gdy nie wiemy jeszcze czy user jest zalogowany).
  // Typowo: <Spinner /> albo skeleton. Default: null.
  fallback?: ReactNode
  // Wołane gdy /me się nie udało / sesja wygasła w trybie chronionym.
  // Typowo: nawigacja na /login. Nadpisuje globalny onUnauthorized z createAuthClient.
  onUnauthorized?: () => void
}

// Wszystko wewnątrz <AuthBoundary> ma "tryb chroniony" — useAuth() w tym poddrzewie
// woła /me, polluje co 30s i odświeża po focusie. Poza boundary useAuth() zwraca
// user: null bez żadnych requestów (stan publicznej strony, np. /login).
export function AuthBoundary({ children, fallback = null, onUnauthorized }: AuthBoundaryProps) {
  return (
    <AuthProtectedContext.Provider value={true}>
      <AuthBoundaryInner fallback={fallback} onUnauthorized={onUnauthorized}>
        {children}
      </AuthBoundaryInner>
    </AuthProtectedContext.Provider>
  )
}

// Wyodrębniony żeby useAuth() mógł działać w kontekście chronionym (musi być
// renderowany WEWNĄTRZ AuthProtectedContext.Provider).
function AuthBoundaryInner({
  children,
  fallback,
  onUnauthorized,
}: {
  children: ReactNode
  fallback: ReactNode
  onUnauthorized?: () => void
}) {
  const { user, isLoading, isAuthenticated, error } = useAuth()

  // Sesja w boundary się nie powiodła — wołamy callback (typowo redirect na /login).
  // Trigger gdy useMe zwróci error lub gdy mamy pewność że user się nie pojawi.
  useEffect(() => {
    if (!onUnauthorized) return
    if (!isLoading && !isAuthenticated && error) {
      onUnauthorized()
    }
  }, [isLoading, isAuthenticated, error, onUnauthorized])

  // Dopóki nie wiemy nic — pokazujemy fallback (spinner, skeleton, cokolwiek).
  if (isLoading) return <>{fallback}</>
  // Wiemy że user się nie zalogował — jeśli konsument nie podał callbacku, dalej
  // renderujemy fallback (zamiast pokazywać "nagi" chroniony layout bez usera).
  if (!user) return <>{fallback}</>

  return <>{children}</>
}
