# @musikhood-dev/auth-client

[![npm](https://img.shields.io/npm/v/@musikhood-dev/auth-client.svg)](https://www.npmjs.com/package/@musikhood-dev/auth-client)
[![license](https://img.shields.io/npm/l/@musikhood-dev/auth-client.svg)](./LICENSE)

Wspólny klient auth dla frontendów React i Vue 3 (logowanie, refresh, 2FA, role).

## Quick start (5 minut)

Nowy panel frontendowy podpięty pod auth — od zera do logowania z 2FA:

1. **Admin** tworzy panel w auth-panelu (Origin frontu, polityka 2FA `off` / `optional` / `required`) i nadaje
   userom dostęp.
2. **Backend** panelu: bundle — patrz
   [musikhood/auth-client-bundle INTEGRATION.md](https://github.com/musikhood/auth-client-bundle/blob/main/INTEGRATION.md)
   (checklista integracji).
3. **Front** — instalacja:

   ```bash
   npm i @musikhood-dev/auth-client @tanstack/react-query   # Vue: @tanstack/vue-query
   ```

4. Generator (offline, działa z prywatnego rejestru; `--dry-run` pokazuje plan bez zapisu):

   ```bash
   npx @musikhood-dev/auth-client init
   ```

   Tworzy `lib/auth.ts`, `lib/mfa.ts`, komponenty 2FA, formularz / stronę logowania i `VITE_API_BASE_URL=`
   w `.env.example`. Istniejących plików nie rusza (`--force` nadpisuje).

5. Dwie linie w roocie — React Router 7 (`app/root.tsx`, w `App()` z `useNavigate`):

   ```tsx
   <AuthProvider client={authClient} navigate={(path) => navigate(path, { replace: true })}>
     <Outlet />
     <AuthMfaDialogs />
   </AuthProvider>
   ```

   Vue 3: `app.use(VueQueryPlugin)` + `app.use(createAuth(authClient))` w `main.ts` i `<AuthMfaDialogs />`
   w `App.vue`. Pełny kod (z importami) wypisuje `init` na końcu.

6. `.env`: `VITE_API_BASE_URL=https://api.example.com`.
7. React Router 7: zarejestruj `/login` w `app/routes.ts` — `route('login', './routes/login/login.tsx')`
   (jeśli `init` to zgłosi). Trasy chronione owiń w `<AuthBoundary>` (np. w layoucie).
8. `npm run dev` → logowanie hasłem, krok kodu 2FA, step-up i wymuszona konfiguracja 2FA działają.

## Jak działa

- `lib/auth.ts` tworzy **jednego** klienta (`createAuthClient`). Tokeny są tylko w ciasteczkach HttpOnly;
  401 → automatyczny refresh i retry; `broadcastSession` synchronizuje logout / login między kartami.
- `<AuthProvider>` podpina klienta (i nawigację routera) do Reacta; w Vue robi to plugin `createAuth`.
- `<AuthBoundary>` sam przekierowuje: niezalogowany → `loginPath`, zalogowany na `/login` → `homePath`.
- 2FA to stan klienta (`useMfa().stage`): login z 401 `mfa_required` → `code` (formularz kodu w
  `LoginForm`), 403 `mfa_step_up` z dowolnego requestu → `step-up`, 403 `mfa_enrollment_required` →
  `enrollment` (dialogi z `<AuthMfaDialogs />` — hasło → strona konfiguracji 2FA na auth-serverze).
- Błędy pokazywane inline (złe hasło, kod, limit prób) są pomijane przez globalny listener `login-error` w
  `lib/auth.ts`; resztę dostaje `reportAuthError` — tam podpinasz toast aplikacji.
- Wygenerowane pliki są **twoje** — edytuj je dowolnie; paczka nie wymaga ich do działania.

## Co daje paczka

- **Konfiguracja przez ścieżki**: `loginPath`, `homePath`, `forbiddenPath`. Paczka sama redirectuje.
- **Jeden hook**: `useAuth()` daje `user`, `login`, `logout`.
- **Jeden komponent**: `<AuthBoundary>` dla tras chronionych i publicznych.
- **Cookies-only**: BEARER + refresh_token (HttpOnly). Nic w localStorage.
- **Auto-refresh**: 401 → `/api/token/refresh` → retry. Single-flight lock.
- **Cross-tab sync** (opt-in): logout / login propagują się między tabami.
- **Role-based access**: `requireRoles` / `requireAnyRole` na `<AuthBoundary>` + `client.assertRoles()`.

## Instalacja

Najszybciej: [Quick start](#quick-start-5-minut) (`npx @musikhood-dev/auth-client init`). Ręcznie:

```bash
npm i @musikhood-dev/auth-client
# adapter React:
npm i @tanstack/react-query
# adapter Vue:
npm i @tanstack/vue-query
```

## Minimum

```ts
// lib/auth.ts — raz, na całą aplikację
import { createAuthClient } from '@musikhood-dev/auth-client'

export const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  loginPath: '/login', // gdzie odsyłać niezalogowanych
  homePath: '/', // gdzie odsyłać zalogowanych z /login
  broadcastSession: true, // (opcjonalne) sync logout/login między tabami
})
```

To **wszystko** co konsument konfiguruje. Wszystkie redirecty paczka robi sama. Nie pisz żadnego `navigate('/login')` w komponentach.

## Architektura w 30 sekund

```
<AuthProvider client={authClient}>          ← raz, w roocie
  <Route path="/login">
    <AuthBoundary mode="guest">             ← publiczna: zalogowany → homePath
      <LoginPage />
    </AuthBoundary>
  </Route>

  <Route path="/*">
    <AuthBoundary>                          ← chroniona: niezalogowany → loginPath
      <App />
    </AuthBoundary>
  </Route>

  <Route path="/admin">
    <AuthBoundary requireRoles={['ROLE_ADMIN']}>  ← chroniona + role
      <AdminPanel />
    </AuthBoundary>
  </Route>
</AuthProvider>
```

W komponencie:

```ts
const { user, login, logout } = useAuth()
```

## React — pełny przykład

```tsx
// lib/auth.ts
import { createAuthClient } from '@musikhood-dev/auth-client'

export const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  loginPath: '/login',
  homePath: '/',
  broadcastSession: true,
})

// App.tsx
import { AuthProvider, AuthBoundary, useAuth } from '@musikhood-dev/auth-client/react'
import { Routes, Route, useNavigate } from 'react-router'
import { authClient } from './lib/auth'

export function App() {
  // (opcjonalnie) navigate prop — paczka używa go zamiast window.location.href.
  // Soft navigation = brak hard reloadu = toasty przeżywają redirect.
  const navigate = useNavigate()
  return (
    <AuthProvider client={authClient} navigate={(path) => navigate(path, { replace: true })}>
      <Routes>
        <Route
          path="/login"
          element={
            <AuthBoundary mode="guest" fallback={<Spinner />}>
              <LoginPage />
            </AuthBoundary>
          }
        />
        <Route
          path="/*"
          element={
            <AuthBoundary fallback={<Spinner />}>
              <Dashboard />
            </AuthBoundary>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

function LoginPage() {
  const { login } = useAuth()
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        await login({
          username: form.get('username') as string,
          password: form.get('password') as string,
        })
        // Brak navigate — AuthBoundary mode="guest" sam zauważy że user pojawił się
        // i przekieruje na homePath.
      }}
    >
      <input name="username" />
      <input name="password" type="password" />
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? 'Loguję…' : 'Zaloguj'}
      </button>
    </form>
  )
}

function Dashboard() {
  const { user, logout } = useAuth()
  return (
    <>
      <p>Witaj, {user?.displayName ?? user?.email}</p>
      <button onClick={() => logout()}>Wyloguj</button>
      {/* Po logout: paczka redirectuje na loginPath. Bez navigate w komponencie. */}
    </>
  )
}
```

## Vue 3 — pełny przykład

```ts
// main.ts
import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient } from '@musikhood-dev/auth-client'
import { createAuth } from '@musikhood-dev/auth-client/vue'
import { createRouter } from 'vue-router'
import App from './App.vue'

const router = createRouter({
  /* ... */
})

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  loginPath: '/login',
  homePath: '/',
  broadcastSession: true,
})

const app = createApp(App)
app.use(VueQueryPlugin) // wymagane przed createAuth
app.use(router)
// (opcjonalnie) navigate — paczka używa go zamiast window.location.href.
app.use(createAuth(authClient, { navigate: (path) => router.push(path) }))
app.mount('#app')
```

```vue
<!-- LoginView.vue -->
<script setup lang="ts">
import { AuthBoundary, useAuth } from '@musikhood-dev/auth-client/vue'
const { login } = useAuth()
</script>

<template>
  <AuthBoundary mode="guest">
    <template #fallback><Spinner /></template>
    <template #default>
      <form @submit.prevent="login({ username, password })">
        <input v-model="username" />
        <input v-model="password" type="password" />
        <button :disabled="login.isPending.value">Zaloguj</button>
      </form>
    </template>
  </AuthBoundary>
</template>
```

```vue
<!-- AppView.vue -->
<script setup lang="ts">
import { AuthBoundary, useAuth } from '@musikhood-dev/auth-client/vue'
const { user, logout } = useAuth()
</script>

<template>
  <AuthBoundary>
    <template #fallback><Spinner /></template>
    <template #default>
      <p>Witaj, {{ user?.displayName ?? user?.email }}</p>
      <button @click="logout()">Wyloguj</button>
    </template>
  </AuthBoundary>
</template>
```

## `createAuthClient` — config

```ts
createAuthClient({
  baseUrl: string,                       // wymagane

  loginPath?: string,                    // gdzie redirectować niezalogowanych
                                         // (refresh fail, logout, cross-tab logout, assertRoles fail)

  homePath?: string,                     // default '/' — gdzie redirectować zalogowanych
                                         // z trasy publicznej (<AuthBoundary mode="guest">)

  forbiddenPath?: string,                // default = loginPath — gdzie redirectować
                                         // przy braku wymaganych ról (requireRoles)

  redirect?: (path: string) => void,     // override sposobu nawigacji.
                                         // Default: window.location.href = path (hard reload)

  meRefetchInterval?: number | false,    // ms, default 30_000. false = bez pollingu

  broadcastSession?: boolean,            // default false. Cross-tab sync logout/login.

  // Panel-wide role gate. Po każdym /me paczka sprawdza role. Brak → logout +
  // redirect na forbiddenPath + emit 'forbidden'. Dla paneli admin-only.
  requireRoles?: string[],               // user musi mieć WSZYSTKIE (AND)
  requireAnyRole?: string[],             // user musi mieć PRZYNAJMNIEJ JEDNĄ (OR)

  deviceFingerprint?: boolean,           // default true (2.2+). Nagłówek X-Device-Fp + `device`
                                         // w loginie / refreshu / 2FA. Backend MUSI dopuszczać
                                         // X-Device-Fp w CORS (allow_headers).
})
```

### Panel-wide role gate vs route-level

Masz dwa miejsca gdzie możesz wymusić role, do różnych use case'ów:

| Gdzie                                | Kiedy używać                                                               | Co robi przy braku roli                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createAuthClient({ requireRoles })` | **Cały panel** wymaga roli (np. auth-panel — tylko ROLE_ADMIN)             | logout + redirect na forbiddenPath + emit `'forbidden'`                                                |
| `<AuthBoundary requireRoles>`        | **Niektóre route'y** w panelu wymagają roli (np. pim_frontend `/settings`) | redirect na forbiddenPath (bez logout — user pozostaje zalogowany, tylko nie ma dostępu do tej sekcji) |

Dla panelu admin-only (auth-panel):

```ts
createAuthClient({
  baseUrl,
  loginPath: '/login',
  requireRoles: ['ROLE_ADMIN'],
})

// Po wpisaniu hasła przez usera bez ROLE_ADMIN:
//   1. /api/login 200 (backend nie sprawdza ról przy login)
//   2. /me 200, dostaje user z ['ROLE_USER']
//   3. Paczka wykrywa brak ROLE_ADMIN → logout({redirect:false}) + redirect('/login') + emit 'forbidden'
//   4. User wraca na /login, BEZ sesji
//   5. Konsument może nasłuchiwać 'forbidden' i pokazać toast
```

Konsument może zareagować na event:

```ts
authClient.on('forbidden', ({ requiredRoles, userRoles, mode }) => {
  sessionStorage.setItem('auth:forbidden', 'Brak uprawnień administratora')
})

// W /login route:
useEffect(() => {
  const msg = sessionStorage.getItem('auth:forbidden')
  if (msg) {
    toast.error(msg)
    sessionStorage.removeItem('auth:forbidden')
  }
}, [])
```

## `<AuthBoundary>` — pełny kontrakt

| Prop             | Typ                        | Default       | Opis                                                                                |
| ---------------- | -------------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `mode`           | `"protected"` \| `"guest"` | `"protected"` | `protected`: wymaga zalogowanego usera. `guest`: strona publiczna (np. /login).     |
| `fallback`       | `ReactNode` / slot         | `null`        | Renderowane podczas ładowania /me LUB gdy warunki dostępu jeszcze się rozstrzygają. |
| `requireRoles`   | `string[]`                 | —             | (`protected`) User musi mieć WSZYSTKIE wymienione role (AND).                       |
| `requireAnyRole` | `string[]`                 | —             | (`protected`) User musi mieć PRZYNAJMNIEJ JEDNĄ z ról (OR).                         |

Brak callbacków. Wszystkie redirecty robi paczka na podstawie configu `createAuthClient`.

## `useAuth()` — pełny kształt

```ts
const {
  user, // AuthUser | null
  isAuthenticated, // boolean
  isLoading, // boolean — true podczas pierwszego /me
  error, // Error | null
  refetch, // () => Promise — ręczne odświeżenie /me

  login, // await login({ username, password })
  //   + login.isPending, login.error, login.reset
  logout, // logout() — idempotentny
  //   + logout.isPending, logout.error

  client, // niskopoziomowy AuthClient (rzadko potrzebny)
} = useAuth()
```

`login` i `logout` to **callable funkcje z dołączonym stanem mutation** — wołasz jak funkcję (`await login(creds)`, `<button onClick={logout}>`) i jednocześnie czytasz `login.isPending`, `login.error`.

## Cross-tab sync (`broadcastSession`)

Gdy włączone, paczka używa BroadcastChannel (fallback: storage event) żeby synchronizować sesję między tabami tego samego origin:

- **Logout w tabie A → tab B się wylogowuje** (redirect na loginPath).
- **Refresh fail w tabie A → tab B się wylogowuje**.
- **Login w tabie A → tab B na chronionej trasie odświeża /me**; tab B na trasie publicznej (`<AuthBoundary mode="guest">`) zauważa zmianę i redirectuje na homePath.

## Role-based access — dwa wzorce

### 1. Deklaratywnie (`<AuthBoundary requireRoles>`)

Cała sekcja UI wymaga roli. Brak roli → redirect na `forbiddenPath`:

```tsx
<AuthBoundary requireRoles={['ROLE_ADMIN']} fallback={<Spinner />}>
  <AdminPanel />
</AuthBoundary>
```

### 2. Imperatywnie (`client.assertRoles`)

Po loginie chcesz natychmiast zweryfikować rolę. `assertRoles` woła /me, sprawdza role, jeśli nie spełniają — **woła logout()** (czyli redirect na `loginPath`) i rzuca `ForbiddenRoleError`:

```ts
import { ForbiddenRoleError } from '@musikhood-dev/auth-client'

try {
  await client.login({ username, password })
  await client.assertRoles(['ROLE_ADMIN'])
  // user zostanie auto-przekierowany na homePath przez <AuthBoundary mode="guest">
} catch (err) {
  if (err instanceof ForbiddenRoleError) {
    toast.error('Wymagane uprawnienia administratora')
    // paczka już zrobiła logout + redirect na loginPath
  }
}
```

Drugi argument: `'all'` (default, AND) lub `'any'` (OR).

## Requesty do twojego API z auto-refresh

`authClient.http` to instancja axios z gotowym interceptorem 401 → refresh → retry:

```ts
const products = await authClient.http.get('/api/products')
// albo skrótowo:
const products = await authClient.get('/api/products')
```

Cookies leci automatycznie (`withCredentials: true`). Single-flight lock: N równoległych 401-ek triggeruje dokładnie jeden refresh.

## Niskopoziomowe API

```ts
authClient.login(creds) // POST /api/login
authClient.logout() // POST /api/logout, idempotent + redirect na loginPath
authClient.me() // GET /api/v1/user/me
authClient.refresh() // manualny refresh
authClient.assertRoles([...]) // /me + auto-logout jeśli brak ról
authClient.redirectTo('/path') // redirect przez paczkę (respektuje pathname guard)
authClient.isAuthenticated() // sync getter z cache
authClient.getCachedUser() // sync getter z cache
authClient.isSessionExpired() // sync getter — true gdy ostatnia sesja umarła
authClient.verifyMfa({ mfaToken, code | recoveryCode, rememberDevice }) // POST /api/login/mfa
authClient.stepUpMfa({ code | recoveryCode, rememberDevice }) // POST /api/session/mfa
authClient.requestMfaEnrollment({ password }) // POST /api/mfa/enrollment/request → URL (hasło wymagane)
authClient.startMfaEnrollment(url?) // redirect na stronę konfiguracji 2FA
authClient.confirmMfaEnrollment({ enrollmentToken, code }) // POST /api/mfa/enrollment/confirm → { recoveryCodes, returnUrl, session }
authClient.getMfaState() / isMfaStepUpRequired() / resetMfa() // stan 2FA wraca do 'idle' sam po logout / unauthorized (od 2.2.1)

authClient.on('login', (tokens) => {})
authClient.on('logout', () => {})
authClient.on('unauthorized', () => {})
authClient.on('user-changed', (user) => {})
authClient.on('forbidden', ({ requiredRoles, userRoles, mode }) => {})
authClient.on('login-error', (err) => {})    // np. toast.error po fail login
authClient.on('logout-error', (err) => {})   // np. toast.error po fail logout
authClient.on('refresh-error', (err) => {})  // np. analytics / monitoring
authClient.on('mfa-required', (state) => {})
authClient.on('mfa-step-up-required', () => {})            // pokaż modal z kodem
authClient.on('mfa-enrollment-required', ({ enrollmentUrl }) => {})
authClient.on('mfa-state-changed', (state) => {})
```

Error eventy lecą równolegle do `throw` z metod — czyli `client.login()` i tak rzuca, ale dodatkowo emit pozwala konsumentowi obsłużyć błąd deklaratywnie (toast w jednym miejscu zamiast try/catch w każdym komponencie).

## 2FA (TOTP) i fingerprint urządzenia (2.2+)

Wszystko jest **addytywne**: backend bez pola `code` w błędach = zachowanie jak w 2.1.

Gotowe komponenty (formularz kodu, dialogi step-up / wymaganej konfiguracji, logowanie z krokiem kodu) generuje
`npx @musikhood-dev/auth-client init` — poniżej API, na którym są zbudowane.

Błędy rozpoznawaj po nazwie: `isAuthErrorNamed(err, 'MfaRequiredError')` (2.3+). Adaptery `/react` i `/vue` są
osobnymi entry bundla z własnymi kopiami klas błędów, więc `instanceof` między entry bywa fałszywy (klient i klasy
błędów importowane z głównego entry — działa).

### Logowanie z kodem

```tsx
import {
  MfaRequiredError,
  MfaEnrollmentRequiredError,
  TooManyAttemptsError,
} from '@musikhood-dev/auth-client'
import { useAuth, useMfa } from '@musikhood-dev/auth-client/react'

function LoginPage() {
  const { login } = useAuth()
  const mfa = useMfa() // { stage: 'idle' | 'code' | 'step-up' | 'enrollment', mfaToken, enrollmentUrl, verify, stepUp, ... }

  const onSubmit = async (username: string, password: string) => {
    try {
      await login({ username, password })
    } catch (e) {
      if (e instanceof MfaRequiredError) return // mfa.stage === 'code' → pokaż pole kodu
      if (e instanceof MfaEnrollmentRequiredError)
        return mfa.startEnrollment(e.enrollmentUrl ?? undefined)
      if (e instanceof TooManyAttemptsError) return showError(`Spróbuj za ${e.retryAfter ?? 60} s`)
      throw e
    }
  }

  // stage 'code': kod TOTP albo zapasowy; rememberDevice = 30 dni bez kodu na tym urządzeniu
  const onCode = (code: string) => mfa.verify({ code, rememberDevice: true })
  const onRecovery = (recoveryCode: string) => mfa.verify({ recoveryCode })
}
```

Vue: `useMfa()` z `@musikhood-dev/auth-client/vue` — te same pola jako `ComputedRef`.

| Odpowiedź backendu                                     | Błąd / zdarzenie                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401 `mfa_required` (login)                             | `MfaRequiredError { mfaToken, methods }` (podklasa `InvalidCredentialsError`), stan `code`, event `mfa-required`                                                               |
| 403 `mfa_enrollment_required` (login)                  | `MfaEnrollmentRequiredError { enrollmentUrl }` (podklasa `LoginForbiddenError`) — link gotowy, hasło właśnie zweryfikowane                                                     |
| 403 `mfa_enrollment_required` (dowolny request, `/me`) | event `mfa-enrollment-required { enrollmentUrl: null }`, stan `enrollment` — poproś o hasło → `requestMfaEnrollment({ password })`                                             |
| 401 `mfa_invalid_code`                                 | `MfaInvalidCodeError` (`reason: 'invalid'`, można ponowić)                                                                                                                     |
| 401 `mfa_code_reused`                                  | `MfaInvalidCodeError` (`reason: 'reused'`) — kod poprawny, ale już użyty; poczekaj na następny w aplikacji                                                                     |
| 401 `mfa_token_expired`                                | `MfaTokenExpiredError` (zacznij login od nowa)                                                                                                                                 |
| 429 `too_many_attempts`                                | `TooManyAttemptsError { retryAfter }` (nagłówek `Retry-After`)                                                                                                                 |
| 403 `mfa_step_up` (dowolny request, `/me`)             | event `mfa-step-up-required`, stan `step-up`, `me()` rzuca `MfaStepUpRequiredError` — **bez** redirectu na login, bez `panel-access-denied`                                    |
| 401 `device_mismatch_recheck`                          | zwykły refresh (pełna weryfikacja urządzenia na serwerze) i retry; w trybie `enforce` serwer zwraca go też, gdy brak nagłówka `X-Device-Fp` przy sesji związanej z urządzeniem |
| refresh 401 `device_mismatch`                          | `DeviceMismatchError` (podklasa `SessionExpiredError`) — jak wygaśnięcie sesji                                                                                                 |

### Step-up

Panel może wymagać 2FA od sesji zalogowanej bez kodu. Paczka emituje `mfa-step-up-required`;
pokaż globalny modal i wywołaj `mfa.stepUp({ code })` (albo `client.stepUpMfa`). `<AuthBoundary>`
nie przekierowuje na login i nie zapętla `/me` w tym stanie; po sukcesie `/me` odświeża się samo.

### Konfiguracja 2FA (enrollment)

`client.requestMfaEnrollment({ password })` zwraca jednorazowy link do strony konfiguracji — **wymaga aktualnego
hasła** (skradzione ciasteczko nie może podpiąć 2FA atakującego). Błędy: `InvalidCredentialsError`,
`MfaAlreadyEnabledError` (409), `TooManyAttemptsError`. `client.startMfaEnrollment(url?)` przekierowuje (pełna
nawigacja) na podany link albo na link z `MfaEnrollmentRequiredError` loginu. Strona konfiguracji jest po stronie auth-panelu.

`client.confirmMfaEnrollment({ enrollmentToken, code })` (strona konfiguracji) wysyła fingerprint urządzenia i zwraca
`{ recoveryCodes, returnUrl, session }`. `session != null` = auth-server od razu zalogował usera z 2FA
(`amr: [pwd, otp]`, cookies ustawione, event `login`) — po ekranie kodów wystarczy przejść na `returnUrl`, bez
step-upu. `session === null` = link wydany przez backend konsumenta (auth-client-bundle) albo starszy auth-server —
user loguje się ponownie na swoim panelu.

### Fingerprint urządzenia

`core/device.ts` zbiera komponenty (przeglądarka + major, OS, platforma, CPU, pamięć, WebGL, strefa,
języki, ekran, canvas) bez zewnętrznych bibliotek; hash SHA-256 z kanonicznego JSON (zgodny z serwerem —
wspólny wektor testowy). SSR / brak WebCrypto → brak fingerprintu. Wynik cache'owany na czas życia strony.
`deviceFingerprint: false` wyłącza nagłówek i pole `device` (requesty jak w 2.1).

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (do buildowania konsumentów)

## Licencja

MIT
