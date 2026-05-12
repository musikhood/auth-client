# @musikhood-dev/auth-client

Wspólny klient auth dla frontendów React i Vue 3. Automatycznie wysyła JWT w cookies, sam odświeża token gdy wygaśnie, i daje jeden hook do całej obsługi auth.

- **Jeden hook**: `useAuth()` zwraca `user`, `login`, `logout` i stan.
- **Cookies-only**: BEARER + refresh_token (HttpOnly, SameSite=None). Nic w localStorage.
- **Auto-refresh**: 401 z serwera → `/api/token/refresh` → ponowienie oryginalnego requestu. Wszystko niewidoczne dla użytkownika.
- **Single-flight lock**: N równoległych 401-ek triggeruje dokładnie jeden refresh.
- **Wszystkie requesty do twojego API** przez `authClient.http` mają auto-refresh za darmo.

## Instalacja

```bash
npm i @musikhood-dev/auth-client
# adapter React:
npm i @tanstack/react-query
# adapter Vue:
npm i @tanstack/vue-query
```

## Jak to działa w 30 sekund

1. Tworzysz `authClient` raz, na starcie aplikacji.
2. Owijasz appkę w `<AuthProvider client={authClient}>`.
3. **Chronione** części aplikacji owijasz dodatkowo w `<AuthBoundary>`. Tylko wewnątrz tej granicy `useAuth()` woła `/api/v1/user/me`, polluje co 30s i odświeża po focusie okna.
4. W komponentach piszesz `const { user, login, logout } = useAuth()`. Tyle.

```
<AuthProvider>             ← raz na całą aplikację
  /login                   ← useAuth() → { user: null, login(...) }
  /...                     ← inne publiczne strony
  <AuthBoundary>           ← tu zaczyna się tryb chroniony
    /dashboard             ← useAuth() → { user, logout(...) }
    /products
    ...
  </AuthBoundary>
</AuthProvider>
```

## Szybki start — React

```tsx
import { createAuthClient } from '@musikhood-dev/auth-client'
import { AuthProvider, AuthBoundary, useAuth } from '@musikhood-dev/auth-client/react'
import { Routes, Route } from 'react-router'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  onUnauthorized: () => {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
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
  // Poza <AuthBoundary>: useAuth() NIE woła /me, user = null.
  // login() callable z stanem mutation jest dostępny.
  const { login } = useAuth()
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        try {
          await login({
            username: form.get('username') as string,
            password: form.get('password') as string,
          })
          window.location.href = '/'
        } catch {
          // login.error też dostępny, można pokazać toast
        }
      }}
    >
      <input name="username" />
      <input name="password" type="password" />
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? 'Loguję…' : 'Zaloguj'}
      </button>
      {login.error && <p>{login.error.message}</p>}
    </form>
  )
}

function ProtectedApp() {
  // Wewnątrz <AuthBoundary>: useAuth() woła /me, polluje co 30s, refetchuje po focusie.
  const { user, logout, isLoading } = useAuth()
  if (isLoading) return <p>Ładowanie…</p>
  return (
    <>
      <p>Witaj, {user?.displayName ?? user?.email}</p>
      <button onClick={() => logout()}>Wyloguj</button>
    </>
  )
}
```

## Szybki start — Vue 3

```ts
// main.ts
import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient } from '@musikhood-dev/auth-client'
import { createAuth } from '@musikhood-dev/auth-client/vue'
import App from './App.vue'

const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL,
  onUnauthorized: () => {
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  },
})

const app = createApp(App)
app.use(VueQueryPlugin) // wymagane przed createAuth
app.use(createAuth(authClient))
app.mount('#app')
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { AuthBoundary, useAuth } from '@musikhood-dev/auth-client/vue'

const { login } = useAuth() // poza AuthBoundary: user = null, login callable dostępny
</script>

<template>
  <!-- strona publiczna -->
  <RouterView v-if="$route.path === '/login'">
    <button
      @click="login({ username: 'jan', password: 'tajne' })"
      :disabled="login.isPending.value"
    >
      Zaloguj
    </button>
  </RouterView>

  <!-- chroniona część aplikacji -->
  <AuthBoundary v-else>
    <ProtectedApp />
  </AuthBoundary>
</template>
```

