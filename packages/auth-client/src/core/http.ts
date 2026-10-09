import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { AuthEmitter } from './events.js'
import type { TokenResponse } from './types.js'
import { DeviceMismatchError, SessionExpiredError } from './errors.js'
import type { DeviceFingerprintProvider } from './device.js'

// Endpointy są kontraktem między frontendem a auth-serverem / paczką backendową.
// Trzymamy je w jednym miejscu, gdyby kiedyś trzeba było je nadpisać.
export const ENDPOINTS = {
  login: '/api/login',
  logout: '/api/logout',
  refresh: '/api/token/refresh',
  me: '/api/v1/user/me',
  // 2FA (2.2.0)
  loginMfa: '/api/login/mfa',
  sessionMfa: '/api/session/mfa',
  mfaEnrollmentRequest: '/api/mfa/enrollment/request',
  mfaEnrollmentConfirm: '/api/mfa/enrollment/confirm',
} as const

export const DEVICE_FP_HEADER = 'X-Device-Fp'

// Kody z body odpowiedzi auth-servera (pole `code`, obok niezmienionego `error`).
export const AUTH_CODES = {
  invalidCredentials: 'invalid_credentials',
  accountDisabled: 'account_disabled',
  panelAccessDenied: 'panel_access_denied',
  tooManyAttempts: 'too_many_attempts',
  mfaRequired: 'mfa_required',
  mfaInvalidCode: 'mfa_invalid_code',
  // poprawny kod, ale jego krok czasowy był już użyty — poczekaj na następny
  mfaCodeReused: 'mfa_code_reused',
  mfaTokenExpired: 'mfa_token_expired',
  mfaEnrollmentRequired: 'mfa_enrollment_required',
  mfaAlreadyEnabled: 'mfa_already_enabled',
  mfaStepUp: 'mfa_step_up',
  deviceMismatch: 'device_mismatch',
  deviceMismatchRecheck: 'device_mismatch_recheck',
} as const

// 401-ki, które NIE oznaczają wygasłego access tokena — nie odpalamy na nich refreshu.
const NON_REFRESHABLE_401_CODES: ReadonlySet<string> = new Set([
  AUTH_CODES.invalidCredentials,
  AUTH_CODES.mfaRequired,
  AUTH_CODES.mfaInvalidCode,
  AUTH_CODES.mfaCodeReused,
  AUTH_CODES.mfaTokenExpired,
  AUTH_CODES.deviceMismatch,
])

// Endpointy auth, na których 401 to wynik biznesowy (złe dane / kod), nie wygasła sesja.
// `/api/session/mfa` celowo NIE jest tu — wygasły BEARER przy step-upie ma przejść
// zwykły refresh + retry; zły kod rozpoznajemy po `code` (mfa_invalid_code).
const NON_REFRESHABLE_PATHS = [
  ENDPOINTS.login,
  ENDPOINTS.refresh,
  ENDPOINTS.loginMfa,
  ENDPOINTS.mfaEnrollmentConfirm,
]

export type ErrorBody = {
  error?: string
  code?: string
  mfa_token?: string
  methods?: string[]
  enrollment_url?: string
  [key: string]: unknown
}

export function errorBody(error: unknown): ErrorBody {
  if (!axios.isAxiosError(error)) return {}
  const data = error.response?.data
  return data && typeof data === 'object' ? (data as ErrorBody) : {}
}

export function retryAfterSeconds(error: unknown): number | null {
  if (!axios.isAxiosError(error)) return null
  const raw = error.response?.headers?.['retry-after'] as unknown
  const value =
    typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(value) && value >= 0 ? value : null
}

// Wewnętrzny flag dla configów, które już raz przeszły przez retry.
// Bez tego mielibyśmy nieskończoną pętlę gdy refresh sam zwróci 401.
type RetriableConfig = InternalAxiosRequestConfig & { _authRetried?: boolean }

export type HttpDeps = {
  baseUrl: string
  emitter: AuthEmitter
  onUnauthorized?: () => void
  // 2FA (2.2.0) — opcjonalne, brak = zachowanie 2.1.
  device?: DeviceFingerprintProvider | null
  onMfaStepUp?: () => void
  onMfaEnrollment?: (enrollmentUrl: string | null) => void
}

