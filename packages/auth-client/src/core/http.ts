import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { AuthEmitter } from './events.js'
import type { TokenResponse } from './types.js'
import { SessionExpiredError } from './errors.js'

// Endpointy są kontraktem między frontendem a auth-serverem / paczką backendową.
// Trzymamy je w jednym miejscu, gdyby kiedyś trzeba było je nadpisać.
export const ENDPOINTS = {
  login: '/api/login',
  logout: '/api/logout',
  refresh: '/api/token/refresh',
  me: '/api/v1/user/me',
} as const

// Wewnętrzny flag dla configów, które już raz przeszły przez retry.
// Bez tego mielibyśmy nieskończoną pętlę gdy refresh sam zwróci 401.
type RetriableConfig = InternalAxiosRequestConfig & { _authRetried?: boolean }

export type HttpDeps = {
  baseUrl: string
  emitter: AuthEmitter
  onUnauthorized?: () => void
}

export function createHttp({ baseUrl, emitter, onUnauthorized }: HttpDeps): AxiosInstance {
  const instance = axios.create({
    baseURL: baseUrl,
    withCredentials: true,
    headers: { Accept: 'application/json' },
  })

  // Pojedynczy in-flight refresh — żeby N równoległych 401-ek odpaliło JEDEN refresh,
  // a nie N. Wszystkie czekają na to samo Promise.
  let inflightRefresh: Promise<void> | null = null

  const triggerRefresh = (): Promise<void> => {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      try {
        // Świeża instancja axios bez interceptorów — refresh nie może wpaść w pętlę.
        await axios.post<TokenResponse>(
          ENDPOINTS.refresh,
          {},
          { baseURL: baseUrl, withCredentials: true },
        )
      } finally {
        inflightRefresh = null
      }
    })()
    return inflightRefresh
  }

  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const original = error.config as RetriableConfig | undefined
      const status = error.response?.status

      if (status !== 401 || !original) {
        return Promise.reject(error)
      }

      // Login 401 = bad creds, NIE odpalamy refreshu.
      const url = original.url ?? ''
      if (url.endsWith(ENDPOINTS.login) || url.endsWith(ENDPOINTS.refresh)) {
        return Promise.reject(error)
      }

      if (original._authRetried) {
        // Druga 401 po retry → sesja faktycznie martwa.
        emitter.emit('unauthorized', undefined)
        emitter.emit('user-changed', null)
        onUnauthorized?.()
        return Promise.reject(new SessionExpiredError('Session expired', error))
      }

      original._authRetried = true

      try {
        await triggerRefresh()
      } catch (refreshErr) {
        emitter.emit('unauthorized', undefined)
        emitter.emit('user-changed', null)
        onUnauthorized?.()
        return Promise.reject(new SessionExpiredError('Session expired', refreshErr))
      }

      return instance.request(original)
    },
  )

  return instance
}

export type RequestConfig = AxiosRequestConfig
