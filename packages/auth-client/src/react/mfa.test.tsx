import { describe, it, expect, vi } from 'vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createAuthClient } from '../core/client.js'
import { MfaRequiredError } from '../core/errors.js'
import { AuthProvider } from './AuthProvider.js'
import { AuthBoundary } from './AuthBoundary.js'
import { useAuth } from './useAuth.js'
import { useMfa } from './useMfa.js'
import { BASE_URL, state } from '../test/server.js'

describe('<AuthBoundary> — step-up 2FA', () => {
  it('403 mfa_step_up z /me: brak redirectu na login, skończona liczba /me, event raz', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up', error: 'Wymagana weryfikacja' } }
    const redirect = vi.fn()
    const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect })
    const onStepUp = vi.fn()
    client.on('mfa-step-up-required', onStepUp)

    render(
      <AuthProvider client={client}>
        <AuthBoundary fallback={<div data-testid="fallback">…</div>}>
          <div data-testid="protected">CHRONIONA</div>
        </AuthBoundary>
      </AuthProvider>,
    )

    await waitFor(() => expect(onStepUp).toHaveBeenCalledOnce())
    const callsAfterStepUp = state.meCalls
    await new Promise((r) => setTimeout(r, 300))

    expect(state.meCalls).toBe(callsAfterStepUp)
    expect(state.meCalls).toBeLessThanOrEqual(2)
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByTestId('fallback')).toBeTruthy()

    // Po udanym step-upie /me wraca i boundary renderuje treść.
    state.meResponse = {
      status: 200,
      body: { id: 'u-1', email: 'a@b.pl', displayName: null, roles: [], disabled: false },
    }
    // Realne opóźnienie sieci — bez niego React zbatchowałby przejście i nie
    // byłoby widać chwilowego user=null.
    state.meDelayMs = 150
    await act(async () => {
      await client.stepUpMfa({ code: '123456' })
    })
    await waitFor(() => expect(screen.getByTestId('protected')).toBeTruthy())
    // Brak chwilowego przekierowania na login po udanym step-upie.
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('useMfa (React)', () => {
  function wrapper({ children }: { children: ReactNode }) {
    const client = createAuthClient({ baseUrl: BASE_URL })
    return <AuthProvider client={client}>{children}</AuthProvider>
  }

  it('login → stage code → verify({ code }) bierze mfaToken ze stanu → idle', async () => {
    state.loginResponse = {
      status: 401,
      body: {
        code: 'mfa_required',
        mfa_token: 'tok-1',
        methods: ['totp', 'recovery'],
        error: 'kod',
      },
    }
    const { result } = renderHook(() => ({ auth: useAuth(), mfa: useMfa() }), { wrapper })

    await act(async () => {
      const err = await result.current.auth
        .login({ username: 'a', password: 'b' })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(MfaRequiredError)
    })
    await waitFor(() => expect(result.current.mfa.stage).toBe('code'))
    expect(result.current.mfa.mfaToken).toBe('tok-1')
    expect(result.current.mfa.methods).toEqual(['totp', 'recovery'])

    await act(async () => {
      await result.current.mfa.verify({ code: '654321', rememberDevice: true })
    })
    expect(state.captured.loginMfa?.body).toMatchObject({
      mfa_token: 'tok-1',
      code: '654321',
      remember_device: true,
    })
    await waitFor(() => expect(result.current.mfa.stage).toBe('idle'))
  })

  it('requestEnrollment(password) wysyła hasło i zwraca link', async () => {
    const { result } = renderHook(() => useMfa(), { wrapper })
    let url: string | undefined
    await act(async () => {
      url = await result.current.requestEnrollment('my-password')
    })
    expect(url).toBe('https://auth.example.com/setup-2fa?token=t')
    expect(state.captured.enrollmentRequest?.body).toEqual({ password: 'my-password' })
  })

  it('verify bez oczekującego challenge → błąd, bez requestu', async () => {
    const { result } = renderHook(() => useMfa(), { wrapper })
    await act(async () => {
      await expect(result.current.verify({ code: '1' })).rejects.toThrow(/No pending MFA/)
    })
    expect(state.captured.loginMfa).toBeUndefined()
  })

  it('step-up → logout() → stage idle (dialogi znikają bez odświeżenia)', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const client = createAuthClient({ baseUrl: BASE_URL })
    const { result } = renderHook(() => useMfa(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    })
    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(result.current.stage).toBe('step-up'))

    await act(async () => {
      await client.logout({ redirect: false })
    })
    await waitFor(() => expect(result.current.stage).toBe('idle'))
  })

  it('enrollment → refresh fail → stage idle', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_enrollment_required' } }
    const client = createAuthClient({ baseUrl: BASE_URL })
    const { result } = renderHook(() => useMfa(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <AuthProvider client={client}>{children}</AuthProvider>
      ),
    })
    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(result.current.stage).toBe('enrollment'))

    state.meResponse = { status: 401, body: { error: 'expired' } }
    state.refreshResponse = { status: 401, body: { error: 'expired' } }
    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(result.current.stage).toBe('idle'))
  })
})
