// Klasy błędów rzucane przez klienta. Konsument może je rozpoznawać przez instanceof.

export class AuthError extends Error {
  override name = 'AuthError'
  readonly status?: number
  override readonly cause?: unknown
  constructor(message: string, status?: number, cause?: unknown) {
    super(message)
    this.status = status
    this.cause = cause
  }
}

// 401 z /api/login — złe dane logowania. Nie odpala interceptora refreshu.
export class InvalidCredentialsError extends AuthError {
  override name = 'InvalidCredentialsError'
  constructor(message = 'Invalid credentials', cause?: unknown) {
    super(message, 401, cause)
  }
}

// 403 z /api/login — konto wyłączone albo brak dostępu do panelu.
export class LoginForbiddenError extends AuthError {
  override name = 'LoginForbiddenError'
  constructor(message: string, cause?: unknown) {
    super(message, 403, cause)
  }
}

// Refresh ostatecznie się nie udał — wymaga re-loginu.
export class SessionExpiredError extends AuthError {
  override name = 'SessionExpiredError'
  constructor(message = 'Session expired', cause?: unknown) {
    super(message, 401, cause)
  }
}

// 403 z /me — sesja jest WAŻNA, ale user nie ma dostępu do TEGO panelu.
// Stan terminalny: NIE robimy refresh, NIE czyścimy cookies, NIE emitujemy
// unauthorized/logout, NIE broadcastujemy do innych zakładek. Te same ciasteczka
// SSO zostają ważne na panelach, do których user MA dostęp. Konsument pokazuje
// ekran "brak dostępu" / login bez zapętlania.
//
// Świadomie ODRĘBNY od SessionExpiredError (401 = martwa sesja → globalne
// wylogowanie) — to dwa różne kontrakty.
export class PanelAccessDeniedError extends AuthError {
  override name = 'PanelAccessDeniedError'
  constructor(message = 'No access to this panel', cause?: unknown) {
    super(message, 403, cause)
  }
}

// Rzucany przez client.assertRoles() gdy user nie ma wymaganych ról.
// assertRoles() automatycznie wywołuje logout() PRZED rzuceniem — sesja jest
// czyszczona zanim konsument zobaczy ten błąd.
export class ForbiddenRoleError extends AuthError {
  override name = 'ForbiddenRoleError'
  readonly requiredRoles: string[]
  readonly userRoles: string[]
  readonly mode: 'all' | 'any'
  constructor(requiredRoles: string[], userRoles: string[], mode: 'all' | 'any') {
    const reqText = mode === 'all' ? requiredRoles.join(' + ') : requiredRoles.join(' OR ')
    super(`Missing required role(s): ${reqText}`, 403)
    this.requiredRoles = requiredRoles
    this.userRoles = userRoles
    this.mode = mode
  }
}

// ---- 2FA / device binding (2.2.0) ----------------------------------------
// Rozpoznawane po polu `code` z body odpowiedzi auth-servera. Gdy backend nie
// zwraca `code` (stary serwer), zachowanie jest identyczne jak w 2.1.

// 401 `mfa_required` z loginu — hasło OK, potrzebny kod 2FA. Dokończ przez
// `client.verifyMfa({ mfaToken, code })`. Podklasa InvalidCredentialsError, żeby
// stary kod łapiący InvalidCredentialsError nadal działał (fail-closed).
export class MfaRequiredError extends InvalidCredentialsError {
  override name = 'MfaRequiredError'
  readonly mfaToken: string
  readonly methods: string[]
  constructor(
    mfaToken: string,
    methods: string[],
    message = 'Two-factor authentication required',
    cause?: unknown,
  ) {
    super(message, cause)
    this.mfaToken = mfaToken
    this.methods = methods
  }
}

// 403 `mfa_enrollment_required` — panel wymaga 2FA, user go nie ma. Z loginu niesie
// `enrollmentUrl` (`client.startMfaEnrollment(url)`); z /me (bramka per request)
// `enrollmentUrl` jest null — trzeba poprosić o hasło (requestMfaEnrollment).
export class MfaEnrollmentRequiredError extends LoginForbiddenError {
  override name = 'MfaEnrollmentRequiredError'
  readonly enrollmentUrl: string | null
  constructor(
    enrollmentUrl: string | null,
    message = 'Two-factor authentication setup required',
    cause?: unknown,
  ) {
    super(message, cause)
    this.enrollmentUrl = enrollmentUrl
  }
}

// 403 `mfa_step_up` — sesja żyje, ale ten panel wymaga potwierdzenia kodem 2FA
// (`client.stepUpMfa({ code })`). NIE jest wylogowaniem, NIE redirectujemy na login.
export class MfaStepUpRequiredError extends AuthError {
  override name = 'MfaStepUpRequiredError'
  constructor(message = 'Two-factor verification required', cause?: unknown) {
    super(message, 403, cause)
  }
}

// 401 `mfa_invalid_code` — zły kod TOTP / zapasowy. Można spróbować ponownie.
// reason 'reused' = 401 `mfa_code_reused`: kod poprawny, ale już użyty (ten sam
// krok czasowy) — UI prosi o następny kod z aplikacji.
export type MfaInvalidCodeReason = 'invalid' | 'reused'

export class MfaInvalidCodeError extends AuthError {
  override name = 'MfaInvalidCodeError'
  readonly reason: MfaInvalidCodeReason
  constructor(
    message = 'Invalid verification code',
    cause?: unknown,
    reason: MfaInvalidCodeReason = 'invalid',
  ) {
    super(message, 401, cause)
    this.reason = reason
  }
}

// 401 `mfa_token_expired` — mfa_token / enrollment_token wygasł, został zużyty
// albo przekroczono limit prób. Trzeba zacząć logowanie od nowa.
export class MfaTokenExpiredError extends AuthError {
  override name = 'MfaTokenExpiredError'
  constructor(message = 'Verification session expired', cause?: unknown) {
    super(message, 401, cause)
  }
}

// 409 `mfa_already_enabled` — requestMfaEnrollment() dla usera, który ma już 2FA.
export class MfaAlreadyEnabledError extends AuthError {
  override name = 'MfaAlreadyEnabledError'
  constructor(message = 'Two-factor authentication is already enabled', cause?: unknown) {
    super(message, 409, cause)
  }
}

// 429 `too_many_attempts` — `retryAfter` w sekundach (nagłówek Retry-After) albo null.
export class TooManyAttemptsError extends AuthError {
  override name = 'TooManyAttemptsError'
  readonly retryAfter: number | null
  constructor(retryAfter: number | null, message = 'Too many attempts', cause?: unknown) {
    super(message, 429, cause)
    this.retryAfter = retryAfter
  }
}

// Refresh odrzucony z `device_mismatch` — sesja związana z innym urządzeniem
// została unieważniona. Zachowanie jak wygaśnięcie sesji (podklasa SessionExpiredError).
export class DeviceMismatchError extends SessionExpiredError {
  override name = 'DeviceMismatchError'
  constructor(message = 'Session revoked: device mismatch', cause?: unknown) {
    super(message, cause)
  }
}

// Adaptery (`/react`, `/vue`) są osobnymi entry bundla — każdy ma własną kopię
// klas błędów, więc `instanceof` na błędzie rzuconym przez klienta z głównego
// entry bywa fałszywy. Porównujemy po polu `name` (literał, odporny na minifikację).
export function isAuthErrorNamed(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name
}
