import { onScopeDispose } from 'vue'
import {
  useQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseQueryReturnType,
} from '@tanstack/vue-query'
import type { AuthUser } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './key.js'
import { isAuthErrorNamed } from '../core/errors.js'

export type UseMeOptions = Partial<
  Omit<UseQueryOptions<AuthUser, Error, AuthUser>, 'queryKey' | 'queryFn'>
>

export function useMe(options?: UseMeOptions): UseQueryReturnType<AuthUser, Error> {
  const client = useAuthClient()
  const queryClient = useQueryClient()

  // Spinamy eventy klienta z query cache, żeby logout/unauthorized natychmiast
  // zerowały dane bez czekania na kolejny refetch.
  const offUnauthorized = client.on('unauthorized', () => {
    queryClient.setQueryData(ME_QUERY_KEY, null)
  })
  const offLogout = client.on('logout', () => {
    queryClient.setQueryData(ME_QUERY_KEY, null)
  })
  const offLogin = client.on('login', () => {
    queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
  })
  onScopeDispose(() => {
    offUnauthorized()
    offLogout()
    offLogin()
  })

  return useQuery<AuthUser, Error, AuthUser>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => client.me(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      if (isAuthErrorNamed(error, 'SessionExpiredError')) return false
      if (isAuthErrorNamed(error, 'DeviceMismatchError')) return false
      // 403 brak dostępu do panelu — terminalny, NIE retryujemy (inaczej pętla 403).
      if (isAuthErrorNamed(error, 'PanelAccessDeniedError')) return false
      // 2FA (step-up / enrollment) — czeka na akcję usera, retry nic nie da.
      if (isAuthErrorNamed(error, 'MfaStepUpRequiredError')) return false
      if (isAuthErrorNamed(error, 'MfaEnrollmentRequiredError')) return false
      return failureCount < 1
    },
    ...options,
  })
}
