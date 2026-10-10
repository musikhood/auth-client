import type { AxiosInstance } from 'axios'
import axios, { isAxiosError } from 'axios'
import { createAuthEmitter, type AuthEmitter } from './events.js'
import { attachBroadcastSync } from './broadcast.js'
import {
  AUTH_CODES,
  createHttp,
  ENDPOINTS,
  errorBody,
  refreshPayload,
  retryAfterSeconds,
  type RequestConfig,
} from './http.js'
import { createDeviceFingerprintProvider, type DeviceFingerprintProvider } from './device.js'
import {
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
} from './errors.js'
import type {
  AuthClientConfig,
  AuthEventListener,
  AuthEventName,
  AuthEvents,
  AuthUser,
  LoginCredentials,
  LogoutResponse,
  MfaEnrollmentConfirmInput,
  MfaEnrollmentConfirmResult,
  MfaEnrollmentRequestInput,
  MfaState,
  MfaStepUpInput,
  MfaVerifyInput,
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

  // ---- 2FA (2.2.0) ----
  // Drugi krok logowania po MfaRequiredError. Sukces = jak udany login() (cookies,
  // event 'login'). Błędy: MfaInvalidCodeError (można ponowić), MfaTokenExpiredError
  // (zacznij od nowa), TooManyAttemptsError, LoginForbiddenError.
  verifyMfa(input: MfaVerifyInput): Promise<TokenResponse>
  // Step-up bieżącej sesji (po 403 mfa_step_up). Sukces = nowe cookies + event 'login'.
  stepUpMfa(input: MfaStepUpInput): Promise<TokenResponse>
  // Link do konfiguracji 2FA dla zalogowanego usera — wymaga aktualnego hasła.
  // Błędy: InvalidCredentialsError (złe hasło), MfaAlreadyEnabledError (409),
  // TooManyAttemptsError (429).
  requestMfaEnrollment(input: MfaEnrollmentRequestInput): Promise<string>
  // Przekierowuje (pełna nawigacja) na stronę konfiguracji 2FA: podany URL albo URL
  // ze stanu (MfaEnrollmentRequiredError z loginu). Bez URL rzuca — wtedy najpierw
  // requestMfaEnrollment({ password }).
  startMfaEnrollment(url?: string): Promise<void>
  // Potwierdza konfigurację 2FA pierwszym kodem (strona /setup-2fa), wysyła fingerprint
  // urządzenia. Gdy auth-server od razu zaloguje usera (session != null) — cookies
  // ustawione + event 'login' (odświeżenie /me). Błędy: MfaInvalidCodeError (reason
  // 'invalid' | 'reused'), MfaTokenExpiredError, MfaAlreadyEnabledError, TooManyAttemptsError.
  confirmMfaEnrollment(input: MfaEnrollmentConfirmInput): Promise<MfaEnrollmentConfirmResult>
  getMfaState(): MfaState
  isMfaStepUpRequired(): boolean
  resetMfa(): void
  // Fingerprint urządzenia (null gdy wyłączony / SSR). Do własnych wywołań backendu.
  readonly device: DeviceFingerprintProvider | null

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

  // Fingerprint urządzenia — default ON, wyłączany `deviceFingerprint: false`.
  // SSR (brak window) → null, requesty idą bez nagłówka / pola device.
  const device: DeviceFingerprintProvider | null =
    config.deviceFingerprint !== false && typeof window !== 'undefined'
      ? createDeviceFingerprintProvider()
      : null

  const IDLE_MFA: MfaState = { stage: 'idle', mfaToken: null, methods: [], enrollmentUrl: null }
  let mfaState: MfaState = IDLE_MFA
  const setMfaState = (next: MfaState) => {
    mfaState = next
    emitter.emit('mfa-state-changed', next)
  }

  const http = createHttp({
    baseUrl: config.baseUrl,
    emitter,
    onUnauthorized: loginPath ? () => redirect(loginPath) : undefined,
    device,
    // 403 mfa_step_up z dowolnego requestu: sesja żyje, panel wymaga kodu. Event
    // tylko przy przejściu w stan step-up (bez zalewania modalami przy N requestach).
    onMfaStepUp: () => {
      if (mfaState.stage === 'step-up') return
      setMfaState({ ...IDLE_MFA, stage: 'step-up' })
      emitter.emit('mfa-step-up-required', undefined)
    },
    onMfaEnrollment: (enrollmentUrl) => {
      if (mfaState.stage === 'enrollment' && mfaState.enrollmentUrl === enrollmentUrl) return
      setMfaState({ ...IDLE_MFA, stage: 'enrollment', enrollmentUrl })
      emitter.emit('mfa-enrollment-required', { enrollmentUrl })
    },
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

  // A dead session ends any pending 2FA stage (step-up / enrollment / code) —
  // otherwise global MFA dialogs stay open over the login page until reload.
  // Also covers cross-tab logout / unauthorized (broadcast re-emits these events).
  // 403 mfa_step_up / mfa_enrollment_required do NOT emit these events.
  const resetMfa = () => {
    if (mfaState.stage !== 'idle') setMfaState(IDLE_MFA)
  }

  emitter.on('unauthorized', () => {
    cachedUser = null
    sessionState = 'expired'
    resetMfa()
  })
  emitter.on('logout', () => {
    sessionState = 'expired'
    resetMfa()
  })
  emitter.on('login', () => {
    // Udany login / verifyMfa / stepUpMfa (także z innej zakładki) kończy każdy etap 2FA.
    if (mfaState.stage !== 'idle') setMfaState(IDLE_MFA)
    sessionState = 'fresh'
    // Nowy login = świeża próba dostępu do panelu. Czyścimy terminalny 403,
    // żeby po (ewentualnym) przelogowaniu /me mogło spróbować ponownie.
    panelAccessDenied = false
  })

  const request = async <T>(rc: RequestConfig): Promise<T> => {
    const res = await http.request<T>(rc)
    return res.data
  }

  const withDevice = async <T extends Record<string, unknown>>(
    body: T,
  ): Promise<T & { device?: unknown }> => {
    const fp = device ? await device.get() : null
    return fp ? { ...body, device: fp.components } : body
  }

  // Wspólne mapowanie błędów kroków 2FA (verifyMfa / stepUpMfa).
  const mapMfaError = (err: unknown): Error => {
    if (!isAxiosError(err)) return err instanceof Error ? err : new Error(String(err))
    const status = err.response?.status
    const body = errorBody(err)
    const message = body.error ?? err.message
    if (status === 429) return new TooManyAttemptsError(retryAfterSeconds(err), message, err)
    if (body.code === AUTH_CODES.mfaInvalidCode) return new MfaInvalidCodeError(message, err)
    if (body.code === AUTH_CODES.mfaCodeReused)
      return new MfaInvalidCodeError(message, err, 'reused')
    if (body.code === AUTH_CODES.mfaAlreadyEnabled) return new MfaAlreadyEnabledError(message, err)
    if (body.code === AUTH_CODES.mfaTokenExpired) return new MfaTokenExpiredError(message, err)
    if (status === 403) return new LoginForbiddenError(message, err)
    if (status === 401) return new SessionExpiredError(message, err)
    return new AuthError(message, status, err)
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
          data: await withDevice({ ...credentials }),
        })
        emitter.emit('login', tokens)
        return tokens
      } catch (err) {
        let mapped: Error = err instanceof Error ? err : new Error(String(err))
        if (isAxiosError(err)) {
          const status = err.response?.status
          const body = errorBody(err)
          const message = body.error ?? err.message
          if (
            status === 401 &&
            body.code === AUTH_CODES.mfaRequired &&
            typeof body.mfa_token === 'string'
          ) {
            const methods = Array.isArray(body.methods)
              ? body.methods.filter((m): m is string => typeof m === 'string')
              : []
            mapped = new MfaRequiredError(body.mfa_token, methods, message, err)
            setMfaState({ ...IDLE_MFA, stage: 'code', mfaToken: body.mfa_token, methods })
            emitter.emit('mfa-required', mfaState)
          } else if (status === 403 && body.code === AUTH_CODES.mfaEnrollmentRequired) {
            const url = typeof body.enrollment_url === 'string' ? body.enrollment_url : null
            mapped = new MfaEnrollmentRequiredError(url, message, err)
            setMfaState({ ...IDLE_MFA, stage: 'enrollment', enrollmentUrl: url })
          } else if (status === 429)
            mapped = new TooManyAttemptsError(retryAfterSeconds(err), message, err)
          else if (status === 401) mapped = new InvalidCredentialsError(message, err)
          else if (status === 403) mapped = new LoginForbiddenError(message, err)
        }
        emitter.emit('login-error', mapped)
        throw mapped
      }
    },

    async verifyMfa(input) {
      try {
        const tokens = await request<TokenResponse>({
          method: 'POST',
          url: ENDPOINTS.loginMfa,
          data: await withDevice({
            mfa_token: input.mfaToken,
            code: input.code,
            recovery_code: input.recoveryCode,
            remember_device: input.rememberDevice === true,
          }),
        })
        emitter.emit('login', tokens)
        return tokens
      } catch (err) {
        const mapped = mapMfaError(err)
        // Wygasły / zużyty token albo blokada konta → wracamy do formularza hasła.
        if (mapped instanceof MfaTokenExpiredError || mapped instanceof LoginForbiddenError) {
          setMfaState(IDLE_MFA)
        }
        emitter.emit('login-error', mapped)
        throw mapped
      }
    },

    async stepUpMfa(input) {
      try {
        const tokens = await request<TokenResponse>({
          method: 'POST',
          url: ENDPOINTS.sessionMfa,
          data: await withDevice({
            code: input.code,
            recovery_code: input.recoveryCode,
            remember_device: input.rememberDevice === true,
          }),
        })
        emitter.emit('login', tokens)
        return tokens
      } catch (err) {
        const mapped = err instanceof SessionExpiredError ? err : mapMfaError(err)
        emitter.emit('login-error', mapped)
        throw mapped
      }
    },

    async requestMfaEnrollment(input) {
      try {
        const res = await request<{ enrollment_url: string }>({
          method: 'POST',
          url: ENDPOINTS.mfaEnrollmentRequest,
          data: { password: input.password },
        })
        return res.enrollment_url
      } catch (err) {
        if (!isAxiosError(err)) throw err
        const status = err.response?.status
        const body = errorBody(err)
        const message = body.error ?? err.message
        if (status === 429) throw new TooManyAttemptsError(retryAfterSeconds(err), message, err)
        if (body.code === AUTH_CODES.mfaAlreadyEnabled)
          throw new MfaAlreadyEnabledError(message, err)
        if (body.code === AUTH_CODES.invalidCredentials)
          throw new InvalidCredentialsError(message, err)
        throw new AuthError(message, status, err)
      }
    },

    async confirmMfaEnrollment(input) {
      try {
        const res = await request<
          Partial<TokenResponse> & { recovery_codes: string[]; return_url: string }
        >({
          method: 'POST',
          url: ENDPOINTS.mfaEnrollmentConfirm,
          data: await withDevice({ enrollment_token: input.enrollmentToken, code: input.code }),
        })
        const session: TokenResponse | null =
          typeof res.token === 'string' && typeof res.refresh_token === 'string'
            ? {
                token: res.token,
                refresh_token: res.refresh_token,
                refresh_token_expiration: res.refresh_token_expiration ?? 0,
                token_expiration: res.token_expiration ?? 0,
              }
            : null
        if (session) {
          setMfaState(IDLE_MFA)
          emitter.emit('login', session)
        }
        return { recoveryCodes: res.recovery_codes, returnUrl: res.return_url, session }
      } catch (err) {
        throw mapMfaError(err)
      }
    },

    async startMfaEnrollment(url) {
      const target = url ?? mfaState.enrollmentUrl
      if (!target) {
        throw new AuthError('No enrollment URL — call requestMfaEnrollment({ password }) first')
      }
      if (typeof window !== 'undefined') window.location.assign(target)
    },

    getMfaState() {
      return mfaState
    },

    isMfaStepUpRequired() {
      return mfaState.stage === 'step-up'
    },

    resetMfa() {
      resetMfa()
    },

    device,

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
          const body = errorBody(err)
          // 403 z kodem 2FA: sesja ŻYJE, to nie jest brak dostępu do panelu. Bez
          // redirectu na login i bez terminalnego panelAccessDenied — interceptor
          // już ustawił stan 2FA i wyemitował event (modal step-up / enrollment).
          if (body.code === AUTH_CODES.mfaStepUp) {
            throw new MfaStepUpRequiredError(body.error ?? 'Two-factor verification required', err)
          }
          if (body.code === AUTH_CODES.mfaEnrollmentRequired) {
            throw new MfaEnrollmentRequiredError(
              typeof body.enrollment_url === 'string' ? body.enrollment_url : null,
              body.error ?? 'Two-factor authentication setup required',
              err,
            )
          }
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
        const { body, headers } = await refreshPayload(device)
        const res = await axios.post<TokenResponse>(ENDPOINTS.refresh, body, {
          baseURL: config.baseUrl,
          withCredentials: true,
          headers,
        })
        return res.data
      } catch (err) {
        emitter.emit('unauthorized', undefined)
        emitter.emit('user-changed', null)
        if (loginPath) redirect(loginPath)
        const mapped =
          errorBody(err).code === AUTH_CODES.deviceMismatch
            ? new DeviceMismatchError('Session revoked: device mismatch', err)
            : new SessionExpiredError('Session expired', err)
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
