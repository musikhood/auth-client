import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { LogoutResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'

export function useLogout(): UseMutationResult<LogoutResponse, Error, void> {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  return useMutation<LogoutResponse, Error, void>({
    mutationFn: () => client.logout(),
    onSettled: () => {
      // Czyścimy cały cache — po logout dane innych query (PIM, i18n) i tak są nieważne
      // bo BEARER cookie zniknął i kolejne calle dostaną 401.
      queryClient.clear()
    },
  })
}
