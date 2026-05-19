# @musikhood-dev/auth-client

[![npm](https://img.shields.io/npm/v/@musikhood-dev/auth-client.svg)](https://www.npmjs.com/package/@musikhood-dev/auth-client)
[![license](https://img.shields.io/npm/l/@musikhood-dev/auth-client.svg)](./LICENSE)

Wspólny klient auth dla frontendów React i Vue 3.

- **Konfiguracja przez ścieżki**: `loginPath`, `homePath`, `forbiddenPath`. Paczka sama redirectuje.
- **Jeden hook**: `useAuth()` daje `user`, `login`, `logout`.
- **Jeden komponent**: `<AuthBoundary>` dla tras chronionych i publicznych.
- **Cookies-only**: BEARER + refresh_token (HttpOnly). Nic w localStorage.
- **Auto-refresh**: 401 → `/api/token/refresh` → retry. Single-flight lock.
- **Cross-tab sync** (opt-in): logout / login propagują się między tabami.
- **Role-based access**: `requireRoles` / `requireAnyRole` na `<AuthBoundary>` + `client.assertRoles()`.

## Instalacja

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
import { Routes, Route } from 'react-router'
import { authClient } from './lib/auth'

export function App() {
  return (
    <AuthProvider client={authClient}>
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
import App from './App.vue'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  loginPath: '/login',
  homePath: '/',
  broadcastSession: true,
})

const app = createApp(App)
app.use(VueQueryPlugin) // wymagane przed createAuth
app.use(createAuth(authClient))
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

authClient.on('login', (tokens) => {})
authClient.on('logout', () => {})
authClient.on('unauthorized', () => {})
authClient.on('user-changed', (user) => {})
```

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (do buildowania konsumentów)

## Licencja

MIT
