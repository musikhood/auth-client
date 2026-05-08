import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { LoginCredentials, TokenResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './context.js'

export function useLogin(): UseMutationResult<TokenResponse, Error, LoginCredentials> {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  return useMutation<TokenResponse, Error, LoginCredentials>({
    mutationFn: (credentials) => client.login(credentials),
    onSuccess: () => {
      // Cookie BEARER ustawione przez przeglądarkę — invalidate triggeruje świeże /me.
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}
