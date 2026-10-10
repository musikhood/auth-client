/* eslint-disable react-hooks/rules-of-hooks -- Vue setup(), not a React component */
import { describe, it, expect } from 'vitest'
import { computed, defineComponent, h, type ComputedRef } from 'vue'
import { render, waitFor } from '@testing-library/vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient, type AuthClient } from '../core/client.js'
import { createAuth } from './plugin.js'
import { AuthBoundary } from './AuthBoundary.js'
import { useAuth } from './useAuth.js'
import { useMfa } from './useMfa.js'
import { BASE_URL, state } from '../test/server.js'

// Regression (2.3.0, Vue panel pilot): global 2FA dialogs rendered in App.vue — outside
// <AuthBoundary> — never opened. useAuth() reads the boundary mode via inject(), which is
// null there, so isAuthenticated was always false and `isAuthenticated && stage` never
// became true. Outside a boundary useAuth() now reflects the client's session.

type Captured = {
  auth: ReturnType<typeof useAuth>
  // Condition used by the 2.3.0 templates and by existing React Router 7 panels.
  legacyStepUpOpen: ComputedRef<boolean>
}

function mount(options: { withBoundary?: boolean } = {}): {
  client: AuthClient
  global: () => Captured
} {
  let captured: Captured | null = null
  const GlobalDialogs = defineComponent({
    setup() {
      const auth = useAuth()
      const mfa = useMfa()
      captured = {
        auth,
        legacyStepUpOpen: computed(
          () => auth.isAuthenticated.value && mfa.stage.value === 'step-up',
        ),
      }
      return () => h('div', 'dialogs')
    },
  })
  const Root = defineComponent({
    setup: () => () => [
      options.withBoundary
        ? h(AuthBoundary, null, {
            default: () => h('div', 'protected'),
            fallback: () => h('div', 'loading'),
          })
        : null,
      h(GlobalDialogs),
    ],
  })
  const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', redirect: () => {} })
  render(Root, { global: { plugins: [VueQueryPlugin, createAuth(client)] } })
  return {
    client,
    global: () => {
      if (!captured) throw new Error('not mounted')
      return captured
    },
  }
}

describe('useAuth (Vue) — poza <AuthBoundary>', () => {
  it('step-up bez znanego usera (świeża sesja SSO) → isAuthenticated=true, dialog się otwiera', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const { client, global } = mount()
    expect(global().auth.isAuthenticated.value).toBe(false)

    await client.me().catch(() => {})
    await waitFor(() => expect(global().legacyStepUpOpen.value).toBe(true))
    expect(global().auth.isAuthenticated.value).toBe(true)
    expect(global().auth.user.value).toBeNull()
  })

  it('step-up → logout → isAuthenticated=false, dialog zamknięty', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const { client, global } = mount()
    await client.me().catch(() => {})
    await waitFor(() => expect(global().legacyStepUpOpen.value).toBe(true))

    await client.logout({ redirect: false })
    await waitFor(() => expect(global().legacyStepUpOpen.value).toBe(false))
    expect(global().auth.isAuthenticated.value).toBe(false)
  })

  it('obok boundary: widzi usera z cache /me, sam nie woła /me', async () => {
    const { global } = mount({ withBoundary: true })
    await waitFor(() => expect(global().auth.isAuthenticated.value).toBe(true))
    expect(global().auth.user.value).toMatchObject({ id: 'u-1' })
    // Only the boundary polls /me — one call, no extra observer from the global component.
    expect(state.meCalls).toBe(1)
  })

  it('bez sesji: isAuthenticated=false, /me nie leci', async () => {
    const { global } = mount()
    await new Promise((r) => setTimeout(r, 50))
    expect(global().auth.isAuthenticated.value).toBe(false)
    expect(global().auth.user.value).toBeNull()
    expect(state.meCalls).toBe(0)
  })
})
