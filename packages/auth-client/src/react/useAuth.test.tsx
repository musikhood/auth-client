import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createAuthClient } from '../core/client.js'
import { AuthProvider } from './AuthProvider.js'
import { AuthBoundary } from './AuthBoundary.js'
import { useAuth } from './useAuth.js'
import { BASE_URL, state } from '../test/server.js'

// Wrapper dla trybu chronionego: AuthProvider + AuthBoundary.
// Świadomie BEZ <QueryClientProvider> — testujemy auto-fallback.
function protectedWrapper({ children }: { children: ReactNode }) {
  const client = createAuthClient({ baseUrl: BASE_URL })
  return (
    <AuthProvider client={client}>
      <AuthBoundary>{children}</AuthBoundary>
    </AuthProvider>
  )
}

// Wrapper publiczny — bez AuthBoundary (tryb /login etc.).
function publicWrapper({ children }: { children: ReactNode }) {
  const client = createAuthClient({ baseUrl: BASE_URL })
  return <AuthProvider client={client}>{children}</AuthProvider>
}

describe('useAuth — wewnątrz AuthBoundary', () => {
  it('woła /me, user się pojawia', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: protectedWrapper })

    await waitFor(() => {
      expect(result.current.user).toMatchObject({ id: 'u-1' })
    })
    expect(result.current.isAuthenticated).toBe(true)
    expect(state.meCalls).toBeGreaterThan(0)
  })

  it('login jest callable, zwraca tokeny', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: protectedWrapper })

    let returned
    await act(async () => {
      returned = await result.current.login({ username: 'jan', password: 'tajne' })
    })
    expect(state.loginCalls).toBe(1)
    expect(returned).toMatchObject({ token: 'jwt-token-abc' })
  })

  it('login ma stan mutation (.isPending, .error)', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: protectedWrapper })

    expect(result.current.login.isPending).toBe(false)
    expect(result.current.login.error).toBeNull()

    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    await act(async () => {
      await result.current.login({ username: 'x', password: 'y' }).catch(() => {})
    })

    expect(result.current.login.error).not.toBeNull()
  })

  it('logout jest callable', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: protectedWrapper })

    await waitFor(() => expect(result.current.user).toMatchObject({ id: 'u-1' }))

    await act(async () => {
      await result.current.logout()
    })
    expect(state.logoutCalls).toBe(1)
  })
})

describe('useAuth — POZA AuthBoundary', () => {
  it('NIE woła /me, user jest null', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: publicWrapper })

    // Czekamy chwilę żeby ewentualne queries miały szansę pojść.
    await new Promise((r) => setTimeout(r, 50))

    expect(result.current.user).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.isLoading).toBe(false)
    expect(state.meCalls).toBe(0)
  })

  it('login dalej działa poza boundary', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: publicWrapper })

    await act(async () => {
      await result.current.login({ username: 'jan', password: 'tajne' })
    })
    expect(state.loginCalls).toBe(1)
    expect(state.meCalls).toBe(0) // /me NIE leci poza boundary
  })
})
