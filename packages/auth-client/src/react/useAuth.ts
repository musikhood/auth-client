import { useMemo } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { useAuthClient } from './useAuthClient.js'
import type { LoginCredentials, TokenResponse, LogoutResponse } from '../core/types.js'

// Callable wrapper nad UseMutationResult — funkcja, która:
//   - wołana jak funkcja, robi mutateAsync (zwraca Promise),
//   - ma wszystkie pola mutation (isPending, error, reset, ...).
// Dzięki temu konsument pisze `await login(creds)` i jednocześnie
// ma dostęp do `login.isPending`, `login.error` w UI.
type CallableMutation<TData, TError, TVariables> = UseMutationResult<TData, TError, TVariables> &
  ((variables: TVariables) => Promise<TData>)

function makeCallable<TData, TError, TVariables>(
  mutation: UseMutationResult<TData, TError, TVariables>,
): CallableMutation<TData, TError, TVariables> {
  // Object.assign na funkcji — funkcja staje się "obiektem" niosącym pola mutation.
  // mutateAsync jest stabilny per-mutation-instance (TanStack cache'uje), więc
  // referencja `login` zmienia się dopiero gdy zmienia się stan mutation —
  // dokładnie tak jak zwykły hook.
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
  const meQuery = useMe()
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  // useMemo, żeby referencja callable nie zmieniała się przy każdym renderze.
  // Zależności pokrywają każdą obserwowalną zmianę stanu mutation —
  // gdy któryś z tych pól się zmieni, robimy nowy callable.
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

  return {
    client,
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    isAuthenticated: !meQuery.isError && meQuery.data != null,
    error: meQuery.error,
    refetch: meQuery.refetch,
    login,
    logout,
  }
}
