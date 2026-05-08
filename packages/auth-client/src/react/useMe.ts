import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'
import type { AuthUser } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './context.js'
import { SessionExpiredError } from '../core/errors.js'

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
      // Sesja wygasła = nie ma sensu retryować, idziemy od razu w error state.
      if (error instanceof SessionExpiredError) return false
      return failureCount < 1
    },
    ...options,
  })
}
