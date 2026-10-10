// Behaviour of the generated 2FA code form (react-plain template, rendered directly).
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MfaCodeForm } from '../../templates/react-plain/components/auth/mfa-code-form'
import { MfaStepUpDialog } from '../../templates/react-plain/components/auth/mfa-step-up-dialog'
import { AuthProvider } from '../react.js'
import { createAuthClient } from '../core/client.js'
import { BASE_URL, state } from '../test/server.js'
import { formatRetryAfter, isAuthError, loginErrorMessage, mfaErrorMessage } from '@@/lib/mfa'
import {
  InvalidCredentialsError,
  MfaInvalidCodeError,
  MfaRequiredError,
  TooManyAttemptsError,
} from '../index.js'

const HINT = 'Po zalogowaniu skontaktuj się z administratorem, aby ponownie skonfigurować 2FA.'
const REMEMBER = 'Zapamiętaj to urządzenie na 30 dni'

function renderForm() {
  const onSubmit = vi.fn()
  render(
    <MfaCodeForm isPending={false} error={null} submitLabel="Zweryfikuj" onSubmit={onSubmit} />,
  )
  return { onSubmit }
}

describe('MfaCodeForm (template)', () => {
  it('kod TOTP: wysyła code + rememberDevice z checkboxa', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(screen.getByLabelText('Kod z aplikacji uwierzytelniającej'), {
      target: { value: '12a3456' },
    })
    fireEvent.click(screen.getByLabelText(REMEMBER))
    fireEvent.click(screen.getByRole('button', { name: 'Zweryfikuj' }))
    expect(onSubmit).toHaveBeenCalledWith({ code: '123456', rememberDevice: true })
  })

  it('kod zapasowy: ukrywa checkbox, pokazuje podpowiedź, zawsze rememberDevice=false', () => {
    const { onSubmit } = renderForm()
    fireEvent.click(screen.getByLabelText(REMEMBER))
    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu zapasowego' }))

    expect(screen.queryByLabelText(REMEMBER)).toBeNull()
    expect(screen.getByText(HINT)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Kod zapasowy'), { target: { value: 'abcde-12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zweryfikuj' }))
    expect(onSubmit).toHaveBeenCalledWith({ recoveryCode: 'abcde-12345', rememberDevice: false })
  })

  it('przełączenie trybu resetuje checkbox', () => {
    renderForm()
    fireEvent.click(screen.getByLabelText(REMEMBER))
    expect((screen.getByLabelText(REMEMBER) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu zapasowego' }))
    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu z aplikacji' }))
    expect((screen.getByLabelText(REMEMBER) as HTMLInputElement).checked).toBe(false)
  })
})

describe('MfaCodeForm (template) — zmiana trybu', () => {
  const props = { isPending: false, submitLabel: 'Zweryfikuj', onSubmit: () => {} }

  it('błąd poprzedniej próby znika po przełączeniu trybu; nowy błąd rodzica znów widać', () => {
    const { rerender } = render(<MfaCodeForm {...props} error="Nieprawidłowy kod." />)
    expect(screen.getByRole('alert').textContent).toBe('Nieprawidłowy kod.')

    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu zapasowego' }))
    expect(screen.queryByRole('alert')).toBeNull()

    // Parent clears the error before a new attempt, then reports the same text again.
    rerender(<MfaCodeForm {...props} error={null} />)
    rerender(<MfaCodeForm {...props} error="Nieprawidłowy kod." />)
    expect(screen.getByRole('alert').textContent).toBe('Nieprawidłowy kod.')
  })

  it('focus przechodzi na pole nowego trybu', () => {
    render(<MfaCodeForm {...props} error={null} />)
    expect(document.activeElement?.id).toBe('mfa-code')
    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu zapasowego' }))
    expect(document.activeElement?.id).toBe('mfa-recovery')
    fireEvent.click(screen.getByRole('button', { name: 'Użyj kodu z aplikacji' }))
    expect(document.activeElement?.id).toBe('mfa-code')
  })
})

describe('MfaStepUpDialog (template) — poza <AuthBoundary>', () => {
  it('403 mfa_step_up otwiera dialog bez boundary; logout go zamyka', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect: () => {} })
    render(
      <AuthProvider client={client}>
        <MfaStepUpDialog />
      </AuthProvider>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => {
      await client.me().catch(() => {})
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj się' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('lib/mfa (template)', () => {
  it('rozpoznaje błędy po nazwie, bez dziedziczenia', () => {
    const mfaRequired = new MfaRequiredError('t', ['totp'])
    expect(isAuthError(mfaRequired, 'MfaRequiredError')).toBe(true)
    expect(isAuthError(mfaRequired, 'InvalidCredentialsError')).toBe(false)
  })

  it('komunikaty', () => {
    expect(mfaErrorMessage(new MfaInvalidCodeError(undefined, undefined, 'reused'))).toContain(
      'już użyty',
    )
    expect(mfaErrorMessage(new Error('x'))).toBeNull()
    expect(loginErrorMessage(new InvalidCredentialsError())).toBe('Nieprawidłowy email lub hasło.')
    expect(loginErrorMessage(new TooManyAttemptsError(120))).toBe(formatRetryAfter(120))
    expect(formatRetryAfter(30)).toBe('Zbyt wiele prób. Spróbuj ponownie za 30 s.')
    expect(formatRetryAfter(null)).toBe('Zbyt wiele prób. Spróbuj ponownie później.')
  })
})
