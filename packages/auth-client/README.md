# @musikhood-dev/auth-client

Wspólny klient auth dla frontendów React i Vue 3. Owija HTTP, automatyczny refresh tokenów w cookies i daje hooki / composables zbudowane na TanStack Query.

- Cookies-only (BEARER + refresh_token, HttpOnly, SameSite=None) — klient niczego nie trzyma w localStorage.
- Interceptor 401 → automatyczny `/api/token/refresh` → retry oryginalnego requestu, z single-flight lockiem (N równoległych 401 = 1 refresh).
- Background polling `/me` co 30 s + refetch po focusie okna — UI sam wie gdy admin wyłączy konto albo zmieni role.
- Subpath exports: `@musikhood-dev/auth-client` (core), `/react`, `/vue`.

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
import { AuthProvider, useAuth, AuthGate } from '@musikhood-dev/auth-client/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  onUnauthorized: () => {
    window.location.href = '/login'
  },
})

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={authClient}>
        <AuthGate fallback={<LoginPage />}>
          <ProtectedApp />
        </AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  )
}

function LoginPage() {
  const { login } = useAuth()
  return (
    <button onClick={() => login.mutate({ username: 'jan', password: 'tajne' })}>Zaloguj</button>
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
      <button @click="login.mutate({ username: 'jan', password: 'tajne' })">Zaloguj</button>
    </template>
  </AuthGate>
</template>
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

- `<AuthProvider client={authClient}>`
- `useAuth()` — agregat: `{ user, isAuthenticated, isLoading, login, logout, refetch, error, client }`.
- `useMe()`, `useLogin()`, `useLogout()`, `useAuthClient()` — niskopoziomowe.
- `<AuthGate fallback loading>` — renderuje children gdy zalogowany.

### Vue 3 adapter (`@musikhood-dev/auth-client/vue`)

- `createAuth(authClient)` — plugin (`app.use(...)`).
- `useAuth()`, `useMe()`, `useLogin()`, `useLogout()`, `useAuthClient()` — composables.
- `<AuthGate>` — komponent z slotami `default` / `fallback` / `loading`.

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (do buildowania konsumentów)

## Licencja

MIT
