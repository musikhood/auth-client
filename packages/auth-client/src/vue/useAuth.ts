import { computed, inject, onScopeDispose, ref } from 'vue'
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
  // null poza boundary, 'protected' / 'guest' wewnątrz.
  const mode = inject(AUTH_PROTECTED_KEY, null)

  // Reactive flag — re-renderuje gdy session umiera/wraca.
  // Bez tego useMe pollowałby na ślepo po logout (pętla refetch → 401).
  const sessionExpired = ref(client.isSessionExpired())
  const updateExpired = () => {
    sessionExpired.value = client.isSessionExpired()
  }
  const offLogin = client.on('login', updateExpired)
  const offLogout = client.on('logout', updateExpired)
  const offUnauthorized = client.on('unauthorized', updateExpired)
  onScopeDispose(() => {
    offLogin()
    offLogout()
    offUnauthorized()
  })

  const enabled = computed(() => mode !== null && !sessionExpired.value)
  const configInterval = client.config.meRefetchInterval
  const refetchInterval =
    mode !== 'protected'
      ? (false as const)
      : configInterval === false
        ? (false as const)
        : (configInterval ?? 30_000)

  const me = useMe({ enabled, refetchInterval })
  const loginMutation = useLogin()
  const logoutMutation = useLogout()

  const login = makeCallable(loginMutation)
  const logout = makeCallable(logoutMutation)

  return {
    client,
    user: computed(() => (enabled.value ? (me.data.value ?? null) : null)),
    isLoading: computed(() => (enabled.value ? me.isLoading.value : false)),
    isAuthenticated: computed(() =>
      enabled.value ? !me.isError.value && me.data.value != null : false,
    ),
    error: computed(() => (enabled.value ? me.error.value : null)),
    refetch: me.refetch,
    login,
    logout,
  }
}
