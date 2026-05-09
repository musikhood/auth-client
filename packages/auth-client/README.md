# @musikhood-dev/auth-client

Wspólny klient auth dla frontendów React i Vue 3. Owija HTTP, automatyczny refresh tokenów w cookies i daje hooki / composables zbudowane na TanStack Query.

- Cookies-only (BEARER + refresh_token, HttpOnly, SameSite=None) — klient niczego nie trzyma w localStorage.
- Interceptor 401 → automatyczny `/api/token/refresh` → retry oryginalnego requestu, z single-flight lockiem (N równoległych 401 = 1 refresh).
- Background polling `/me` co 30 s + refetch po focusie okna — UI sam wie gdy admin wyłączy konto albo zmieni role.
- Subpath exports: `@musikhood-dev/auth-client` (core), `/react`, `/vue`.
- **Jeden hook**: `useAuth()` daje user, login, logout. Tryb chroniony aktywujesz przez `<AuthBoundary>` w drzewie — wewnątrz `useAuth()` woła `/me` i polluje, poza nim nic nie robi (user = null).

## Instalacja

```bash
npm i @musikhood-dev/auth-client
# adapter React:
npm i @tanstack/react-query
# adapter Vue:
npm i @tanstack/vue-query
```

## Szybki start — React

```tsx
import { createAuthClient } from '@musikhood-dev/auth-client'
import { AuthProvider, AuthBoundary, useAuth } from '@musikhood-dev/auth-client/react'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  onUnauthorized: () => {
    if (window.location.pathname !== '/login') window.location.href = '/login'
  },
})

export function App() {
  return (
    <AuthProvider client={authClient}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/*"
          element={
            <AuthBoundary>
              <ProtectedApp />
            </AuthBoundary>
          }
        />
      </Routes>
    </AuthProvider>
  )
}

function LoginPage() {
  // Poza <AuthBoundary> — useAuth() nie woła /me, user jest null.
  // Login callable nadal dostępny.
  const { login } = useAuth()
  return (
    <button
      onClick={() => login({ username: 'jan', password: 'tajne' })}
      disabled={login.isPending}
    >
      {login.isPending ? 'Loguję…' : 'Zaloguj'}
    </button>
  )
}

function ProtectedApp() {
  // Wewnątrz <AuthBoundary> — useAuth() woła /me, polluje co 30s.
  const { user, logout } = useAuth()
  return (
    <>
      <p>Witaj, {user?.displayName}</p>
      <button onClick={logout}>Wyloguj</button>
    </>
  )
}
```

## Szybki start — Vue 3

```ts
import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient } from '@musikhood-dev/auth-client'
import { createAuth } from '@musikhood-dev/auth-client/vue'
import App from './App.vue'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
})

const app = createApp(App)
app.use(VueQueryPlugin)
app.use(createAuth(authClient))
app.mount('#app')
```

```vue
<script setup lang="ts">
import { useAuth, AuthGate } from '@musikhood-dev/auth-client/vue'
const { login } = useAuth()
</script>

<template>
  <AuthGate>
    <template #default>Witaj</template>
    <template #fallback>
      <button
        @click="login({ username: 'jan', password: 'tajne' })"
        :disabled="login.isPending.value"
      >
        Zaloguj
      </button>
    </template>
  </AuthGate>
</template>
```

## Brak konfiguracji TanStack Query (React)

W React `<AuthProvider>` sam stworzy `QueryClient`, jeśli konsument nie zainstalował własnego `<QueryClientProvider>`. Dzięki temu paczka działa "out of the box".

Jeśli aplikacja chce dzielić ten sam `QueryClient` ze swoimi własnymi query, wystarczy nałożyć `<QueryClientProvider>` na zewnątrz `<AuthProvider>` — paczka go wykryje i użyje.

We Vue trzeba zainstalować `VueQueryPlugin` ręcznie przed `createAuth`:

```ts
app.use(VueQueryPlugin)
app.use(createAuth(authClient))
```

## Konfiguracja

```ts
createAuthClient({
  baseUrl: string,                    // wymagane — np. import.meta.env.VITE_API_BASE_URL
  onUnauthorized?: () => void,        // wołane po nieudanym refreshu (typowo redirect na /login)
  fetch?: typeof fetch,               // override dla testów (klient i tak używa axios)
})
```

## Requesty do własnego API z auto-refresh

`client.http` to instancja axios z gotowym interceptorem 401 → refresh → retry. Używaj jej jako klienta HTTP do wszystkich autoryzowanych endpointów twojego mikroserwisu — refresh dzieje się sam.

```ts
const products = await authClient.http.get('/api/products')
// albo skrótowo:
const products = await authClient.get('/api/products')
```

Single-flight lock gwarantuje że N równoległych 401-ek triggeruje dokładnie jeden `/api/token/refresh`.

## API

### Core

- `createAuthClient(config)` — fabryka klienta.
- `client.login({ username, password })` — POST /api/login. Cookies BEARER + refresh_token ustawia przeglądarka.
- `client.logout()` — idempotentny, czyści lokalny cache i emituje event.
- `client.me()` — GET /api/v1/user/me.
- `client.refresh()` — manualny refresh (zwykle niepotrzebny — interceptor robi to sam).
- `client.isAuthenticated()` / `client.getCachedUser()` — sync gettery z lokalnego cache.
- `client.on(event, handler)` — `unauthorized`, `logout`, `login`, `user-changed`. Zwraca unsubscribe.

### React adapter (`@musikhood-dev/auth-client/react`)

- `<AuthProvider client={authClient}>` — wpina klienta i jego eventy w cache TanStack Query.
- `<AuthBoundary>` — aktywuje tryb chroniony. Wewnątrz `useAuth()` woła `/me`, polluje, refetchuje. Poza nim `useAuth()` nie woła `/me`.
- `<AuthGate fallback loading>` — renderuje children gdy zalogowany (pod spodem patrzy na `useAuth`).
- `useAuth()` — jedyny hook. Zwraca `{ user, isAuthenticated, isLoading, error, refetch, login, logout, client }`. `login` i `logout` są **callable funkcjami** (`await login({username, password})`, `<button onClick={logout}>`) i mają stan mutation (`login.isPending`, `login.error`, `login.reset`).

### Vue 3 adapter (`@musikhood-dev/auth-client/vue`)

- `createAuth(authClient)` — plugin (`app.use(...)`).
- `<AuthBoundary>` — aktywuje tryb chroniony (jak w React).
- `<AuthGate>` — komponent z slotami `default` / `fallback` / `loading`.
- `useAuth()` — jedyny composable, kształt analogiczny do React (dane jako `Ref`/`ComputedRef`).

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (do buildowania konsumentów)

## Licencja

MIT
