# @musikhood-dev/auth-client

Wspólny klient auth dla frontendów React i Vue 3.

- **Jeden komponent**: `<AuthBoundary>` dla tras chronionych i publicznych.
- **Jeden hook**: `useAuth()` daje `user`, `login`, `logout`.
- **Cookies-only**: BEARER + refresh_token (HttpOnly). Nic w localStorage.
- **Auto-refresh**: 401 → `/api/token/refresh` → retry oryginalnego requestu. Single-flight lock.
- **Cross-tab sync** (opt-in): logout / login w jednym tabie propaguje się do reszty.
- **Role-based access**: `requireRoles` / `requireAnyRole` w `<AuthBoundary>` + `client.assertRoles()` przy login.

## Instalacja

```bash
npm i @musikhood-dev/auth-client
# adapter React:
npm i @tanstack/react-query
# adapter Vue:
npm i @tanstack/vue-query
```

## Minimalna konfiguracja

```ts
import { createAuthClient } from '@musikhood-dev/auth-client'

export const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL, // np. http://localhost
  unauthorizedRedirect: '/login', // paczka sama robi redirect + pathname guard
  broadcastSession: true, // (opcjonalne) cross-tab sync
})
```

## Architektura w 30 sekund

Aplikację dzielisz na **trzy strefy**:

```
<AuthProvider>                          ← raz, w roocie aplikacji
  <Route path="/login">
    <AuthBoundary mode="guest">         ← publiczna: zalogowany → redirect na /
      <LoginPage />
    </AuthBoundary>
  </Route>

  <Route path="/*">
    <AuthBoundary>                      ← chroniona: niezalogowany → redirect na /login
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

W każdym chronionym komponencie:

```ts
const { user, login, logout } = useAuth()
```

## React — pełny przykład

```tsx
// lib/auth.ts
import { createAuthClient } from '@musikhood-dev/auth-client'

export const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  unauthorizedRedirect: '/login',
  broadcastSession: true,
})

// App.tsx
import { AuthProvider, AuthBoundary, useAuth } from '@musikhood-dev/auth-client/react'
import { Routes, Route, useNavigate } from 'react-router'
import { authClient } from './lib/auth'

