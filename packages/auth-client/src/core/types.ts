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
  // Error eventy — emitowane gdy odpowiednia metoda (login/logout/refresh) rzuca.
  // Konsument może podłączyć listener i np. pokazać toast bez try/catch w komponencie.
  // Uwaga: błąd JEST nadal rzucany z metody — eventy to dodatkowa droga, nie zastępują.
  'login-error': Error
  'logout-error': Error
  'refresh-error': Error
}

export type AuthEventName = keyof AuthEvents

export type AuthEventListener<E extends AuthEventName> = (payload: AuthEvents[E]) => void
