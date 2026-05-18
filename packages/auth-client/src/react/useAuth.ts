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

  // /me strzelamy w obu trybach boundary (protected + guest), ALE NIE jeśli
  // sesja jest "expired" (po logout / refresh fail). Bez tego pętla:
  // refetch → 401 → refresh fail → unauthorized event → refetch → ...
  // Reset 'expired' następuje przy login().
  const sessionExpired = useSessionExpired(client)
  const enabled = mode !== null && !sessionExpired
  // Domyślny interval z configu klienta (jeśli ustawiono meRefetchInterval).
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

  // Poza boundary user jest zawsze null (nie wołamy /me, więc nie wiemy nic).
  // Wewnątrz boundary (protected lub guest) user przychodzi z meQuery.
  return {
    client,
    user: enabled ? (meQuery.data ?? null) : null,
    isLoading: enabled ? meQuery.isLoading : false,
    isAuthenticated: enabled ? !meQuery.isError && meQuery.data != null : false,
    error: enabled ? meQuery.error : null,
    refetch: meQuery.refetch,
    login,
    logout,
  }
}
