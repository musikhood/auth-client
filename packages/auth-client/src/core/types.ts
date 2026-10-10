// Publiczne typy klienta auth.

export type AuthUser = {
  id: string
  email: string
  displayName: string | null
  roles: string[]
  disabled: boolean
  // Pola panelowe pojawiają się tylko gdy klient gada bezpośrednio z auth-server.
  // Mikroserwisy konsumenckie (przez paczkę bundle) zwracają subset bez tych pól.
  panelId?: string | null
  panelName?: string | null
  panelRoles?: string[]
}

export type LoginCredentials = {
  username: string
  password: string
}

// ---- 2FA (2.2.0) ----

export type MfaVerifyInput = {
  // mfa_token z MfaRequiredError
  mfaToken: string
  // 6-cyfrowy kod TOTP — albo recoveryCode
  code?: string
  // kod zapasowy xxxxx-xxxxx
  recoveryCode?: string
  // zapamiętaj urządzenie na 30 dni (wymaga fingerprintu — config.deviceFingerprint)
  rememberDevice?: boolean
}

export type MfaStepUpInput = {
  code?: string
  recoveryCode?: string
  rememberDevice?: boolean
}

// Stan 2FA trzymany w kliencie — adaptery (useMfa) renderują z niego UI.
//   idle       — nic nie wymaga 2FA,
//   code       — login czeka na kod (mfaToken z 401 mfa_required),
//   step-up    — sesja żyje, ale panel wymaga potwierdzenia kodem (403 mfa_step_up),
//   enrollment — panel wymaga 2FA, user musi je skonfigurować (enrollmentUrl).
export type MfaStage = 'idle' | 'code' | 'step-up' | 'enrollment'

export type MfaState = {
  stage: MfaStage
  mfaToken: string | null
  methods: string[]
  enrollmentUrl: string | null
}

// Link konfiguracji 2FA dla zalogowanego usera wymaga aktualnego hasła —
// sama sesja (ciasteczko) nie wystarcza.
export type MfaEnrollmentRequestInput = {
  password: string
}

// Potwierdzenie konfiguracji 2FA (strona /setup-2fa) — autoryzacja wyłącznie
// enrollment_token z linku.
export type MfaEnrollmentConfirmInput = {
  enrollmentToken: string
  // pierwszy 6-cyfrowy kod z aplikacji
  code: string
}

// Wynik potwierdzenia. `session` = auth-server od razu zalogował usera z 2FA
// (link z loginu / requestMfaEnrollment przez auth-client): cookies ustawione,
// event 'login' wyemitowany. null = link wydany backend-clientowi (bundle) albo
// stary auth-server — user loguje się ponownie na swoim panelu.
export type MfaEnrollmentConfirmResult = {
  recoveryCodes: string[]
  returnUrl: string
  session: TokenResponse | null
}

// 403 `mfa_enrollment_required` z bramki per-request NIE niesie linku (null):
// UI prosi o hasło i woła requestMfaEnrollment({ password }). Link jest tylko
// w MfaEnrollmentRequiredError z loginu (hasło właśnie zweryfikowane).
export type MfaEnrollmentRequiredPayload = {
  enrollmentUrl: string | null
}

export type TokenResponse = {
  token: string
  refresh_token: string
  refresh_token_expiration: number
  token_expiration: number
}

// Backend zwraca różne kształty (`{message: "Logged out."}` lub puste body / pustą tablicę).
// Klient i tak nie używa treści — czyści lokalny stan i emituje event niezależnie od body.
export type LogoutResponse = unknown

