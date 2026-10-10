import { describe, it, expect, vi } from 'vitest'
import { createAuthClient } from './client.js'
import {
  DeviceMismatchError,
  InvalidCredentialsError,
  LoginForbiddenError,
  MfaAlreadyEnabledError,
  MfaEnrollmentRequiredError,
  MfaInvalidCodeError,
  MfaRequiredError,
  MfaStepUpRequiredError,
  MfaTokenExpiredError,
  PanelAccessDeniedError,
  SessionExpiredError,
  TooManyAttemptsError,
} from './errors.js'
import { isAuthErrorNamed } from './errors.js'
import { BASE_URL, state } from '../test/server.js'

describe('isAuthErrorNamed — odporność na zduplikowane klasy w entry bundla', () => {
  it('rozpoznaje błąd z innej kopii klasy po name', () => {
    // Symulacja kopii klasy z innego entry (react.mjs / vue.mjs).
    class MfaStepUpRequiredErrorCopy extends Error {
      override name = 'MfaStepUpRequiredError'
    }
    const foreign = new MfaStepUpRequiredErrorCopy('x')
    expect(foreign).not.toBeInstanceOf(MfaStepUpRequiredError)
    expect(isAuthErrorNamed(foreign, 'MfaStepUpRequiredError')).toBe(true)
    expect(isAuthErrorNamed(new Error('x'), 'MfaStepUpRequiredError')).toBe(false)
    expect(isAuthErrorNamed('MfaStepUpRequiredError', 'MfaStepUpRequiredError')).toBe(false)
  })
})

function newClient(opts?: {
  loginPath?: string
  redirect?: (p: string) => void
  deviceFingerprint?: boolean
}) {
  return createAuthClient({ baseUrl: BASE_URL, ...opts })
}

const MFA_REQUIRED = {
  status: 401,
  body: {
    error: 'Wymagany kod',
    code: 'mfa_required',
    mfa_token: 'mfa-tok',
    methods: ['totp', 'recovery'],
  },
}

