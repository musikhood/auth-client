// Publiczny entrypoint adaptera Vue 3. Importowany jako '@musikhood-dev/auth-client/vue'.
export { createAuth, type AuthPlugin } from './vue/plugin.js'
export { useAuthClient } from './vue/useAuthClient.js'
export { useMe, type UseMeOptions } from './vue/useMe.js'
export { useLogin } from './vue/useLogin.js'
export { useLogout } from './vue/useLogout.js'
export { useAuth } from './vue/useAuth.js'
export { AuthGate, renderAuthGate } from './vue/AuthGate.js'
export { AUTH_CLIENT_KEY, ME_QUERY_KEY } from './vue/key.js'
