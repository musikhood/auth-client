import { useEffect, useMemo, type ReactNode } from 'react'
import { AuthProtectedContext } from './context.js'
import { useAuth } from './useAuth.js'

export type AuthBoundaryMode = 'protected' | 'guest'

export type AuthBoundaryProps = {
  children: ReactNode

  // Tryb sesji:
  //  - "protected" (default): wymaga zalogowanego usera. /me jest wołane, polling działa.
  //  - "guest":               wymaga NIEzalogowanego usera (strony publiczne typu /login).
  //                           /me jest wołane raz (bez pollingu) żeby wiedzieć czy user już ma sesję.
  mode?: AuthBoundaryMode

  // Renderowane gdy: ładujemy /me LUB warunki dostępu niespełnione (przed wywołaniem callbacku).
  // Typowo <Spinner/> albo skeleton. Default: null.
  fallback?: ReactNode

  // Kontrola dostępu po rolach — tylko w trybie "protected".
  // Mutually exclusive — używaj jednego z dwóch:
  //   requireRoles: user musi mieć WSZYSTKIE wymienione (AND).
  //   requireAnyRole: user musi mieć PRZYNAJMNIEJ JEDNĄ (OR).
  requireRoles?: string[]
  requireAnyRole?: string[]

  // Tryb "protected": user się nie zalogował / sesja wygasła.
  onUnauthorized?: () => void

  // Tryb "protected": user zalogowany, ale brak wymaganych ról.
  // Jeśli nie podano, paczka woła onUnauthorized jako fallback.
  onForbidden?: () => void

  // Tryb "guest": user JEST zalogowany (typowo redirect z /login na /).
  onAuthenticated?: () => void
}

// Wszystko wewnątrz <AuthBoundary> ma "tryb chroniony" (lub "guest") — useAuth() w tym
// poddrzewie woła /me. Polling tylko w trybie "protected".
export function AuthBoundary(props: AuthBoundaryProps) {
  const mode = props.mode ?? 'protected'
  return (
    <AuthProtectedContext.Provider value={mode}>
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
  onUnauthorized,
  onForbidden,
  onAuthenticated,
}: AuthBoundaryProps) {
  const { user, isLoading, error } = useAuth()

  // Sprawdzenie ról. Tylko sensowne gdy mamy usera i mode=protected.
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

  // Wywołania callbacków — w useEffect, żeby nie odpalać side effect podczas renderu.
  useEffect(() => {
    if (isLoading) return

    if (mode === 'protected') {
      // Brak sesji.
      if (!user) {
        if (error || !isLoading) {
          onUnauthorized?.()
        }
        return
      }
      // Sesja jest, ale brak ról.
      if (!hasRequiredRoles) {
        ;(onForbidden ?? onUnauthorized)?.()
      }
      return
    }

    if (mode === 'guest') {
      // Jest sesja — przekieruj.
      if (user) {
        onAuthenticated?.()
      }
    }
  }, [isLoading, user, error, mode, hasRequiredRoles, onUnauthorized, onForbidden, onAuthenticated])

  if (isLoading) return <>{fallback}</>

  if (mode === 'protected') {
    if (!user || !hasRequiredRoles) return <>{fallback}</>
    return <>{children}</>
  }

  // mode === 'guest'
  if (user) return <>{fallback}</>
  return <>{children}</>
}
