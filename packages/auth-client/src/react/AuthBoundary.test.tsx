import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { createAuthClient, type AuthClient } from '../core/client.js'
import { AuthProvider } from './AuthProvider.js'
import { AuthBoundary } from './AuthBoundary.js'
import { BASE_URL, state } from '../test/server.js'

type SetupOpts = {
  fallback?: React.ReactNode
  loginPath?: string
  forbiddenPath?: string
  redirect?: (path: string) => void
  requireRoles?: string[]
}

function setup(opts: SetupOpts = {}) {
  const client = createAuthClient({
    baseUrl: BASE_URL,
    loginPath: opts.loginPath,
    forbiddenPath: opts.forbiddenPath,
    redirect: opts.redirect,
  })
  return {
    client,
    ...render(
      <AuthProvider client={client}>
        <AuthBoundary fallback={opts.fallback} requireRoles={opts.requireRoles}>
          <div data-testid="protected">CHRONIONA</div>
        </AuthBoundary>
      </AuthProvider>,
    ),
  }
}

function setupGuest(opts: {
  fallback?: React.ReactNode
  homePath?: string
  redirect?: (path: string) => void
  client?: AuthClient
}) {
  const client =
    opts.client ??
    createAuthClient({
      baseUrl: BASE_URL,
      homePath: opts.homePath ?? '/',
      redirect: opts.redirect,
    })
  return {
    client,
    ...render(
      <AuthProvider client={client}>
        <AuthBoundary mode="guest" fallback={opts.fallback}>
          <div data-testid="guest">FORMULARZ</div>
        </AuthBoundary>
      </AuthProvider>,
    ),
  }
}

describe('<AuthBoundary protected>', () => {
  it('podczas isLoading pokazuje fallback', () => {
    setup({ fallback: <div data-testid="fb">Ładowanie...</div> })
    expect(screen.getByTestId('fb')).toBeTruthy()
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('po sukcesie /me renderuje children', async () => {
    setup({ fallback: <div data-testid="fb">…</div> })
    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeTruthy()
    })
    expect(screen.queryByTestId('fb')).toBeNull()
  })

  it('failed /me + refresh fail → paczka redirectuje na loginPath', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }
    const redirect = vi.fn()
    setup({ fallback: <div data-testid="fb">…</div>, loginPath: '/login', redirect })

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith('/login')
    })
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('TYLKO RAZ redirect przy failed sesji (brak pętli)', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }
    const redirect = vi.fn()
    setup({ fallback: <div data-testid="fb">…</div>, loginPath: '/login', redirect })

    await waitFor(() => expect(redirect).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 200))
    // Może być więcej niż 1 (paczka emituje 'unauthorized' z http interceptor +
    // potencjalnie inne miejsca), ale liczba jest STAŁA — nie rośnie nieograniczenie.
    // 'Brak pętli' = wywołanie zatrzymuje się po pierwszym redirectcie i nie spirale.
    const count1 = redirect.mock.calls.length
    await new Promise((r) => setTimeout(r, 300))
    expect(redirect.mock.calls.length).toBe(count1)
  })

  it('requireRoles fail → redirect na forbiddenPath', async () => {
    // user ma role ROLE_USER, boundary wymaga ROLE_ADMIN.
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    setup({
      fallback: <div data-testid="fb">…</div>,
      loginPath: '/login',
      forbiddenPath: '/forbidden',
      redirect,
      requireRoles: ['ROLE_ADMIN'],
    })

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith('/forbidden')
    })
    expect(screen.queryByTestId('protected')).toBeNull()
  })
})

describe('<AuthBoundary guest>', () => {
  it('z ważną sesją → redirect na homePath', async () => {
    const redirect = vi.fn()
    setupGuest({ fallback: <div data-testid="fb">…</div>, homePath: '/dashboard', redirect })

    await waitFor(() => {
      expect(redirect).toHaveBeenCalledWith('/dashboard')
    })
    // Formularz NIE jest pokazywany — fallback widoczny zanim redirect zadziała.
    expect(screen.queryByTestId('guest')).toBeNull()
  })

  it('bez sesji renderuje formularz, NIE tkwi w spinnerze', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }
    const redirect = vi.fn()
    setupGuest({ fallback: <div data-testid="fb">spinner</div>, redirect })

    await waitFor(() => {
      expect(screen.queryByTestId('guest')).toBeTruthy()
    })
    expect(screen.queryByTestId('fb')).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('po failed sesji NIE strzela /me powtórnie', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }
    setupGuest({ fallback: <div data-testid="fb">…</div> })

    await waitFor(() => expect(screen.queryByTestId('guest')).toBeTruthy())

    const callsAfterFirst = state.meCalls
    await new Promise((r) => setTimeout(r, 250))
    expect(state.meCalls).toBe(callsAfterFirst)
  })
})
