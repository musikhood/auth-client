import { describe, it, expect } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createAuthClient, type AuthClient } from '../core/client.js'
import { AuthProvider } from './AuthProvider.js'
import { AuthBoundary } from './AuthBoundary.js'
import { useAuth } from './useAuth.js'
import { useMfa } from './useMfa.js'
import { BASE_URL, state } from '../test/server.js'

// Regression (2.3.0, Vue panel pilot): a global 2FA dialog rendered next to the router
// outlet — outside <AuthBoundary>, as in existing React Router 7 panels (root.tsx) — gated on
// `isAuthenticated && stage === 'step-up'` never opened: outside a boundary useAuth()
// returned isAuthenticated=false unconditionally.

// Same gating as existing panels' `mfa-step-up-dialog.tsx` and the 2.3.0 templates.
function LegacyStepUpDialog() {
  const { isAuthenticated } = useAuth()
  const mfa = useMfa()
  return isAuthenticated && mfa.stage === 'step-up' ? <div role="dialog">STEP-UP</div> : null
}

function Status() {
  const { isAuthenticated, user } = useAuth()
  return (
    <div data-testid="status">{isAuthenticated ? `auth:${user?.id ?? 'unknown'}` : 'anon'}</div>
  )
}

function setup(withBoundary: boolean): AuthClient {
  const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect: () => {} })
  render(
    <AuthProvider client={client}>
      {withBoundary ? (
        <AuthBoundary fallback={<div>loading</div>}>
          <div data-testid="protected">CHRONIONA</div>
        </AuthBoundary>
      ) : null}
      <LegacyStepUpDialog />
      <Status />
    </AuthProvider>,
  )
  return client
}

describe('useAuth (React) — poza <AuthBoundary>', () => {
  it('step-up bez znanego usera (świeża sesja SSO) → dialog się otwiera', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const client = setup(false)
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByTestId('status').textContent).toBe('auth:unknown')
  })

  it('topologia paneli RR7: boundary w layoucie + dialog w root → step-up otwiera dialog', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    setup(true)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('obok boundary: widzi usera z cache /me; logout zamyka sesję', async () => {
    const client = setup(true)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('auth:u-1'))
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      await client.logout({ redirect: false })
    })
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('anon'))
  })

  it('step-up → logout → dialog zamknięty', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const client = setup(false)
    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    await act(async () => {
      await client.logout({ redirect: false })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
