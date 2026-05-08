import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAuthClient } from '@musikhood-dev/auth-client'
import { AuthProvider } from '@musikhood-dev/auth-client/react'
import { App } from './App.js'

const authClient = createAuthClient({
  baseUrl: 'https://auth.example.com',
  onUnauthorized: () => {
    console.warn('Sesja wygasła — przekierowanie na login')
  },
})

const queryClient = new QueryClient()

const container = document.getElementById('root')
if (!container) throw new Error('Brak #root')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={authClient}>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
