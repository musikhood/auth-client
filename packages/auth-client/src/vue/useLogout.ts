import { useMutation, useQueryClient, type UseMutationReturnType } from '@tanstack/vue-query'
import type { LogoutResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'

export function useLogout(): UseMutationReturnType<LogoutResponse, Error, void, unknown> {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  return useMutation<LogoutResponse, Error, void>({
    mutationFn: () => client.logout(),
    onSettled: () => {
      queryClient.clear()
    },
  })
}
