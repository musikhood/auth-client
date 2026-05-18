import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { createAuthClient, type AuthClient } from '../core/client.js'
import { AuthProvider } from './AuthProvider.js'
import { AuthBoundary } from './AuthBoundary.js'
import { BASE_URL, state } from '../test/server.js'

function setup(props: { onUnauthorized?: () => void; fallback?: React.ReactNode } = {}) {
  const client = createAuthClient({ baseUrl: BASE_URL })
  return render(
    <AuthProvider client={client}>
      <AuthBoundary fallback={props.fallback} onUnauthorized={props.onUnauthorized}>
        <div data-testid="protected">CHRONIONA ZAWARTOŚĆ</div>
      </AuthBoundary>
    </AuthProvider>,
  )
}

function setupGuest(props: {
  onAuthenticated?: () => void
  fallback?: React.ReactNode
  client?: AuthClient
}) {
  const client = props.client ?? createAuthClient({ baseUrl: BASE_URL })
  return {
    client,
    ...render(
      <AuthProvider client={client}>
        <AuthBoundary
          mode="guest"
          fallback={props.fallback}
          onAuthenticated={props.onAuthenticated}
        >
          <div data-testid="guest-content">FORMULARZ LOGOWANIA</div>
        </AuthBoundary>
      </AuthProvider>,
    ),
  }
}

describe('<AuthBoundary>', () => {
  it('podczas isLoading pokazuje fallback', async () => {
    setup({ fallback: <div data-testid="fb">Ładowanie...</div> })

    // Synchroniczny render — useMe jeszcze nie wrócił.
    expect(screen.getByTestId('fb')).toBeTruthy()
    // Children NIE są jeszcze renderowane.
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('po sukcesie /me renderuje children', async () => {
    setup({ fallback: <div data-testid="fb">…</div> })

    await waitFor(() => {
      expect(screen.getByTestId('protected')).toBeTruthy()
    })
    expect(screen.queryByTestId('fb')).toBeNull()
  })

  it('po failed /me + refresh fail woła onUnauthorized', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const onUnauthorized = vi.fn()
    setup({ fallback: <div data-testid="fb">…</div>, onUnauthorized })

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalled()
    })
    // Po nieudanym /me dalej pokazujemy fallback (nie children).
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('onUnauthorized wywoływany TYLKO RAZ przy failed sesji (brak pętli)', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const onUnauthorized = vi.fn()
    setup({ fallback: <div data-testid="fb">…</div>, onUnauthorized })

    await waitFor(() => {
      expect(onUnauthorized).toHaveBeenCalled()
    })
    // Daj czas żeby ewentualna pętla się pokazała (refetch + re-render).
    await new Promise((r) => setTimeout(r, 200))
    // Mimo upływu czasu: TYLKO jedno wywołanie. Bez ref guard byłoby N.
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('mode="guest" Z onAuthenticated — z ważną sesją woła callback', async () => {
    // me wraca 200 → user istnieje → guest mode redirectuje (przez callback).
    const onAuthenticated = vi.fn()
    setupGuest({ fallback: <div data-testid="fb">…</div>, onAuthenticated })

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledTimes(1)
    })
    // Children (formularz) NIE są pokazywane gdy user jest zalogowany.
    expect(screen.queryByTestId('guest-content')).toBeNull()
    // /me poszedł (sprawdzaliśmy sesję żeby zdecydować o redirect).
    expect(state.meCalls).toBeGreaterThan(0)
  })

  it('mode="guest" BEZ onAuthenticated — NIE strzela /me, formularz od razu', async () => {
    // Świadoma decyzja konsumenta: nie chcę sprawdzać czy user jest zalogowany.
    // Paczka NIE woła /me, renderuje children natychmiast.
    setupGuest({})

    // Formularz natychmiast (bez fallback).
    await waitFor(() => {
      expect(screen.queryByTestId('guest-content')).toBeTruthy()
    })
    // Krytyczne: zero requestów /me w guest-passive.
    await new Promise((r) => setTimeout(r, 100))
    expect(state.meCalls).toBe(0)
  })

  it('mode="guest" Z onAuthenticated — bez sesji renderuje formularz, NIE tkwi w spinnerze', async () => {
    // Po failed /me + refresh fail boundary musi pokazać formularz, nie spinner.
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const onAuthenticated = vi.fn()
    setupGuest({ fallback: <div data-testid="fb">spinner…</div>, onAuthenticated })

    await waitFor(() => {
      expect(screen.queryByTestId('guest-content')).toBeTruthy()
    })
    expect(screen.queryByTestId('fb')).toBeNull()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('mode="guest" Z onAuthenticated — po failed sesji NIE strzela powtórnie', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const onAuthenticated = vi.fn()
    setupGuest({ fallback: <div data-testid="fb">…</div>, onAuthenticated })

    await waitFor(() => {
      expect(screen.queryByTestId('guest-content')).toBeTruthy()
    })

    const meCallsAfterFirst = state.meCalls
    await new Promise((r) => setTimeout(r, 250))
    expect(state.meCalls).toBe(meCallsAfterFirst)
  })

  it('bez fallback i bez usera nie renderuje nic', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const { container } = setup({})

    await waitFor(() => {
      // Wszystkie testy nie mają children renderowanych bez sesji.
      expect(container.querySelector('[data-testid="protected"]')).toBeNull()
    })
  })
})
