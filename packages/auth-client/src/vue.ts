// Publiczny entrypoint adaptera Vue 3. Importowany jako '@musikhood-dev/auth-client/vue'.
//
// Jedyny composable to useAuth — daje user, login, logout (callable + stan mutation).
// Tryb chroniony aktywujesz przez <AuthBoundary>: wewnątrz useAuth() woła /me
// i polluje, poza nim user jest null bez żadnych requestów.
export { createAuth, type AuthPlugin } from './vue/plugin.js'
export { AuthBoundary } from './vue/AuthBoundary.js'
export { AuthGate, renderAuthGate } from './vue/AuthGate.js'
export { useAuth } from './vue/useAuth.js'
export { AUTH_CLIENT_KEY, ME_QUERY_KEY } from './vue/key.js'
