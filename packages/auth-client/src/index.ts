// Publiczny entrypoint core (framework-agnostic).
export { createAuthClient } from './core/client.js'
export type { AuthClient } from './core/client.js'
export { ENDPOINTS } from './core/http.js'
export {
  AuthError,
  InvalidCredentialsError,
  LoginForbiddenError,
  SessionExpiredError,
} from './core/errors.js'
export type {
  AuthClientConfig,
  AuthUser,
  LoginCredentials,
  TokenResponse,
  LogoutResponse,
  AuthEvents,
  AuthEventName,
  AuthEventListener,
} from './core/types.js'
