import { useEffect, useMemo, useRef, type ReactNode } from 'react'
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
//
// W trybie "guest" wołanie /me jest opt-in przez podanie onAuthenticated:
//   <AuthBoundary mode="guest">…</AuthBoundary>
//     → NIE strzela /me. Zakładamy że user jest niezalogowany, renderujemy children.
//   <AuthBoundary mode="guest" onAuthenticated={() => nav('/')}>…</AuthBoundary>
//     → Strzela /me raz. Jeśli user jest zalogowany → onAuthenticated → callback.
export function AuthBoundary(props: AuthBoundaryProps) {
  const mode = props.mode ?? 'protected'
  // Guest bez callbacka = nie sprawdzamy sesji. Guest z callbackiem = sprawdzamy.
  const contextMode =
    mode === 'guest' ? (props.onAuthenticated ? 'guest-checking' : 'guest-passive') : 'protected'
  return (
    <AuthProtectedContext.Provider value={contextMode}>
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

  // KLUCZOWE: callbacks są w refs, NIE w deps useEffect.
  // Bez tego każdy nowy callback (inline arrow w propsie konsumenta) re-triggerował
  // effect i robił nieskończoną pętlę redirect→remount→redirect.
  const cbRefs = useRef({ onUnauthorized, onForbidden, onAuthenticated })
  cbRefs.current = { onUnauthorized, onForbidden, onAuthenticated }

  // Drugi guard: NIE wołaj tego samego callbacku dwa razy z rzędu dla tego samego stanu.
  // Bez tego: focus okna → useMe refetch → 401 → SessionExpiredError → effect → onUnauthorized
  // → navigate → re-mount → znowu cały cykl.
  const lastFired = useRef<'unauthorized' | 'forbidden' | 'authenticated' | null>(null)

  useEffect(() => {
    if (isLoading) return

    if (mode === 'protected') {
      if (!user) {
        // Brak sesji po zakończonym ładowaniu — fire raz. Ref guard chroni przed
        // pętlą gdy callback navigation triggeruje re-mount.
        if (lastFired.current !== 'unauthorized') {
          lastFired.current = 'unauthorized'
          cbRefs.current.onUnauthorized?.()
        }
        return
      }
      // Sesja jest.
      if (!hasRequiredRoles) {
        if (lastFired.current !== 'forbidden') {
          lastFired.current = 'forbidden'
          ;(cbRefs.current.onForbidden ?? cbRefs.current.onUnauthorized)?.()
        }
        return
      }
      // Sesja + role OK — reset guarda (przy następnym wylogowaniu effect zadziała).
      lastFired.current = null
      return
    }

    if (mode === 'guest') {
      if (user && lastFired.current !== 'authenticated') {
        lastFired.current = 'authenticated'
        cbRefs.current.onAuthenticated?.()
      } else if (!user) {
        lastFired.current = null
      }
    }
  }, [isLoading, user, error, mode, hasRequiredRoles])

  if (isLoading) return <>{fallback}</>

  if (mode === 'protected') {
    if (!user || !hasRequiredRoles) return <>{fallback}</>
    return <>{children}</>
  }

  // mode === 'guest'
  if (user) return <>{fallback}</>
  return <>{children}</>
}
