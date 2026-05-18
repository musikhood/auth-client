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

  // /me strzelamy w 'protected' oraz 'guest-checking' (guest z onAuthenticated).
  // 'guest-passive' i null = nie strzelamy.
  const enabled = computed(
    () => (mode === 'protected' || mode === 'guest-checking') && !sessionExpired.value,
  )
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

  // sessionExpired = true: wymuszamy "wiemy że sesji nie ma" — bez tego boundary
  // tkwiłby w spinnerze gdy useMe został wyłączony w trakcie pending request.
  const sessionExpiredError = computed(() =>
    sessionExpired.value && !me.error.value ? new Error('Session expired') : null,
  )

  return {
    client,
    user: computed(() => (sessionExpired.value ? null : (me.data.value ?? null))),
    isLoading: computed(() =>
      sessionExpired.value ? false : enabled.value ? me.isLoading.value : false,
    ),
    isAuthenticated: computed(() =>
      sessionExpired.value
        ? false
        : enabled.value
          ? !me.isError.value && me.data.value != null
          : false,
    ),
    error: computed(() =>
      sessionExpired.value
        ? (me.error.value ?? sessionExpiredError.value)
        : enabled.value
          ? me.error.value
          : null,
    ),
    refetch: me.refetch,
    login,
    logout,
  }
}
