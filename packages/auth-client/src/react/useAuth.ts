import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'
import { useAuthClient } from './useAuthClient.js'

// Wygodna agregacja — najczęstszy sposób używania paczki w komponencie.
export function useAuth() {
  const client = useAuthClient()
  const meQuery = useMe()
  const login = useLogin()
  const logout = useLogout()

  return {
    client,
    user: meQuery.data ?? null,
    isLoading: meQuery.isLoading,
    isAuthenticated: !meQuery.isError && meQuery.data != null,
    error: meQuery.error,
    refetch: meQuery.refetch,
    login,
    logout,
  }
}