describe('login — kody 2FA', () => {
  it('401 bez `code` → InvalidCredentialsError jak w 2.1 (regresja)', async () => {
    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    const client = newClient()
    const err = await client.login({ username: 'x', password: 'y' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InvalidCredentialsError)
    expect(err).not.toBeInstanceOf(MfaRequiredError)
    expect(client.getMfaState().stage).toBe('idle')
  })

  it('401 mfa_required → MfaRequiredError (podklasa InvalidCredentialsError), stan code, event', async () => {
    state.loginResponse = MFA_REQUIRED
    const client = newClient()
    const onRequired = vi.fn()
    client.on('mfa-required', onRequired)

    const err = await client.login({ username: 'x', password: 'y' }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MfaRequiredError)
    expect(err).toBeInstanceOf(InvalidCredentialsError)
    expect((err as MfaRequiredError).mfaToken).toBe('mfa-tok')
    expect((err as MfaRequiredError).methods).toEqual(['totp', 'recovery'])
    expect(client.getMfaState()).toMatchObject({ stage: 'code', mfaToken: 'mfa-tok' })
    expect(onRequired).toHaveBeenCalledOnce()
    expect(state.refreshCalls).toBe(0)
  })

  it('403 mfa_enrollment_required → MfaEnrollmentRequiredError z URL', async () => {
    state.loginResponse = {
      status: 403,
      body: {
        error: 'Skonfiguruj 2FA',
        code: 'mfa_enrollment_required',
        enrollment_url: 'https://auth/setup-2fa?token=x',
      },
    }
    const client = newClient()
    const err = await client.login({ username: 'x', password: 'y' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MfaEnrollmentRequiredError)
    expect(err).toBeInstanceOf(LoginForbiddenError)
    expect((err as MfaEnrollmentRequiredError).enrollmentUrl).toBe('https://auth/setup-2fa?token=x')
    expect(client.getMfaState().stage).toBe('enrollment')
  })

  it('429 → TooManyAttemptsError z retryAfter', async () => {
    state.loginResponse = {
      status: 429,
      body: { error: 'Za dużo', code: 'too_many_attempts' },
      headers: { 'Retry-After': '120' },
    }
    const client = newClient()
    const err = await client.login({ username: 'x', password: 'y' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TooManyAttemptsError)
    expect((err as TooManyAttemptsError).retryAfter).toBe(120)
  })

  it('login wysyła device w body i X-Device-Fp', async () => {
    const client = newClient()
    await client.login({ username: 'x', password: 'y' })
    const captured = state.captured.login
    expect(captured?.body).toMatchObject({ username: 'x', password: 'y' })
    expect(captured?.body?.device).toBeTypeOf('object')
    expect(captured?.deviceFp).toMatch(/^[a-f0-9]{64}$/)
  })

  it('deviceFingerprint: false → body i nagłówki jak w 2.1', async () => {
    const client = newClient({ deviceFingerprint: false })
    await client.login({ username: 'x', password: 'y' })
    expect(state.captured.login?.body).toEqual({ username: 'x', password: 'y' })
    expect(state.captured.login?.deviceFp).toBeNull()
  })
})

describe('verifyMfa', () => {
  it('sukces → event login, stan idle, body w kontrakcie backendu', async () => {
    state.loginResponse = MFA_REQUIRED
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})
    const onLogin = vi.fn()
    client.on('login', onLogin)

    const tokens = await client.verifyMfa({
      mfaToken: 'mfa-tok',
      code: '123456',
      rememberDevice: true,
    })

    expect(tokens.token).toBe('jwt-token-abc')
    expect(onLogin).toHaveBeenCalledOnce()
    expect(client.getMfaState().stage).toBe('idle')
    expect(state.captured.loginMfa?.body).toMatchObject({
      mfa_token: 'mfa-tok',
      code: '123456',
      remember_device: true,
    })
    expect(state.captured.loginMfa?.body?.device).toBeTypeOf('object')
  })

  it('kod już użyty (mfa_code_reused) → MfaInvalidCodeError reason reused, bez refreshu', async () => {
    state.loginResponse = MFA_REQUIRED
    state.loginMfaResponse = {
      status: 401,
      body: { error: 'Ten kod został już użyty', code: 'mfa_code_reused' },
    }
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})

    const err = await client
      .verifyMfa({ mfaToken: 'mfa-tok', code: '123456' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MfaInvalidCodeError)
    expect((err as MfaInvalidCodeError).reason).toBe('reused')
    expect(client.getMfaState().stage).toBe('code')
    expect(state.refreshCalls).toBe(0)
  })

  it('zły kod → MfaInvalidCodeError, stan code zostaje, bez refreshu', async () => {
    state.loginResponse = MFA_REQUIRED
    state.loginMfaResponse = { status: 401, body: { error: 'Zły kod', code: 'mfa_invalid_code' } }
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})

    await expect(client.verifyMfa({ mfaToken: 'mfa-tok', code: '000000' })).rejects.toBeInstanceOf(
      MfaInvalidCodeError,
    )
    expect(client.getMfaState().stage).toBe('code')
    expect(state.refreshCalls).toBe(0)
  })

  it('wygasły token → MfaTokenExpiredError, powrót do idle', async () => {
    state.loginResponse = MFA_REQUIRED
    state.loginMfaResponse = { status: 401, body: { error: 'Wygasło', code: 'mfa_token_expired' } }
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})

    await expect(client.verifyMfa({ mfaToken: 'mfa-tok', code: '1' })).rejects.toBeInstanceOf(
      MfaTokenExpiredError,
    )
    expect(client.getMfaState().stage).toBe('idle')
  })
})

