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
import { SessionExpiredError } from '../core/errors.js'

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
      if (error instanceof SessionExpiredError) return false
      return failureCount < 1
    },
    ...options,
  })
}
