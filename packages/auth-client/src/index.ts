// Publiczny entrypoint core (framework-agnostic).
export { createAuthClient } from './core/client.js'
export type { AuthClient } from './core/client.js'
export { ENDPOINTS } from './core/http.js'
export { AUTH_CODES, DEVICE_FP_HEADER } from './core/http.js'
export {
  canonicalJson,
  collectDeviceComponents,
  createDeviceFingerprintProvider,
  hashComponents,
  normalizeComponents,
  parseUserAgent,
} from './core/device.js'
export type {
  DeviceComponents,
  DeviceFingerprint,
  DeviceFingerprintProvider,
} from './core/device.js'
export {
  AuthError,
  DeviceMismatchError,
  ForbiddenRoleError,
  InvalidCredentialsError,
  LoginForbiddenError,
  MfaAlreadyEnabledError,
  MfaEnrollmentRequiredError,
  MfaInvalidCodeError,
  MfaRequiredError,
  MfaStepUpRequiredError,
  MfaTokenExpiredError,
  PanelAccessDeniedError,
  SessionExpiredError,
  TooManyAttemptsError,
  isAuthErrorNamed,
} from './core/errors.js'
export type { MfaInvalidCodeReason } from './core/errors.js'
export type {
  AuthClientConfig,
  AuthUser,
  LoginCredentials,
  TokenResponse,
  LogoutResponse,
  AuthEvents,
  AuthEventName,
  AuthEventListener,
  MfaEnrollmentConfirmInput,
  MfaEnrollmentConfirmResult,
  MfaEnrollmentRequestInput,
  MfaEnrollmentRequiredPayload,
  MfaStage,
  MfaState,
  MfaStepUpInput,
  MfaVerifyInput,
} from './core/types.js'
