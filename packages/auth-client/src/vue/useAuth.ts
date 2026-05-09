import { computed } from 'vue'
import type { UseMutationReturnType } from '@tanstack/vue-query'
import { useAuthClient } from './useAuthClient.js'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
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
  // W Vue obiekt mutation to ref-y/computed-y — Object.assign skleja referencje,
  // a refy są reaktywne, więc `login.isPending.value` w template nadal działa.
  return Object.assign(fn, mutation)
}

export type UseAuthLogin = CallableMutation<TokenResponse, Error, LoginCredentials>
export type UseAuthLogout = CallableMutation<LogoutResponse, Error, void>

export function useAuth() {
  const client = useAuthClient()
  const me = useMe()
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  const login = makeCallable(loginMutation)
  const logout = makeCallable(logoutMutation)

  return {
    client,
    user: computed(() => me.data.value ?? null),
    isLoading: computed(() => me.isLoading.value),
    isAuthenticated: computed(() => !me.isError.value && me.data.value != null),
    error: computed(() => me.error.value),
    refetch: me.refetch,
    login,
    logout,
  }
}