describe('/me i interceptor — step-up / enrollment / device', () => {
  it('403 mfa_step_up z /me → MfaStepUpRequiredError, event, BEZ redirectu i BEZ panelAccessDenied', async () => {
    state.meResponse = {
      status: 403,
      body: { status: 403, error: 'Wymagana weryfikacja', code: 'mfa_step_up' },
    }
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    const onStepUp = vi.fn()
    const onDenied = vi.fn()
    client.on('mfa-step-up-required', onStepUp)
    client.on('panel-access-denied', onDenied)

    await expect(client.me()).rejects.toBeInstanceOf(MfaStepUpRequiredError)
    await expect(client.me()).rejects.toBeInstanceOf(MfaStepUpRequiredError)

    expect(onStepUp).toHaveBeenCalledOnce()
    expect(onDenied).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    expect(client.isPanelAccessDenied()).toBe(false)
    expect(client.isSessionExpired()).toBe(false)
    expect(client.isMfaStepUpRequired()).toBe(true)
    expect(state.refreshCalls).toBe(0)
  })

  it('403 bez code z /me → PanelAccessDeniedError jak w 2.1 (regresja)', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu do tego panelu.' } }
    const client = newClient()
    await expect(client.me()).rejects.toBeInstanceOf(PanelAccessDeniedError)
    expect(client.getMfaState().stage).toBe('idle')
  })

  it('stepUpMfa → nowa sesja, stan idle, event login', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const client = newClient()
    await client.me().catch(() => {})
    const onLogin = vi.fn()
    client.on('login', onLogin)

    await client.stepUpMfa({ recoveryCode: 'abcde-fghjk' })

    expect(state.captured.sessionMfa?.body).toMatchObject({
      recovery_code: 'abcde-fghjk',
      remember_device: false,
    })
    expect(client.isMfaStepUpRequired()).toBe(false)
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('403 mfa_enrollment_required na zwykłym requeście → event bez URL, błąd jak w 2.1', async () => {
    const client = newClient()
    const onEnroll = vi.fn()
    client.on('mfa-enrollment-required', onEnroll)
    // Bramka per request nie zwraca już linku (wymaga hasła) — payload z null.
    state.meResponse = { status: 403, body: { code: 'mfa_enrollment_required' } }

    await expect(client.me()).rejects.toBeInstanceOf(MfaEnrollmentRequiredError)
    expect(onEnroll).toHaveBeenCalledWith({ enrollmentUrl: null })
    expect(client.getMfaState()).toMatchObject({ stage: 'enrollment', enrollmentUrl: null })
  })

  it('401 device_mismatch_recheck → zwykły refresh (z device) i retry', async () => {
    state.meQueue = [{ status: 401, body: { code: 'device_mismatch_recheck' } }]
    const client = newClient()

    const user = await client.me()

    expect(user.id).toBe('u-1')
    expect(state.refreshCalls).toBe(1)
    expect(state.captured.refresh?.body?.device).toBeTypeOf('object')
    expect(state.captured.refresh?.deviceFp).toMatch(/^[a-f0-9]{64}$/)
  })

  it('refresh 401 device_mismatch → DeviceMismatchError (podklasa SessionExpiredError) + unauthorized', async () => {
    state.meResponse = { status: 401, body: { error: 'expired' } }
    state.refreshResponse = { status: 401, body: { error: 'x', code: 'device_mismatch' } }
    const client = newClient()
    const onUnauthorized = vi.fn()
    client.on('unauthorized', onUnauthorized)

    const err = await client.me().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DeviceMismatchError)
    expect(err).toBeInstanceOf(SessionExpiredError)
    expect(onUnauthorized).toHaveBeenCalled()
  })

  it('każdy request niesie X-Device-Fp', async () => {
    const client = newClient()
    await client.me()
    expect(state.captured.me?.deviceFp).toMatch(/^[a-f0-9]{64}$/)
  })

  it('confirmMfaEnrollment: wysyła device, zwraca kody i sesję, emituje login', async () => {
    const client = newClient()
    const onLogin = vi.fn()
    client.on('login', onLogin)

    const res = await client.confirmMfaEnrollment({ enrollmentToken: 'enr', code: '123456' })

    expect(res.recoveryCodes).toEqual(['aaaaa-bbbbb'])
    expect(res.returnUrl).toBe('https://panel.example.com')
    expect(res.session?.token).toBeTypeOf('string')
    expect(onLogin).toHaveBeenCalledOnce()
    expect(state.captured.enrollmentConfirm?.body).toMatchObject({
      enrollment_token: 'enr',
      code: '123456',
    })
    expect(state.captured.enrollmentConfirm?.body?.device).toBeTypeOf('object')
  })

  it('confirmMfaEnrollment bez sesji (link bundla / stary serwer) → session null, bez eventu login', async () => {
    state.enrollmentConfirmResponse = {
      status: 200,
      body: { recovery_codes: ['x'], return_url: 'https://panel.example.com' },
    }
    const client = newClient()
    const onLogin = vi.fn()
    client.on('login', onLogin)

    const res = await client.confirmMfaEnrollment({ enrollmentToken: 'enr', code: '123456' })

    expect(res.session).toBeNull()
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('confirmMfaEnrollment: błędy kodu bez refreshu', async () => {
    const client = newClient()
    state.enrollmentConfirmResponse = {
      status: 401,
      body: { error: 'zły', code: 'mfa_invalid_code' },
    }
    const invalid = await client
      .confirmMfaEnrollment({ enrollmentToken: 'enr', code: '000000' })
      .catch((e: unknown) => e)
    expect(invalid).toBeInstanceOf(MfaInvalidCodeError)
    expect((invalid as MfaInvalidCodeError).reason).toBe('invalid')

    state.enrollmentConfirmResponse = {
      status: 401,
      body: { error: 'wygasł', code: 'mfa_token_expired' },
    }
    await expect(
      client.confirmMfaEnrollment({ enrollmentToken: 'enr', code: '000000' }),
    ).rejects.toBeInstanceOf(MfaTokenExpiredError)

    state.enrollmentConfirmResponse = {
      status: 409,
      body: { error: 'już', code: 'mfa_already_enabled' },
    }
    await expect(
      client.confirmMfaEnrollment({ enrollmentToken: 'enr', code: '000000' }),
    ).rejects.toBeInstanceOf(MfaAlreadyEnabledError)
    expect(state.refreshCalls).toBe(0)
  })

  it('requestMfaEnrollment wysyła hasło i zwraca URL', async () => {
    const client = newClient()
    await expect(client.requestMfaEnrollment({ password: 'pw' })).resolves.toBe(
      'https://auth.example.com/setup-2fa?token=t',
    )
    expect(state.captured.enrollmentRequest?.body).toEqual({ password: 'pw' })
  })

  it('requestMfaEnrollment: złe hasło → InvalidCredentialsError bez refreshu/wylogowania, 409, 429', async () => {
    const client = newClient()
    const onUnauthorized = vi.fn()
    client.on('unauthorized', onUnauthorized)

    state.enrollmentRequestResponse = {
      status: 401,
      body: { error: 'Nieprawidłowy login lub hasło.', code: 'invalid_credentials' },
    }
    await expect(client.requestMfaEnrollment({ password: 'x' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
    expect(state.refreshCalls).toBe(0)
    expect(onUnauthorized).not.toHaveBeenCalled()

    state.enrollmentRequestResponse = {
      status: 409,
      body: { error: 'już', code: 'mfa_already_enabled' },
    }
    await expect(client.requestMfaEnrollment({ password: 'x' })).rejects.toBeInstanceOf(
      MfaAlreadyEnabledError,
    )

    state.enrollmentRequestResponse = {
      status: 429,
      body: { code: 'too_many_attempts' },
      headers: { 'Retry-After': '60' },
    }
    const err = await client.requestMfaEnrollment({ password: 'x' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TooManyAttemptsError)
    expect((err as TooManyAttemptsError).retryAfter).toBe(60)
  })

  it('startMfaEnrollment bez URL (403 z bramki) rzuca — link wymaga hasła', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_enrollment_required' } }
    const client = newClient()
    await client.me().catch(() => {})
    expect(client.getMfaState()).toMatchObject({ stage: 'enrollment', enrollmentUrl: null })
    await expect(client.startMfaEnrollment()).rejects.toThrow(/requestMfaEnrollment/)
  })

  it('udany login z innej drogi (event login) kończy stan 2FA', async () => {
    state.loginResponse = MFA_REQUIRED
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})
    expect(client.getMfaState().stage).toBe('code')
    state.loginResponse = {
      status: 200,
      body: { token: 't', refresh_token: 'r', refresh_token_expiration: 1, token_expiration: 1 },
    }
    await client.login({ username: 'x', password: 'y' })
    expect(client.getMfaState().stage).toBe('idle')
  })
})

describe('reset stanu 2FA przy końcu sesji', () => {
  const STEP_UP = { status: 403, body: { code: 'mfa_step_up' } }
  const ENROLL = { status: 403, body: { code: 'mfa_enrollment_required' } }

  it.each([
    ['step-up', STEP_UP],
    ['enrollment', ENROLL],
  ])('%s → logout() → idle (event mfa-state-changed)', async (stage, response) => {
    state.meResponse = response
    const client = newClient()
    await client.me().catch(() => {})
    expect(client.getMfaState().stage).toBe(stage)
    const onState = vi.fn()
    client.on('mfa-state-changed', onState)

    await client.logout({ redirect: false })

    expect(client.getMfaState()).toEqual({
      stage: 'idle',
      mfaToken: null,
      methods: [],
      enrollmentUrl: null,
    })
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ stage: 'idle' }))
  })

  it('logout z błędem serwera też resetuje stan', async () => {
    state.meResponse = STEP_UP
    state.logoutResponse = { status: 500, body: { error: 'x' } }
    const client = newClient()
    await client.me().catch(() => {})

    await client.logout({ redirect: false }).catch(() => {})

    expect(client.getMfaState().stage).toBe('idle')
  })

  it('step-up → refresh fail (unauthorized) → idle', async () => {
    state.meResponse = STEP_UP
    const client = newClient()
    await client.me().catch(() => {})
    expect(client.getMfaState().stage).toBe('step-up')

    state.meResponse = { status: 401, body: { error: 'expired' } }
    state.refreshResponse = { status: 401, body: { error: 'expired' } }
    await client.me().catch(() => {})

    expect(client.getMfaState().stage).toBe('idle')
  })

  it('stage code (login) → zły kod nie resetuje, logout resetuje', async () => {
    state.loginResponse = MFA_REQUIRED
    state.loginMfaResponse = { status: 401, body: { code: 'mfa_invalid_code', error: 'x' } }
    const client = newClient()
    await client.login({ username: 'x', password: 'y' }).catch(() => {})
    await client.verifyMfa({ mfaToken: 'mfa-tok', code: '000000' }).catch(() => {})
    expect(client.getMfaState()).toMatchObject({ stage: 'code', mfaToken: 'mfa-tok' })

    await client.logout({ redirect: false })
    expect(client.getMfaState().stage).toBe('idle')
  })

  it('kolejne 403 mfa_step_up nie resetują stanu (bez eventu logout/unauthorized)', async () => {
    state.meResponse = STEP_UP
    const client = newClient()
    const onUnauthorized = vi.fn()
    client.on('unauthorized', onUnauthorized)
    await client.me().catch(() => {})
    await client.me().catch(() => {})
    expect(client.getMfaState().stage).toBe('step-up')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('logout w innej zakładce (broadcast) → idle', async () => {
    state.meResponse = STEP_UP
    const tabA = createAuthClient({ baseUrl: BASE_URL, broadcastSession: true })
    const tabB = createAuthClient({ baseUrl: BASE_URL, broadcastSession: true })
    await tabB.me().catch(() => {})
    expect(tabB.getMfaState().stage).toBe('step-up')

    await tabA.logout({ redirect: false })

    await vi.waitFor(() => expect(tabB.getMfaState().stage).toBe('idle'))
  })
})