// Body + nagłówek dla wywołań refreshu (świeża instancja axios, bez interceptorów).
export async function refreshPayload(
  device: DeviceFingerprintProvider | null | undefined,
): Promise<{ body: Record<string, unknown>; headers: Record<string, string> }> {
  const fp = device ? await device.get() : null
  if (!fp) return { body: {}, headers: {} }
  return { body: { device: fp.components }, headers: { [DEVICE_FP_HEADER]: fp.hash } }
}

export function createHttp({
  baseUrl,
  emitter,
  onUnauthorized,
  device,
  onMfaStepUp,
  onMfaEnrollment,
}: HttpDeps): AxiosInstance {
  const instance = axios.create({
    baseURL: baseUrl,
    withCredentials: true,
    headers: { Accept: 'application/json' },
  })

  if (device) {
    instance.interceptors.request.use(async (rc) => {
      const fp = await device.get()
      if (fp) rc.headers.set(DEVICE_FP_HEADER, fp.hash)
      return rc
    })
  }

  // Pojedynczy in-flight refresh — żeby N równoległych 401-ek odpaliło JEDEN refresh,
  // a nie N. Wszystkie czekają na to samo Promise.
  let inflightRefresh: Promise<void> | null = null

  const triggerRefresh = (): Promise<void> => {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      try {
        const { body, headers } = await refreshPayload(device)
        // Świeża instancja axios bez interceptorów — refresh nie może wpaść w pętlę.
        await axios.post<TokenResponse>(ENDPOINTS.refresh, body, {
          baseURL: baseUrl,
          withCredentials: true,
          headers,
        })
      } finally {
        inflightRefresh = null
      }
    })()
    return inflightRefresh
  }

  const sessionDead = (cause: unknown): Error => {
    emitter.emit('unauthorized', undefined)
    emitter.emit('user-changed', null)
    onUnauthorized?.()
    return errorBody(cause).code === AUTH_CODES.deviceMismatch
      ? new DeviceMismatchError('Session revoked: device mismatch', cause)
      : new SessionExpiredError('Session expired', cause)
  }

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as RetriableConfig | undefined
      const status = error.response?.status
      const code = errorBody(error).code

      // 403 z kodem 2FA: sesja ŻYJE — nie refreshujemy, nie wylogowujemy, tylko
      // sygnalizujemy (modal step-up / redirect na enrollment). Błąd przechodzi dalej
      // bez zmian (AxiosError), więc istniejąca obsługa 403 u konsumenta działa jak w 2.1.
      if (status === 403 && code === AUTH_CODES.mfaStepUp) {
        onMfaStepUp?.()
        return Promise.reject(error)
      }
      if (status === 403 && code === AUTH_CODES.mfaEnrollmentRequired) {
        const url = errorBody(error).enrollment_url
        onMfaEnrollment?.(typeof url === 'string' ? url : null)
        return Promise.reject(error)
      }

      // TYLKO 401 odpala refresh. 403 (brak dostępu do panelu) świadomie
      // przechodzi tędy nietknięte — NIE refreshujemy, mapowanie na terminalny
      // PanelAccessDeniedError robi client.me().
      if (status !== 401 || !original) {
        return Promise.reject(error)
      }

      // 401 z loginu / kroków 2FA = złe dane albo zły kod, NIE odpalamy refreshu.
      // `device_mismatch_recheck` (fingerprint ≠ token) celowo IDZIE dalej — refresh
      // wykona pełny scoring urządzenia po stronie serwera.
      const url = original.url ?? ''
      if (NON_REFRESHABLE_PATHS.some((p) => url.endsWith(p))) {
        return Promise.reject(error)
      }
      if (code !== undefined && NON_REFRESHABLE_401_CODES.has(code)) {
        return Promise.reject(error)
      }

      if (original._authRetried) {
        // Druga 401 po retry → sesja faktycznie martwa.
        return Promise.reject(sessionDead(error))
      }

      original._authRetried = true

      try {
        await triggerRefresh()
      } catch (refreshErr) {
        return Promise.reject(sessionDead(refreshErr))
      }

      return instance.request(original)
    },
  )

  return instance
}

export type RequestConfig = AxiosRequestConfig
