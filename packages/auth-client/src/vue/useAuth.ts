import { computed, inject, onScopeDispose, ref } from 'vue'
import type { UseMutationReturnType } from '@tanstack/vue-query'
import { useAuthClient } from './useAuthClient.js'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { AUTH_PROTECTED_KEY, type AuthProtectedMode } from './key.js'
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

// modeOverride: używane przez AuthBoundary, który zna swój tryb z propsa i NIE
// może go odczytać z własnego inject() — w Vue provide() nie jest widoczne dla
// inject() w tym samym setupie (tylko dla potomków). Konsumenci w slotach
// boundary wołają useAuth() bez argumentu i czytają tryb przez inject normalnie.
export function useAuth(modeOverride?: AuthProtectedMode) {
  const client = useAuthClient()
  // null poza boundary, 'protected' / 'guest-checking' wewnątrz.
  const mode = modeOverride ?? inject(AUTH_PROTECTED_KEY, null)

  // Reactive flag — re-renderuje gdy session umiera/wraca.
  // Bez tego useMe pollowałby na ślepo po logout (pętla refetch → 401).
  const sessionExpired = ref(client.isSessionExpired())
  const updateExpired = () => {
    sessionExpired.value = client.isSessionExpired()
  }
  // Odrębny terminalny flag: 403 brak dostępu do panelu (sesja żyje).
  const panelAccessDenied = ref(client.isPanelAccessDenied())
  const updatePanelDenied = () => {
    panelAccessDenied.value = client.isPanelAccessDenied()
  }
  const offLogin = client.on('login', () => {
    updateExpired()
    updatePanelDenied() // login resetuje 403 w core
  })
  const offLogout = client.on('logout', updateExpired)
  const offUnauthorized = client.on('unauthorized', updateExpired)
  const offPanelDenied = client.on('panel-access-denied', updatePanelDenied)
  onScopeDispose(() => {
    offLogin()
    offLogout()
    offUnauthorized()
    offPanelDenied()
  })

  // /me strzelamy w 'protected' oraz 'guest-checking'. null = nie strzelamy.
  // 403 (panelAccessDenied) wyłącza /me — terminalnie, bez pętli.
  const enabled = computed(
    () =>
      (mode === 'protected' || mode === 'guest-checking') &&
      !sessionExpired.value &&
      !panelAccessDenied.value,
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
  // panelAccessDenied analogicznie: terminalny stan z user=null, isLoading=false.
  const panelDeniedError = computed(() =>
    panelAccessDenied.value && !me.error.value ? new Error('No access to this panel') : null,
  )

  // Stan terminalny (sesja martwa albo brak dostępu do panelu) — w obu user=null,
  // isLoading=false, /me wyłączone. Różnica jest semantyczna (401 vs 403) i już
  // obsłużona w core (czyszczenie cookies vs nie) — tu adapter tylko nie zapętla.
  const terminal = computed(() => sessionExpired.value || panelAccessDenied.value)

  return {
    client,
    user: computed(() => (terminal.value ? null : (me.data.value ?? null))),
    isLoading: computed(() =>
      terminal.value ? false : enabled.value ? me.isLoading.value : false,
    ),
    isAuthenticated: computed(() =>
      terminal.value ? false : enabled.value ? !me.isError.value && me.data.value != null : false,
    ),
    error: computed(() =>
      terminal.value
        ? (me.error.value ?? sessionExpiredError.value ?? panelDeniedError.value)
        : enabled.value
          ? me.error.value
          : null,
    ),
    refetch: me.refetch,
    login,
    logout,
  }
}
