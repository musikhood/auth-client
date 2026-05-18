import type { AxiosInstance } from 'axios'
import axios, { isAxiosError } from 'axios'
import { createAuthEmitter, type AuthEmitter } from './events.js'
import { attachBroadcastSync } from './broadcast.js'
import { createHttp, ENDPOINTS, type RequestConfig } from './http.js'
import {
  AuthError,
  ForbiddenRoleError,
  InvalidCredentialsError,
  LoginForbiddenError,
  SessionExpiredError,
} from './errors.js'
import type {
  AuthClientConfig,
  AuthEventListener,
  AuthEventName,
  AuthEvents,
  AuthUser,
  LoginCredentials,
  LogoutResponse,
  TokenResponse,
} from './types.js'

export type AuthClient = {
  readonly config: Readonly<AuthClientConfig>
  readonly http: AxiosInstance

  request<T = unknown>(config: RequestConfig): Promise<T>
  get<T = unknown>(url: string, config?: RequestConfig): Promise<T>
  post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T>
  put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T>
  patch<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T>
  delete<T = unknown>(url: string, config?: RequestConfig): Promise<T>

  login(credentials: LoginCredentials): Promise<TokenResponse>
  logout(): Promise<LogoutResponse>
  me(): Promise<AuthUser>
  refresh(): Promise<TokenResponse>

  // Sprawdza czy zalogowany user ma wymagane role. Jeśli nie — woła logout()
  // i rzuca ForbiddenRoleError. Typowy wzorzec: `await login(); await assertRoles([...]);`
  // Mode "all" (default): user musi mieć WSZYSTKIE wymienione role.
  // Mode "any": user musi mieć przynajmniej JEDNĄ.
  assertRoles(roles: string[], mode?: 'all' | 'any'): Promise<AuthUser>

  // Sync helper — true gdy ostatnie wywołanie me() się powiodło i nie było potem
  // logoutu / unauthorized. Nie odpala żadnego HTTP, czyta tylko cache w pamięci.
  isAuthenticated(): boolean
  getCachedUser(): AuthUser | null

  on<E extends AuthEventName>(event: E, handler: AuthEventListener<E>): () => void
  off<E extends AuthEventName>(event: E, handler: AuthEventListener<E>): void

  // Wewnętrzny — używany przez adaptery (React/Vue) do podłączania pod query cache.
  readonly emitter: AuthEmitter
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  if (!config.baseUrl) {
    throw new Error('createAuthClient: baseUrl jest wymagany')
  }

  const emitter = createAuthEmitter()

  // Jeśli konsument podał `unauthorizedRedirect`, paczka sama robi redirect
  // z wbudowanym pathname guardem (nie przeładuje gdy już jesteś na docelowej ścieżce).
  // `onUnauthorized` callback ma pierwszeństwo dla advanced cases.
  const resolvedOnUnauthorized: (() => void) | undefined =
    config.onUnauthorized ??
    (config.unauthorizedRedirect
      ? () => {
          if (typeof window === 'undefined') return
          if (window.location.pathname === config.unauthorizedRedirect) return
          window.location.href = config.unauthorizedRedirect!
        }
      : undefined)

  const http = createHttp({
    baseUrl: config.baseUrl,
    emitter,
    onUnauthorized: resolvedOnUnauthorized,
  })

  // Cross-tab sync — opt-in. Listener tworzy nowy BroadcastChannel/storage listener.
  // Konsument może odpiąć ręcznie przez `client._detachBroadcast?.()` (zarezerwowane
  // dla testów). W praktyce żyje przez całą sesję.
  if (config.broadcastSession && typeof window !== 'undefined') {
    attachBroadcastSync(emitter)
  }

  let cachedUser: AuthUser | null = null

  const setUser = (user: AuthUser | null) => {
    const changed =
      (cachedUser === null) !== (user === null) || (user && cachedUser?.id !== user.id)
    cachedUser = user
    if (changed) emitter.emit('user-changed', user)
  }

  emitter.on('unauthorized', () => {
    cachedUser = null
  })

  const request = async <T>(rc: RequestConfig): Promise<T> => {
    const res = await http.request<T>(rc)
    return res.data
  }

  const client: AuthClient = {
    config: Object.freeze({ ...config }),
    http,
    emitter,

    request,
    get: (url, rc) => request({ ...rc, method: 'GET', url }),
    post: (url, data, rc) => request({ ...rc, method: 'POST', url, data }),
    put: (url, data, rc) => request({ ...rc, method: 'PUT', url, data }),
    patch: (url, data, rc) => request({ ...rc, method: 'PATCH', url, data }),
    delete: (url, rc) => request({ ...rc, method: 'DELETE', url }),

    async login(credentials) {
      try {
        const tokens = await request<TokenResponse>({
          method: 'POST',
          url: ENDPOINTS.login,
          data: credentials,
        })
        emitter.emit('login', tokens)
        // Cache /me unieważnia się po stronie adapterów (przez event lub query invalidate).
        return tokens
      } catch (err) {
        if (isAxiosError(err)) {
          const status = err.response?.status
          const message =
            (err.response?.data as { error?: string } | undefined)?.error ?? err.message
          if (status === 401) throw new InvalidCredentialsError(message, err)
          if (status === 403) throw new LoginForbiddenError(message, err)
        }
        throw err
      }
    },

    async logout() {
      try {
        const res = await request<LogoutResponse>({
          method: 'POST',
          url: ENDPOINTS.logout,
        })
        setUser(null)
        emitter.emit('logout', undefined)
        return res
      } catch (err) {
        // Logout jest idempotentny po stronie backendu — nawet gdyby coś się wysypało,
        // czyścimy lokalny stan, żeby UI nie został w pół-zalogowany.
        setUser(null)
        emitter.emit('logout', undefined)
        if (isAxiosError(err)) {
          throw new AuthError(err.message, err.response?.status, err)
        }
        throw err
      }
    },

    async me() {
      try {
        const user = await request<AuthUser>({ method: 'GET', url: ENDPOINTS.me })
        setUser(user)
        return user
      } catch (err) {
        // Po nieudanym refresh interceptor już rzucił SessionExpiredError i wyemitował
        // unauthorized — tu tylko propagujemy, cache wyczyszczony przez listener.
        if (err instanceof SessionExpiredError) throw err
        if (isAxiosError(err) && err.response?.status === 401) {
          // 401 z /me bez ważnego refresh → traktujemy jako brak sesji.
          setUser(null)
          throw new SessionExpiredError('Not authenticated', err)
        }
        throw err
      }
    },

    async refresh() {
      // Manualny refresh — używa świeżej instancji axios żeby ominąć interceptor.
      try {
        const res = await axios.post<TokenResponse>(
          ENDPOINTS.refresh,
          {},
          { baseURL: config.baseUrl, withCredentials: true },
        )
        return res.data
      } catch (err) {
        emitter.emit('unauthorized', undefined)
        emitter.emit('user-changed', null)
        resolvedOnUnauthorized?.()
        throw new SessionExpiredError('Session expired', err)
      }
    },

    async assertRoles(roles: string[], mode: 'all' | 'any' = 'all') {
      // Świeże /me — nie ufamy cache, bo assertRoles to security gate.
      const user = await this.me()
      const userRoles = user.roles ?? []
      const ok =
        mode === 'all'
          ? roles.every((r) => userRoles.includes(r))
          : roles.some((r) => userRoles.includes(r))
      if (ok) return user

      // Brak ról — czyścimy sesję (cookies + cache), żeby konsument nie miał
      // "pół-zalogowanego" stanu po którym jeszcze pozwolimy klikać.
      try {
        await this.logout()
      } catch {
        // Nawet jeśli logout się wysypie (np. sieć), event 'logout' poszedł,
        // cachedUser wyzerowany — wystarczy do bezpieczeństwa.
      }
      throw new ForbiddenRoleError(roles, userRoles, mode)
    },

    isAuthenticated() {
      return cachedUser !== null
    },

    getCachedUser() {
      return cachedUser
    },

    on(event, handler) {
      emitter.on(event, handler)
      return () => emitter.off(event, handler)
    },

    off(event, handler) {
      emitter.off(event, handler)
    },
  }

  return client
}

export type { AuthEvents }
