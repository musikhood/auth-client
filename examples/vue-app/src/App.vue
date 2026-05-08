<script setup lang="ts">
import { ref } from 'vue'
import { AuthGate, useAuth } from '@musikhood-dev/auth-client/vue'

const { user, login, logout } = useAuth()
const username = ref('')
const password = ref('')

function submit() {
  login.mutate({ username: username.value, password: password.value })
}
</script>

<template>
  <main style="font-family: system-ui; padding: 24px">
    <h1>auth-client · Vue example</h1>
    <AuthGate>
      <template #loading>
        <p>Ładowanie…</p>
      </template>
      <template #fallback>
        <form @submit.prevent="submit">
          <label>Login <input v-model="username" required /></label><br />
          <label>Hasło <input v-model="password" type="password" required /></label><br />
          <button type="submit" :disabled="login.isPending.value">
            {{ login.isPending.value ? 'Loguję…' : 'Zaloguj' }}
          </button>
          <p v-if="login.error.value" style="color: crimson">
            {{ login.error.value.message }}
          </p>
        </form>
      </template>
      <template #default>
        <p>Witaj, {{ user?.displayName ?? user?.email }}</p>
        <p>Role: {{ user?.roles.join(', ') || '(brak)' }}</p>
        <button @click="logout.mutate()" :disabled="logout.isPending.value">Wyloguj</button>
      </template>
    </AuthGate>
  </main>
</template>
