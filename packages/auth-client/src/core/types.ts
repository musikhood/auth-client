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
  onUnauthorized?: () => void
  // Niewykorzystane wewnętrznie (klient używa axios), trzymane dla zgodności
  // z wcześniejszą wersją kontraktu i ewentualnym przyszłym przełączeniem na fetch.
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
