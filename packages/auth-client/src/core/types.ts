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

  // Callback wywoływany gdy refresh ostatecznie się nie udał.
  // Pełna kontrola, ale konsument musi sam zabezpieczyć się przed pętlą redirect
  // (np. sprawdzić `window.location.pathname !== '/login'`).
  onUnauthorized?: () => void

  // Łatwiejsza alternatywa dla `onUnauthorized`: paczka sama robi redirect
  // i wbudowany guard pathname (nie przeładuje gdy już jesteś na docelowej ścieżce).
  // Jeśli ustawione, `onUnauthorized` jest ignorowane.
  unauthorizedRedirect?: string

  // Co ile ms `useMe()` w trybie chronionym odświeża /me.
  // Default: 30_000. `false` wyłącza polling całkowicie.
  meRefetchInterval?: number | false

  // Cross-tab synchronizacja sesji: logout w jednym tab → wszystkie inne się wylogowują,
  // login w jednym tab → wszystkie inne odświeżają /me.
  // Używa BroadcastChannel (z fallbackiem do storage event dla starszych przeglądarek).
  // Default: false (opt-in).
  broadcastSession?: boolean

  // Niewykorzystane wewnętrznie (klient używa axios), trzymane dla zgodności.
  fetch?: typeof fetch
}

export type AuthEvents = {
  unauthorized: void
  logout: void
  'user-changed': AuthUser | null
  login: AuthUser | TokenResponse
}

export type AuthEventName = keyof AuthEvents

export type AuthEventListener<E extends AuthEventName> = (payload: AuthEvents[E]) => void
