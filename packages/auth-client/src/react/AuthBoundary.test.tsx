import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

// Odtwarza topologię panelu RR7: WSPÓLNY QueryClient na całą apkę + przejście
// z chronionego boundary (/products) na guest boundary (/login) po 403. Cel:
// dowieść braku pętli /me i stabilnego lądowania na /login dla usera bez dostępu.
describe('<AuthBoundary> — 403 panel access denied (topologia panelu RR7)', () => {
  it('403 na chronionym → skończona liczba /me, redirect na loginPath raz, brak broadcastu', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu do tego panelu.' } }
    const redirect = vi.fn()
    const onLogout = vi.fn()
    const onUnauthorized = vi.fn()

    // Jeden klient + jeden QueryClient — jak w app/root.tsx (useState(() => new QueryClient())).
    const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect })
    client.on('logout', onLogout)
    client.on('unauthorized', onUnauthorized)
    const queryClient = new QueryClient()

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <AuthBoundary fallback={<div data-testid="fb">spinner</div>}>
            <div data-testid="protected">PRODUCTS</div>
          </AuthBoundary>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(redirect).toHaveBeenCalledWith('/login'))
    expect(screen.queryByTestId('protected')).toBeNull()
    expect(client.isPanelAccessDenied()).toBe(true)

    // Polling/retry zatrzymane — /me nie rośnie, redirect nie spirale.
    const meAfter = state.meCalls
    const redirectAfter = redirect.mock.calls.length
    await new Promise((r) => setTimeout(r, 300))
    expect(state.meCalls).toBe(meAfter)
    expect(redirect.mock.calls.length).toBe(redirectAfter)

    // KRYTYCZNE dla SSO cross-panel: 403 NIE wylogowuje globalnie.
    expect(onLogout).not.toHaveBeenCalled()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('po 403 guest boundary (/login) renderuje formularz i NIE strzela /me ponownie (wspólny klient/QueryClient)', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu.' } }
    const redirect = vi.fn()
    const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect })
    const queryClient = new QueryClient()

    // Faza 1: chroniony boundary dostaje 403 (jak /products).
    const protectedView = render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <AuthBoundary fallback={<div data-testid="fb">spinner</div>}>
            <div data-testid="protected">PRODUCTS</div>
          </AuthBoundary>
        </AuthProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(client.isPanelAccessDenied()).toBe(true))
    const meAfterProtected = state.meCalls
    protectedView.unmount()

    // Faza 2: ten sam klient + QueryClient, teraz guest boundary (jak /login po redirectcie).
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={client}>
          <AuthBoundary mode="guest" fallback={<div data-testid="fb">spinner</div>}>
            <div data-testid="login-form">FORMULARZ LOGOWANIA</div>
          </AuthBoundary>
        </AuthProvider>
      </QueryClientProvider>,
    )

    // Formularz logowania widoczny (nie spinner, nie pętla).
    await waitFor(() => expect(screen.queryByTestId('login-form')).toBeTruthy())

    // /me NIE poleciało ponownie na /login — panelAccessDenied wyłącza query.
    await new Promise((r) => setTimeout(r, 250))
    expect(state.meCalls).toBe(meAfterProtected)
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