```vue
<!-- ProtectedApp.vue — wewnątrz AuthBoundary -->
<script setup lang="ts">
import { useAuth } from '@musikhood-dev/auth-client/vue'
const { user, logout } = useAuth()
</script>

<template>
  <p v-if="user">Witaj, {{ user.displayName ?? user.email }}</p>
  <button @click="logout()">Wyloguj</button>
</template>
```

> **Uwaga Vue**: dane w `useAuth()` są reaktywne (`Ref`/`ComputedRef`). W `<script>` używaj `user.value`, w `<template>` Vue auto-unwrapuje. `login.isPending` to też `Ref<boolean>` (stąd `.value` w bindingu `:disabled`).

## `useAuth()` — pełny kształt

```ts
const {
  user, // AuthUser | null. Wewnątrz <AuthBoundary> przychodzi z /me; poza — null.
  isAuthenticated, // boolean. True gdy user się załadował i jest sesja.
  isLoading, // boolean. True podczas pierwszego /me.
  error, // Error | null. Błąd z /me (np. SessionExpiredError).
  refetch, // () => Promise. Ręczne odświeżenie usera.

  login, // callable: await login({ username, password })
  //   login.isPending, login.error, login.reset, login.data
  logout, // callable: logout() (idempotent)
  //   logout.isPending, logout.error, logout.reset

  client, // niskopoziomowy AuthClient (zwykle niepotrzebny)
} = useAuth()
```

`login` i `logout` to **funkcje z dołączonym stanem mutation**. Można je wołać bezpośrednio (`await login(creds)`, `onClick={logout}`) i jednocześnie czytać `login.isPending`, `login.error` w UI.

## Requesty do twojego API z auto-refresh

`authClient.http` to instancja axios z gotowym interceptorem 401 → refresh → retry. Używaj jej do wszystkich autoryzowanych endpointów twojego mikroserwisu:

```ts
import { authClient } from './lib/auth'

// w komponencie / hooku / loaderze:
const products = await authClient.http.get('/api/products')
// skrótowo:
const products = await authClient.get('/api/products')
```

Cookies BEARER + refresh_token przeglądarka dokleja automatycznie (`withCredentials: true`). Gdy backend zwróci 401, paczka:

1. zatrzymuje response,
2. woła `/api/token/refresh`,
3. ponawia oryginalny request.

Single-flight lock gwarantuje że N równoległych 401-ek triggeruje dokładnie jeden `/api/token/refresh` (nie N).

## Konfiguracja `createAuthClient`

```ts
createAuthClient({
  baseUrl: string,                  // wymagane — np. import.meta.env.VITE_API_BASE_URL
  onUnauthorized?: () => void,      // wołane gdy refresh ostatecznie się nie udał.
                                    // Typowo: redirect na /login (z sprawdzeniem czy już tam nie jesteśmy).
  fetch?: typeof fetch,             // override dla testów (klient i tak używa axios).
})
```

## Kontrakt z backendem

Paczka zakłada że backend wystawia te endpointy:

| Metoda + URL              | Co robi                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/login`         | Body `{ username, password }`. Sukces 200, backend ustawia cookies BEARER + refresh_token. |
| `POST /api/logout`        | Idempotent. Backend kasuje cookies (`Max-Age=0`).                                          |
| `POST /api/token/refresh` | Refresh_token z cookie. Sukces 200 z nowymi cookies. 401 = sesja martwa.                   |
| `GET /api/v1/user/me`     | BEARER z cookie. Zwraca `AuthUser`.                                                        |

Cookies muszą być `HttpOnly` (paczka nie czyta tokenów z JS) i `SameSite=None` z `Secure` (lub same-origin).

## Reagowanie na zdarzenia (zaawansowane)

Jeśli potrzebujesz reagować na zmiany sesji **poza** komponentem (np. czyścić localStorage, slack-notyfikacja przy logoucie), użyj eventów na `authClient`:

```ts
authClient.on('login', (tokens) => {
  /* ... */
})
authClient.on('logout', () => {
  /* ... */
})
authClient.on('unauthorized', () => {
  /* refresh fail */
})
authClient.on('user-changed', (user) => {
  /* user.id się zmienił */
})
```

`on()` zwraca funkcję unsubscribe.

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x (React: auto-fallback gdy konsument nie ma `<QueryClientProvider>`; Vue: zainstaluj `VueQueryPlugin` przed `createAuth`)
- Node 18+ do buildowania konsumentów

## Licencja

MIT
