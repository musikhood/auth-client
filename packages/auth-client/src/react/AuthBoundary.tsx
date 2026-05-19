import { useEffect, useMemo, type ReactNode } from 'react'
import { AuthProtectedContext } from './context.js'
import { useAuth } from './useAuth.js'
import { useAuthClient } from './useAuthClient.js'

export type AuthBoundaryMode = 'protected' | 'guest'

export type AuthBoundaryProps = {
  children: ReactNode

  // Tryb sesji:
  //  - "protected" (default): wymaga zalogowanego usera. Paczka strzela /me, polluje
  //    co 30s, odświeża po focusie. Brak sesji → redirect na loginPath (z configu).
  //  - "guest": strona publiczna (np. /login). Paczka sprawdza /me raz; jeśli user
  //    jest zalogowany → redirect na homePath. Niezalogowany → renderuje children.
  mode?: AuthBoundaryMode

  // Renderowane podczas pierwszego /me lub gdy warunki dostępu jeszcze się rozstrzygają.
  // Typowo <Spinner/> albo skeleton. Default: null.
  fallback?: ReactNode

  // Wymagane role (tylko mode="protected"). Brak ról → redirect na forbiddenPath
  // (z configu klienta, default = loginPath).
  // Mutually exclusive — używaj jednej z dwóch:
  requireRoles?: string[] // user musi mieć WSZYSTKIE (AND)
  requireAnyRole?: string[] // user musi mieć PRZYNAJMNIEJ JEDNĄ (OR)
}

// Konsument NIE pisze żadnych callbacków. Paczka decyduje sama gdzie redirectować
// na podstawie konfiguracji loginPath/homePath/forbiddenPath w createAuthClient.
export function AuthBoundary(props: AuthBoundaryProps) {
  const mode = props.mode ?? 'protected'
  return (
    <AuthProtectedContext.Provider value={mode === 'guest' ? 'guest-checking' : 'protected'}>
      <AuthBoundaryInner {...props} />
    </AuthProtectedContext.Provider>
  )
}

function AuthBoundaryInner({
  children,
  mode = 'protected',
  fallback = null,
  requireRoles,
  requireAnyRole,
}: AuthBoundaryProps) {
  const client = useAuthClient()
  const { user, isLoading } = useAuth()

  const config = client.config
  const loginPath = config.loginPath
  const homePath = config.homePath ?? '/'
  const forbiddenPath = config.forbiddenPath ?? loginPath

  // Czy user ma wymagane role (jeśli boundary tego wymaga).
  const hasRequiredRoles = useMemo(() => {
    if (mode !== 'protected') return true
    if (!user) return false
    const userRoles = user.roles ?? []
    if (requireRoles && requireRoles.length > 0) {
      return requireRoles.every((r) => userRoles.includes(r))
    }
    if (requireAnyRole && requireAnyRole.length > 0) {
      return requireAnyRole.some((r) => userRoles.includes(r))
    }
    return true
  }, [mode, user, requireRoles, requireAnyRole])

  // Redirecty są **side-effectami** boundary. Każdy redirect uruchamia się tylko raz
  // dzięki pathname guard w `client.redirect` (paczka sama wewnętrznie sprawdza).
  // Wykonanie w useEffect: nie blokujemy renderu, nie odpalamy podczas SSR (window nie istnieje).
  useEffect(() => {
    if (isLoading) return

    if (mode === 'protected') {
      if (!user) {
        // Brak sesji — paczka idzie na loginPath. Jeśli config nie ma loginPath,
        // konsument MUSI obsłużyć sytuację sam (np. przez własny redirect w fallback).
        if (loginPath) client.redirectTo(loginPath)
        return
      }
      if (!hasRequiredRoles) {
        if (forbiddenPath) client.redirectTo(forbiddenPath)
        return
      }
      // user + role OK — nic nie robimy, renderujemy children.
      return
    }

    // mode === 'guest'
    if (user) {
      // Zalogowany na publicznej stronie → home.
      client.redirectTo(homePath)
    }
  }, [isLoading, user, hasRequiredRoles, mode, loginPath, homePath, forbiddenPath, client])

  if (isLoading) return <>{fallback}</>

  if (mode === 'protected') {
    if (!user || !hasRequiredRoles) return <>{fallback}</>
    return <>{children}</>
  }

  // mode === 'guest'
  if (user) return <>{fallback}</>
  return <>{children}</>
}
