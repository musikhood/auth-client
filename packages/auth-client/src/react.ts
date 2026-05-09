// Publiczny entrypoint adaptera React. Importowany jako '@musikhood-dev/auth-client/react'.
//
// Jedyny hook to useAuth — daje user, login, logout (callable + stan mutation).
// Tryb chroniony aktywujesz przez <AuthBoundary>: wewnątrz useAuth() woła /me
// i polluje, poza nim user jest null bez żadnych requestów.
export { AuthProvider, type AuthProviderProps } from './react/AuthProvider.js'
export { AuthBoundary, type AuthBoundaryProps } from './react/AuthBoundary.js'
export { AuthGate, type AuthGateProps } from './react/AuthGate.js'
export { useAuth } from './react/useAuth.js'
export { ME_QUERY_KEY } from './react/context.js'
