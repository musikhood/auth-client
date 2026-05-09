import { computed, inject } from 'vue'
import type { UseMutationReturnType } from '@tanstack/vue-query'
import { useAuthClient } from './useAuthClient.js'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { AUTH_PROTECTED_KEY } from './key.js'
import type { LoginCredentials, TokenResponse, LogoutResponse } from '../core/types.js'

type CallableMutation<TData, TError, TVariables> = UseMutationReturnType<
  TData,
  TError,
  TVariables,
  unknown
> &
  ((variables: TVariables) => Promise<TData>)

function makeCallable<TData, TError, TVariables>(
  mutation: UseMutationReturnType<TData, TError, TVariables, unknown>,
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
  // Tryb chroniony aktywny tylko wewnątrz <AuthBoundary>.
  const isProtected = inject(AUTH_PROTECTED_KEY, false)

  const me = useMe({ enabled: isProtected })
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  const login = makeCallable(loginMutation)
  const logout = makeCallable(logoutMutation)

  return {
    client,
    user: computed(() => (isProtected ? (me.data.value ?? null) : null)),
    isLoading: computed(() => (isProtected ? me.isLoading.value : false)),
    isAuthenticated: computed(() =>
      isProtected ? !me.isError.value && me.data.value != null : false,
    ),
    error: computed(() => (isProtected ? me.error.value : null)),
    refetch: me.refetch,
    login,
    logout,
  }
}
