import { useMutation, useQueryClient, type UseMutationReturnType } from '@tanstack/vue-query'
import type { LoginCredentials, TokenResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './key.js'

export function useLogin(): UseMutationReturnType<TokenResponse, Error, LoginCredentials, unknown> {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  return useMutation<TokenResponse, Error, LoginCredentials>({
    mutationFn: (credentials) => client.login(credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}
