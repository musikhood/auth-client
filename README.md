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
import { AuthProvider, useAuth, AuthGate } from '@musikhood-dev/auth-client/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const authClient = createAuthClient({
  baseUrl: 'https://auth.example.com',
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
  baseUrl: 'https://auth.example.com',
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
  baseUrl: string,                       // wymagane
  onUnauthorized?: () => void,           // wołane gdy refresh nie powiedzie się
  fetch?: typeof fetch,                  // override do testów
})
```

## Wsparcie

- React 18.2+ / 19.x
- Vue 3.4+
- TanStack Query 5.x
- Node 18+ (dla buildowania konsumentów)

## Licencja

MIT
