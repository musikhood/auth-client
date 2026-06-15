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
  PanelAccessDeniedError,
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
  // Domyślnie po logout paczka redirectuje na loginPath (jeśli skonfigurowane).
  // `redirect: false` blokuje auto-redirect — przydatne gdy assertRoles chce
  // ręcznie redirectować na forbiddenPath zamiast loginPath.
  logout(options?: { redirect?: boolean }): Promise<LogoutResponse>
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

  // True jeśli ostatnia sesja umarła (logout / refresh fail). Adaptery używają tego
  // do disabledowania useMe — bez tego mielibyśmy pętlę refetch→401→refetch.
  // Reset na false dopiero przy nowym login().
  isSessionExpired(): boolean

  // True jeśli ostatnie /me zwróciło 403 (brak dostępu do TEGO panelu). Stan
  // terminalny i ODRĘBNY od isSessionExpired() — sesja żyje, cookies nietknięte.
  // Adaptery używają tego do zatrzymania pollingu i pokazania ekranu "brak
  // dostępu" / login bez zapętlania. Reset na false przy nowym login().
  isPanelAccessDenied(): boolean

  // Programatyczny redirect przez paczkę. Respektuje `config.redirect` override
  // oraz wbudowany pathname guard (nie redirectuje gdy już jesteś na docelowej ścieżce).
  // Adaptery (AuthBoundary) używają tego do redirectów na login/home/forbidden paths.
  redirectTo(path: string): void

  // Podstawia funkcję navigate po starcie — używane przez AuthProvider żeby
  // wpiąć React Router/Vue Router navigate (soft navigation) zamiast hard reload.
  // Konsument zwykle nie woła bezpośrednio — przekazuje `navigate` prop do AuthProvider.
  setRedirect(fn: ((path: string) => void) | null): void

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

  // Funkcja redirect — używana przez paczkę gdy potrzebuje przekierować usera
  // (na login, home, forbidden). Domyślnie `window.location.href` (hard reload).
  // Konsument może dostarczyć własną dwoma sposobami:
  //   - `config.redirect` w createAuthClient (znana od razu)
  //   - `setRedirect()` później (np. AuthProvider podstawia React Router navigate
  //     po mount — wtedy paczka robi soft navigation)
  // Wbudowany pathname guard: paczka nigdy nie redirectuje gdy już jesteś tutaj.
  let userRedirect = config.redirect
  const redirect = (path: string) => {
    if (typeof window === 'undefined') return
    if (window.location.pathname === path) return
    if (userRedirect) {
      userRedirect(path)
    } else {
      window.location.href = path
    }
  }

  // Tylko loginPath jest używany w core (do redirectów przy unauthorized/logout
  // z poziomu http interceptora i emittera). homePath/forbiddenPath są używane
  // przez adaptery (AuthBoundary) — czytają je z config.* bezpośrednio.
  const loginPath = config.loginPath

  // Panel-wide role gate — opcjonalny.
  // Validuje role usera po każdym /me. Brak ról → logout + redirect na
  // forbiddenPath + emit 'forbidden' z payloadem.
  const panelRoles = config.requireRoles ?? config.requireAnyRole
  const panelRolesMode: 'all' | 'any' = config.requireRoles ? 'all' : 'any'

  // Sprawdza role usera względem panel-wide guard. Zwraca true jeśli OK,
  // false jeśli brak (i wywołuje cleanup + redirect + emit).
  // Flaga zapobiega re-entry: cleanup woła logout() które wywołuje setUser(null)
  // (nie me()), więc race condition tu nie ma — ale dla bezpieczeństwa.
  let checkingRoles = false
  const enforcePanelRoles = async (user: AuthUser): Promise<boolean> => {
    if (!panelRoles || panelRoles.length === 0) return true
    if (checkingRoles) return true
    const userRoles = user.roles ?? []
    const ok =
      panelRolesMode === 'all'
        ? panelRoles.every((r) => userRoles.includes(r))
        : panelRoles.some((r) => userRoles.includes(r))
    if (ok) return true

    checkingRoles = true
    try {
      // Logout BEZ redirectu — chcemy sami trafić na forbiddenPath.
      try {
        await client.logout({ redirect: false })
      } catch {
        // ignorujemy, lokalny stan i tak wyzerowany przez setUser(null) w logout
      }
      emitter.emit('forbidden', {
        requiredRoles: panelRoles,
        userRoles,
        mode: panelRolesMode,
      })
      const target = config.forbiddenPath ?? loginPath
      if (target) redirect(target)
    } finally {
      checkingRoles = false
    }
    return false
  }

  const http = createHttp({
    baseUrl: config.baseUrl,
    emitter,
    onUnauthorized: loginPath ? () => redirect(loginPath) : undefined,
  })

  // Redirect na loginPath przy:
  //   - 'unauthorized' (refresh fail) — obsłużone przez http interceptor via onUnauthorized
  //   - 'logout' (jawne wylogowanie + cross-tab logout)
  // Flaga `suppressLogoutRedirect` pozwala wewnętrznym wywołaniom (assertRoles)
  // pominąć auto-redirect i podstawić własny target.
  let suppressLogoutRedirect = false
  if (loginPath) {
    emitter.on('logout', () => {
      if (suppressLogoutRedirect) return
      redirect(loginPath)
    })
  }

  // Cross-tab sync — opt-in. Listener tworzy nowy BroadcastChannel/storage listener.
  if (config.broadcastSession && typeof window !== 'undefined') {
    attachBroadcastSync(emitter)
  }

  let cachedUser: AuthUser | null = null
  // 'fresh': nigdy nie próbowaliśmy /me, useMe może strzelić.
  // 'expired': ostatnia sesja umarła (logout / refresh fail). useMe NIE strzela
  //            dopóki ktoś nie zawoła login() — bez tego pętla refetch→401→refetch.
  let sessionState: 'fresh' | 'expired' = 'fresh'

  // Osobny od sessionState: 403 z /me (brak dostępu do bieżącego panelu). Sesja
  // ŻYJE — to NIE jest wygaśnięcie. Adaptery wyłączają polling gdy true, żeby
  // 403 nie zapętlało /me. Reset przy login().
  let panelAccessDenied = false

  const setUser = (user: AuthUser | null) => {
    const changed =
      (cachedUser === null) !== (user === null) || (user && cachedUser?.id !== user.id)
    cachedUser = user
    if (changed) emitter.emit('user-changed', user)
  }

  emitter.on('unauthorized', () => {
    cachedUser = null
    sessionState = 'expired'
  })
  emitter.on('logout', () => {
    sessionState = 'expired'
  })
  emitter.on('login', () => {
    sessionState = 'fresh'
    // Nowy login = świeża próba dostępu do panelu. Czyścimy terminalny 403,
    // żeby po (ewentualnym) przelogowaniu /me mogło spróbować ponownie.
    panelAccessDenied = false
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
        return tokens
      } catch (err) {
        let mapped: Error = err instanceof Error ? err : new Error(String(err))
        if (isAxiosError(err)) {
          const status = err.response?.status
          const message =
            (err.response?.data as { error?: string } | undefined)?.error ?? err.message
          if (status === 401) mapped = new InvalidCredentialsError(message, err)
          else if (status === 403) mapped = new LoginForbiddenError(message, err)
        }
        emitter.emit('login-error', mapped)
        throw mapped
      }
    },

    async logout(options) {
      const skipRedirect = options?.redirect === false
      if (skipRedirect) suppressLogoutRedirect = true
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
        const mapped: Error = isAxiosError(err)
          ? new AuthError(err.message, err.response?.status, err)
          : err instanceof Error
            ? err
            : new Error(String(err))
        emitter.emit('logout-error', mapped)
        throw mapped
      } finally {
        suppressLogoutRedirect = false
      }
    },

    async me() {
      try {
        const user = await request<AuthUser>({ method: 'GET', url: ENDPOINTS.me })
        setUser(user)
        // Panel-wide role gate — sprawdzamy zaraz po /me. Jeśli user nie ma ról:
        // paczka go wylogowuje + redirectuje + emituje 'forbidden', a me()
        // RZUCA ForbiddenRoleError zamiast zwracać usera. Bez tego adaptery
        // dostawały usera, AuthBoundary widział `user != null` i odpalał
        // home-redirect równolegle z forbidden-redirectem — race condition.
        if (panelRoles && panelRoles.length > 0) {
          const ok = await enforcePanelRoles(user)
          if (!ok) {
            throw new ForbiddenRoleError(panelRoles, user.roles ?? [], panelRolesMode)
          }
        }
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
        if (isAxiosError(err) && err.response?.status === 403) {
          // 403 z /me = brak dostępu do BIEŻĄCEGO panelu. Sesja żyje — świadomie:
          //   - NIE robimy refresh (interceptor i tak ignoruje nie-401),
          //   - NIE emitujemy unauthorized/logout, NIE ruszamy sessionState,
          //   - NIE czyścimy cachedUser ani cookies, NIE broadcastujemy.
          // Ustawiamy terminalny flag + redirect na login (jeśli skonfigurowany),
          // żeby adaptery zatrzymały polling i pokazały "brak dostępu" bez pętli.
          const message =
            (err.response?.data as { error?: string } | undefined)?.error ??
            'No access to this panel'
          panelAccessDenied = true
          emitter.emit('panel-access-denied', undefined)
          if (loginPath) redirect(loginPath)
          throw new PanelAccessDeniedError(message, err)
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
        if (loginPath) redirect(loginPath)
        const mapped = new SessionExpiredError('Session expired', err)
        emitter.emit('refresh-error', mapped)
        throw mapped
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

      // Brak ról — czyścimy sesję (cookies + cache) BEZ auto-redirect, bo chcemy
      // sami wysłać usera na forbiddenPath (a domyślny logout redirect zaprowadziłby
      // go na loginPath, co jest mylące — user JEST zalogowany, tylko brak roli).
      try {
        await this.logout({ redirect: false })
      } catch {
        // Nawet jeśli logout się wysypie (np. sieć), event 'logout' poszedł,
        // cachedUser wyzerowany — wystarczy do bezpieczeństwa.
      }
      const target = config.forbiddenPath ?? loginPath
      if (target) redirect(target)
      throw new ForbiddenRoleError(roles, userRoles, mode)
    },

    isAuthenticated() {
      return cachedUser !== null
    },

    getCachedUser() {
      return cachedUser
    },

    isSessionExpired() {
      return sessionState === 'expired'
    },

    isPanelAccessDenied() {
      return panelAccessDenied
    },

    redirectTo(path: string) {
      redirect(path)
    },

    setRedirect(fn) {
      userRedirect = fn ?? undefined
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
