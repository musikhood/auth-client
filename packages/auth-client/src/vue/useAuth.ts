import { computed } from 'vue'
import { useAuthClient } from './useAuthClient.js'
import { useMe } from './useMe.js'
import { useLogin } from './useLogin.js'
import { useLogout } from './useLogout.js'

export function useAuth() {
  const client = useAuthClient()
  const me = useMe()
  const login = useLogin()
  const logout = useLogout()

  return {
    client,
    user: computed(() => me.data.value ?? null),
    isLoading: computed(() => me.isLoading.value),
    isAuthenticated: computed(() => !me.isError.value && me.data.value != null),
    error: computed(() => me.error.value),
    refetch: me.refetch,
    login,
    logout,
  }
}
