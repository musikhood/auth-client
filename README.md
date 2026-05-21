# @musikhood-dev/auth-client

Wspólny klient auth dla frontendów React i Vue 3. Owija HTTP, automatyczny refresh tokenów i hooki / composables wokół TanStack Query.

Repozytorium zawiera jeden publikowany pakiet: [`@musikhood-dev/auth-client`](./packages/auth-client). Dwa adaptery (React, Vue) są dostarczane jako subexports tego samego pakietu.

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
import { AuthProvider, useAuth, AuthBoundary } from '@musikhood-dev/auth-client/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const authClient = createAuthClient({
  baseUrl: 'https://auth.example.com',
  loginPath: '/login',
})

const queryClient = new QueryClient()

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={authClient}>
        <AuthBoundary fallback={<LoginPage />}>
          <ProtectedApp />
        </AuthBoundary>
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
  baseUrl: 'https://auth.example.com',
})

const app = createApp(App)
app.use(VueQueryPlugin)
app.use(createAuth(authClient))
app.mount('#app')
```

```vue
<script setup lang="ts">
import { useAuth, AuthBoundary } from '@musikhood-dev/auth-client/vue'
const { login } = useAuth()
</script>

<template>
  <AuthBoundary>
    <template #default>Witaj</template>
    <template #fallback>
      <button @click="login.mutate({ username: 'jan', password: 'tajne' })">Zaloguj</button>
    </template>
  </AuthBoundary>
</template>
```

## Konfiguracja

```ts
createAuthClient({
  baseUrl: string,                       // wymagane
  loginPath?: string,                    // redirect tu przy wygaśnięciu sesji / logout
  homePath?: string,                     // redirect tu dla zalogowanego usera na trasie guest
  forbiddenPath?: string,                // redirect tu przy braku wymaganych ról
  requireRoles?: string[],               // panel-wide role gate (AND)
  requireAnyRole?: string[],             // panel-wide role gate (OR)
  redirect?: (path: string) => void,     // override nawigacji (np. router SPA)
  meRefetchInterval?: number | false,    // interwał pollingu /me (default 30000)
})
```

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (dla buildowania konsumentów)

## Licencja

MIT
