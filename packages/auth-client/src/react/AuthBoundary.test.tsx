import { describe, it, expect, vi } from 'vitest'
import { render, waitFor, screen } from '@testing-library/react'
import { createAuthClient } from '../core/client.js'
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
