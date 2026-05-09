import { describe, it, expect } from 'vitest'
import { render, renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createAuthClient } from '../core/client.js'
import { AuthProvider } from './AuthProvider.js'
import { useAuth } from './useAuth.js'
import { BASE_URL, state } from '../test/server.js'

function wrapper({ children }: { children: ReactNode }) {
  // Świadomie BEZ <QueryClientProvider> — testujemy auto-fallback.
  const client = createAuthClient({ baseUrl: BASE_URL })
  return <AuthProvider client={client}>{children}</AuthProvider>
}

describe('useAuth — callable + auto QueryClient', () => {
  it('działa bez zewnętrznego QueryClientProvider (auto-fallback)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    // Najpierw query me jest pending lub leci.
    await waitFor(() => {
      expect(result.current.user).toMatchObject({ id: 'u-1' })
    })
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('login jest callable (bez .mutate / .mutateAsync)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    let returned
    await act(async () => {
      returned = await result.current.login({ username: 'jan', password: 'tajne' })
    })
    expect(state.loginCalls).toBe(1)
    // Callable zwraca to co mutateAsync — czyli TokenResponse.
    expect(returned).toMatchObject({ token: 'jwt-token-abc' })
  })

  it('login ma stan mutation (.isPending, .error)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.login.isPending).toBe(false)
    expect(result.current.login.error).toBeNull()

    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    await act(async () => {
      await result.current.login({ username: 'x', password: 'y' }).catch(() => {})
    })

    expect(result.current.login.error).not.toBeNull()
  })

  it('logout jest callable', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper })

    await waitFor(() => expect(result.current.user).toMatchObject({ id: 'u-1' }))

    await act(async () => {
      await result.current.logout()
    })
    expect(state.logoutCalls).toBe(1)
  })
})
