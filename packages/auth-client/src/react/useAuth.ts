import { useContext, useMemo } from 'react'
import type { UseMutationResult } from '@tanstack/react-query'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { useAuthClient } from './useAuthClient.js'
import { AuthProtectedContext } from './context.js'
import type { LoginCredentials, TokenResponse, LogoutResponse } from '../core/types.js'

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
  // Kontekst protekcji — true tylko wewnątrz <AuthBoundary>.
  // Poza boundary useMe nie strzela /me i nie polluje (enabled: false).
  const isProtected = useContext(AuthProtectedContext)

  const meQuery = useMe({ enabled: isProtected })
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
  // Wewnątrz boundary user przychodzi z meQuery.
  return {
    client,
    user: isProtected ? (meQuery.data ?? null) : null,
    isLoading: isProtected ? meQuery.isLoading : false,
    isAuthenticated: isProtected ? !meQuery.isError && meQuery.data != null : false,
    error: isProtected ? meQuery.error : null,
    refetch: meQuery.refetch,
    login,
    logout,
  }
}