export type AuthClientConfig = {
  baseUrl: string

  // Ścieżka strony logowania. Paczka redirectuje tu gdy:
  //   - refresh failed (sesja wygasła),
  //   - jawny logout (lokalnie lub cross-tab),
  //   - assertRoles fail.
  // Wbudowany pathname guard — paczka nie redirectuje gdy już jesteś tutaj.
  loginPath?: string

  // Ścieżka strony głównej (default '/'). Paczka redirectuje tu gdy zalogowany user
  // trafia na trasę publiczną (<AuthBoundary mode="guest">).
  homePath?: string

  // Ścieżka redirectu przy braku wymaganych ról (<AuthBoundary requireRoles>
  // lub panel-wide requireRoles/requireAnyRole z configu). Default: loginPath.
  forbiddenPath?: string

  // Panel-wide role gate. Jeśli ustawione, paczka po KAŻDYM udanym `client.me()`
  // sprawdza czy user ma wymagane role. Brak → logout + redirect na forbiddenPath
  // + emit 'forbidden' event. Używane dla paneli admin-only gdzie cały panel
  // wymaga konkretnej roli.
  //
  // Mutually exclusive z requireAnyRole.
  requireRoles?: string[] // wszystkie role wymagane (AND)
  requireAnyRole?: string[] // przynajmniej jedna (OR)

  // Override sposobu nawigacji. Default: `window.location.href = path` (hard reload).
  // Dla SPA z client-side router możesz podać `(path) => navigate(path)`.
  // Uwaga: callback NIE robi pathname guard — paczka woła go tylko gdy redirect
  // faktycznie potrzebny.
  redirect?: (path: string) => void

  // Co ile ms `useAuth()` w trybie chronionym odświeża /me. Default: 30_000.
  // `false` wyłącza polling.
  meRefetchInterval?: number | false

  // Cross-tab synchronizacja sesji: logout w jednym tab → wszystkie inne się wylogowują,
  // login w jednym tab → wszystkie inne odświeżają /me.
  // Używa BroadcastChannel (z fallbackiem do storage event).
  // Default: false (opt-in).
  broadcastSession?: boolean

  // Fingerprint urządzenia (2FA / wiązanie sesji). Default: true.
  //   - nagłówek `X-Device-Fp` (SHA-256 komponentów) na każdym requeście,
  //   - `device` (komponenty) w body loginu, refreshu, verifyMfa i stepUpMfa.
  // Wymaga, by backend (CORS) dopuszczał nagłówek `X-Device-Fp`. SSR / brak
  // WebCrypto → brak fingerprintu (requesty idą jak w 2.1).
  deviceFingerprint?: boolean

  // Niewykorzystane wewnętrznie (klient używa axios), trzymane dla zgodności.
  fetch?: typeof fetch
}

// Payload eventu 'forbidden' — emitowany gdy panel-wide requireRoles/requireAnyRole
// wykryje brak ról. Konsument może użyć tego do pokazania toastu lub komunikatu
// na ekranie loginu po redirectcie.
export type ForbiddenPayload = {
  requiredRoles: string[]
  userRoles: string[]
  mode: 'all' | 'any'
}

export type AuthEvents = {
  unauthorized: void
  logout: void
  'user-changed': AuthUser | null
  login: AuthUser | TokenResponse
  forbidden: ForbiddenPayload
  // 403 z /me — brak dostępu do BIEŻĄCEGO panelu. Stan terminalny, ODRĘBNY od
  // unauthorized/logout: sesja żyje, cookies nietknięte, NIE broadcastujemy do
  // innych zakładek. Adaptery używają tego do zatrzymania pollingu i pokazania
  // ekranu "brak dostępu" / login bez zapętlania.
  'panel-access-denied': void
  // 2FA (2.2.0):
  //  - 'mfa-required'            — login czeka na kod (stan 'code'),
  //  - 'mfa-step-up-required'    — 403 mfa_step_up: pokaż modal z kodem (bez redirectu na login),
  //  - 'mfa-enrollment-required' — 403 mfa_enrollment_required: przekieruj na enrollmentUrl,
  //  - 'mfa-state-changed'       — każda zmiana MfaState (dla adapterów).
  'mfa-required': MfaState
  'mfa-step-up-required': void
  'mfa-enrollment-required': MfaEnrollmentRequiredPayload
  'mfa-state-changed': MfaState
  // Error eventy — emitowane gdy odpowiednia metoda (login/logout/refresh) rzuca.
  // Konsument może podłączyć listener i np. pokazać toast bez try/catch w komponencie.
  // Uwaga: błąd JEST nadal rzucany z metody — eventy to dodatkowa droga, nie zastępują.
  'login-error': Error
  'logout-error': Error
  'refresh-error': Error
}

export type AuthEventName = keyof AuthEvents

export type AuthEventListener<E extends AuthEventName> = (payload: AuthEvents[E]) => void
