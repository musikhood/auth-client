import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient } from '@musikhood-dev/auth-client'
import { createAuth } from '@musikhood-dev/auth-client/vue'
import App from './App.vue'

const authClient = createAuthClient({
  baseUrl: 'https://auth.example.com',
  onUnauthorized: () => console.warn('Sesja wygasła'),
})

const app = createApp(App)
app.use(VueQueryPlugin)
app.use(createAuth(authClient))
app.mount('#app')
