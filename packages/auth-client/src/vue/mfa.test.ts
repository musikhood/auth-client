/* eslint-disable react-hooks/rules-of-hooks -- Vue setup(), not a React component */
import { describe, it, expect } from 'vitest'
import { defineComponent, h } from 'vue'
import { render, waitFor } from '@testing-library/vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient, type AuthClient } from '../core/client.js'
import { createAuth } from './plugin.js'
import { useMfa, type UseMfaReturn } from './useMfa.js'
import { BASE_URL, state } from '../test/server.js'

function mountMfa(): { client: AuthClient; mfa: () => UseMfaReturn } {
  let captured: UseMfaReturn | null = null
  const Comp = defineComponent({
    setup() {
      captured = useMfa()
      return () => h('div', 'mfa')
    },
  })
  const client = createAuthClient({ baseUrl: BASE_URL })
  render(Comp, { global: { plugins: [VueQueryPlugin, createAuth(client)] } })
  return {
    client,
    mfa: () => {
      if (!captured) throw new Error('not mounted')
      return captured
    },
  }
}

describe('useMfa (Vue)', () => {
  it('reaguje na stan klienta i weryfikuje kod z tokenem ze stanu', async () => {
    state.loginResponse = {
      status: 401,
      body: { code: 'mfa_required', mfa_token: 'v-tok', methods: ['totp'] },
    }
    const { client, mfa } = mountMfa()

    await client.login({ username: 'a', password: 'b' }).catch(() => {})
    expect(mfa().stage.value).toBe('code')
    expect(mfa().mfaToken.value).toBe('v-tok')

    await mfa().verify({ code: '111222' })
    expect(state.captured.loginMfa?.body).toMatchObject({ mfa_token: 'v-tok', code: '111222' })
    await waitFor(() => expect(mfa().stage.value).toBe('idle'))
  })

  it('403 mfa_step_up → stage step-up, stepUp() → idle', async () => {
    state.meResponse = { status: 403, body: { code: 'mfa_step_up' } }
    const { client, mfa } = mountMfa()
    await client.me().catch(() => {})
    expect(mfa().stage.value).toBe('step-up')

    await mfa().stepUp({ code: '123123' })
    expect(mfa().stage.value).toBe('idle')
  })
})