export function App() {
  return (
    <AuthProvider client={authClient}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/admin/*" element={<AdminRoute />} />
        <Route path="/*" element={<AppRoute />} />
      </Routes>
    </AuthProvider>
  )
}

function LoginRoute() {
  const navigate = useNavigate()
  return (
    <AuthBoundary
      mode="guest"
      fallback={<Spinner />}
      onAuthenticated={() => navigate('/', { replace: true })}
    >
      <LoginPage />
    </AuthBoundary>
  )
}

function AppRoute() {
  return (
    <AuthBoundary fallback={<Spinner />}>
      <Dashboard />
    </AuthBoundary>
  )
}

function AdminRoute() {
  const navigate = useNavigate()
  return (
    <AuthBoundary
      requireRoles={['ROLE_ADMIN']}
      fallback={<Spinner />}
      onForbidden={() => navigate('/', { replace: true })}
    >
      <AdminPanel />
    </AuthBoundary>
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
  unauthorizedRedirect: '/login',
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
import { useRouter } from 'vue-router'
import { AuthBoundary, useAuth } from '@musikhood-dev/auth-client/vue'

const router = useRouter()
const { login } = useAuth()
</script>

<template>
  <AuthBoundary mode="guest" :on-authenticated="() => router.replace('/')">
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

> W Vue dane są reaktywne (`Ref`/`ComputedRef`). W `<script>` używaj `user.value`, w `<template>` Vue auto-unwrapuje. `login.isPending` to `Ref<boolean>` (stąd `.value` w `:disabled`).

## `<AuthBoundary>` — pełny kontrakt

| Prop              | Typ                        | Default                      | Opis                                                                                                 |
| ----------------- | -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `mode`            | `"protected"` \| `"guest"` | `"protected"`                | `protected`: wymaga zalogowanego usera + polling /me. `guest`: wymaga NIE-zalogowanego (np. /login). |
| `fallback`        | `ReactNode` / slot         | `null`                       | Renderowane podczas ładowania /me LUB gdy warunki dostępu niespełnione.                              |
| `requireRoles`    | `string[]`                 | —                            | (`protected`) User musi mieć WSZYSTKIE wymienione role (AND).                                        |
| `requireAnyRole`  | `string[]`                 | —                            | (`protected`) User musi mieć PRZYNAJMNIEJ JEDNĄ z ról (OR).                                          |
| `onUnauthorized`  | `() => void`               | —                            | (`protected`) Brak sesji / refresh fail.                                                             |
| `onForbidden`     | `() => void`               | fallback do `onUnauthorized` | (`protected`) Sesja jest, ale brak ról.                                                              |
| `onAuthenticated` | `() => void`               | —                            | (`guest`) User JEST zalogowany — typowo redirect na `/`.                                             |

## `useAuth()` — pełny kształt

```ts
const {
  user, // AuthUser | null. W boundary z /me; poza boundary — null.
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

`login` i `logout` są **callable funkcjami z dołączonym stanem mutation** — wołasz jak funkcję (`await login(creds)`, `<button onClick={logout}>`) i jednocześnie czytasz `login.isPending`, `login.error`.

## `createAuthClient` — config

```ts
createAuthClient({
  baseUrl: string,                       // wymagane

  unauthorizedRedirect?: string,         // np. '/login' — paczka sama redirectuje
                                         // z wbudowanym pathname guardem
  onUnauthorized?: () => void,           // alternatywa dla advanced cases (ma pierwszeństwo)

  meRefetchInterval?: number | false,    // ms, default 30_000. false = bez pollingu

  broadcastSession?: boolean,            // default false. Cross-tab sync logout/login.
})
```

## Cross-tab sync (`broadcastSession`)

Gdy włączone, paczka używa BroadcastChannel (fallback: storage event) żeby synchronizować sesję między tabami tego samego origin:

- Logout w tabie A → tab B dostaje lokalny event `unauthorized` → AuthBoundary woła `onUnauthorized` → redirect.
- Login w tabie A → tab B unieważnia query /me → svieży user się ładuje.
- Refresh fail (`unauthorized`) w tabie A → tab B również się wylogowuje.

Działa tylko na tym samym origin (cross-origin BroadcastChannel jest zablokowane).

## Role-based access — dwa wzorce

### 1. Deklaratywnie (`<AuthBoundary requireRoles>`)

Cała sekcja UI wymaga roli:

```tsx
<AuthBoundary requireRoles={['ROLE_ADMIN']} onForbidden={() => navigate('/')}>
  <AdminPanel />
</AuthBoundary>
```

### 2. Imperatywnie (`client.assertRoles`)

Po loginie chcesz natychmiast zweryfikować rolę. `assertRoles` woła /me, sprawdza role, jeśli nie spełniają — **woła logout()** i rzuca `ForbiddenRoleError`:

```ts
import { ForbiddenRoleError } from '@musikhood-dev/auth-client'

try {
  await client.login({ username, password })
  await client.assertRoles(['ROLE_ADMIN'])
  navigate('/admin')
} catch (err) {
  if (err instanceof ForbiddenRoleError) {
    toast.error('Wymagane uprawnienia administratora')
  }
}
```

Drugi argument to tryb: `'all'` (default, AND) lub `'any'` (OR).

## Requesty do twojego API z auto-refresh

`authClient.http` to instancja axios z gotowym interceptorem 401 → refresh → retry:

```ts
const products = await authClient.http.get('/api/products')
// albo skrótowo:
const products = await authClient.get('/api/products')
```

Cookies leci automatycznie (`withCredentials: true`). Single-flight lock: N równoległych 401-ek triggeruje dokładnie jeden refresh.

## Niskopoziomowe API

Większość konsumentów nigdy tego nie tknie. Dostępne na `authClient`:

```ts
authClient.login(creds)        // POST /api/login
authClient.logout()            // POST /api/logout, idempotent
authClient.me()                // GET /api/v1/user/me
authClient.refresh()           // manualny refresh
authClient.assertRoles([...])  // /me + auto-logout jeśli brak ról
authClient.isAuthenticated()   // sync getter z cache
authClient.getCachedUser()     // sync getter z cache

authClient.on('login',        (tokens) => {})
authClient.on('logout',       () => {})
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
