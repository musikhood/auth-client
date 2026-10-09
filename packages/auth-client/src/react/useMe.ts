import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import type { AuthUser } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './context.js'
import { isAuthErrorNamed } from '../core/errors.js'

export type UseMeOptions = Omit<
  UseQueryOptions<AuthUser, Error, AuthUser, typeof ME_QUERY_KEY>,
  'queryKey' | 'queryFn'
>

export function useMe(options?: UseMeOptions): UseQueryResult<AuthUser, Error> {
  const client = useAuthClient()
  return useQuery<AuthUser, Error, AuthUser, typeof ME_QUERY_KEY>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => client.me(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      // Stany terminalne — nie retryujemy, paczka już zrobiła cleanup + redirect.
      if (isAuthErrorNamed(error, 'SessionExpiredError')) return false
      if (isAuthErrorNamed(error, 'DeviceMismatchError')) return false
      if (isAuthErrorNamed(error, 'ForbiddenRoleError')) return false
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
