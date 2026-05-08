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
