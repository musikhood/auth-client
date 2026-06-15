import { useContext, useMemo, useSyncExternalStore } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { useAuthClient } from './useAuthClient.js'
import { AuthProtectedContext } from './context.js'
import type { AuthClient } from '../core/client.js'
import type { LoginCredentials, TokenResponse, LogoutResponse } from '../core/types.js'

// Subskrypcja na sessionState klienta. Zwraca aktualne `isSessionExpired()`,
// triggeruje re-render gdy klient emituje login/logout/unauthorized.
function useSessionExpired(client: AuthClient): boolean {
  return useSyncExternalStore(
    (callback) => {
      const offLogin = client.on('login', callback)
      const offLogout = client.on('logout', callback)
      const offUnauthorized = client.on('unauthorized', callback)
      return () => {
        offLogin()
        offLogout()
        offUnauthorized()
      }
    },
    () => client.isSessionExpired(),
    () => false, // SSR: na serwerze "fresh" — i tak useMe nie pójdzie bez window
  )
}

// Subskrypcja na terminalny stan 403 (brak dostępu do panelu). Odrębny od
// sessionExpired — re-render przy 'panel-access-denied' oraz 'login' (reset).
function usePanelAccessDenied(client: AuthClient): boolean {
  return useSyncExternalStore(
    (callback) => {
      const offDenied = client.on('panel-access-denied', callback)
      const offLogin = client.on('login', callback)
      return () => {
        offDenied()
        offLogin()
      }
    },
    () => client.isPanelAccessDenied(),
    () => false, // SSR
  )
}

// Callable wrapper nad UseMutationResult — funkcja, która:
//   - wołana jak funkcja, robi mutateAsync (zwraca Promise),
//   - ma wszystkie pola mutation (isPending, error, reset, ...).
type CallableMutation<TData, TError, TVariables> = UseMutationResult<TData, TError, TVariables> &
  ((variables: TVariables) => Promise<TData>)

function makeCallable<TData, TError, TVariables>(
  mutation: UseMutationResult<TData, TError, TVariables>,
): CallableMutation<TData, TError, TVariables> {
  const fn = ((variables: TVariables) => mutation.mutateAsync(variables)) as CallableMutation<
    TData,
    TError,
    TVariables
  >
  return Object.assign(fn, mutation)
}

export type UseAuthLogin = CallableMutation<TokenResponse, Error, LoginCredentials>
export type UseAuthLogout = CallableMutation<LogoutResponse, Error, void>

export function useAuth() {
  const client = useAuthClient()
  // Kontekst boundary — null poza boundary, 'protected' / 'guest' wewnątrz.
  const mode = useContext(AuthProtectedContext)

  // /me strzelamy gdy:
  //   - mode === 'protected'      (chroniona trasa, sprawdzamy + polluje)
  //   - mode === 'guest-checking' (publiczna trasa, sprawdzamy raz — żeby ewentualnie
  //                                redirectować zalogowanego usera na homePath)
  // NIE strzelamy gdy:
  //   - mode === null             (poza boundary)
  //   - sessionExpired === true   (po logout / refresh fail, czeka na nowy login)
  const sessionExpired = useSessionExpired(client)
  const panelAccessDenied = usePanelAccessDenied(client)
  // 403 brak dostępu do panelu = stan terminalny. Wyłączamy /me (jak przy
  // sessionExpired), żeby polling nie zapętlał 403.
  const enabled =
    (mode === 'protected' || mode === 'guest-checking') && !sessionExpired && !panelAccessDenied
  // Polling tylko w trybie 'protected'.
  const configInterval = client.config.meRefetchInterval
  const refetchInterval =
    mode !== 'protected'
      ? (false as const)
      : configInterval === false
        ? (false as const)
        : (configInterval ?? 30_000)

  const meQuery = useMe({ enabled, refetchInterval })
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  const login = useMemo(
    () => makeCallable(loginMutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loginMutation.isPending, loginMutation.error, loginMutation.data, loginMutation.status],
  )
  const logout = useMemo(
    () => makeCallable(logoutMutation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logoutMutation.isPending, logoutMutation.error, logoutMutation.data, logoutMutation.status],
  )

  // Wartości returnowane dla 3 stanów (kolejność od najwyższego priorytetu):
  //  1) sessionExpired: wiemy że sesji nie ma → user=null, isLoading=false (BEZ
  //     czekania na disabled useMe).
  //  2) enabled (mode jest 'protected' lub 'guest-checking'): czytamy z meQuery.
  //  3) Poza boundary (mode === null): user=null, isLoading=false, nic nie robimy.
  const result = (() => {
    if (sessionExpired) {
      return {
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: meQuery.error ?? new Error('Session expired'),
      }
    }
    if (panelAccessDenied) {
      // Sesja żyje, ale brak dostępu do tego panelu. user=null → AuthBoundary
      // renderuje fallback i (przez !user) redirectuje na loginPath. Polling
      // wyłączony przez enabled=false — bez pętli 403.
      return {
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: meQuery.error ?? new Error('No access to this panel'),
      }
    }
    if (enabled) {
      return {
        user: meQuery.data ?? null,
        isLoading: meQuery.isLoading,
        isAuthenticated: !meQuery.isError && meQuery.data != null,
        error: meQuery.error,
      }
    }
    return { user: null, isLoading: false, isAuthenticated: false, error: null }
  })()

  return {
    client,
    ...result,
    refetch: meQuery.refetch,
    login,
    logout,
  }
}
