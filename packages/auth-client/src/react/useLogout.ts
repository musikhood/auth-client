import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import type { LogoutResponse } from '../core/types.js'
import { useAuthClient } from './useAuthClient.js'
import { ME_QUERY_KEY } from './context.js'

export function useLogout(): UseMutationResult<LogoutResponse, Error, void> {
  const client = useAuthClient()
  const queryClient = useQueryClient()
  return useMutation<LogoutResponse, Error, void>({
    mutationFn: () => client.logout(),
    onSettled: () => {
      // Usuwamy TYLKO query /me — nie ruszamy reszty cache konsumenta.
      // Każdy panel sam decyduje co zrobić z własnymi queries po logout
      // (przez listener `client.on('logout', ...)` lub własną logikę).
      // Brutalne queryClient.clear() generowało wave 401-ek z aktywnych observerów.
      queryClient.removeQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}
