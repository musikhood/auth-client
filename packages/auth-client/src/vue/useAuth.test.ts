import { describe, it, expect } from 'vitest'
import { defineComponent, h, provide } from 'vue'
import { render, waitFor } from '@testing-library/vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuthClient } from '../core/client.js'
import { createAuth } from './plugin.js'
import { AuthBoundary } from './AuthBoundary.js'
import { useAuth } from './useAuth.js'
import { AUTH_PROTECTED_KEY } from './key.js'
import { BASE_URL, state } from '../test/server.js'

// Regresja na bug: AuthBoundary robił provide() i w tym samym setupie czytał
// go przez inject() w useAuth — a w Vue provide NIE jest widoczne dla inject
// w tym samym komponencie (tylko dla potomków). Skutek: boundary'owy useAuth
// dostawał mode=null → enabled=false → /me nigdy nie leciało → wieczny fallback.
// Adapter Vue nie miał żadnych testów, dlatego to przeszło.
//
// Uwaga: w tym środowisku testowym (happy-dom) reaktywność vue-query nie
// flushuje do DOM, więc nie asertujemy renderu — sprawdzamy obserwowalny
// kontrakt: (1) potomek widzi wstrzyknięty mode, (2) /me FAKTYCZNIE leci.

function mountWithBoundary(mode: 'protected' | 'guest') {
  const Child = defineComponent({
    setup() {
      useAuth()
      return () => h('div', 'child')
    },
  })
  const Root = defineComponent({
    setup: () => () =>
      h(AuthBoundary, { mode }, { default: () => h(Child), fallback: () => h('div', 'loading…') }),
  })
  const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login', homePath: '/' })
  render(Root, { global: { plugins: [VueQueryPlugin, createAuth(client)] } })
  return { client }
}

describe('AuthBoundary (Vue) — provide/inject + /me', () => {
  it('protected: boundary woła /me (enabled=true mimo provide w tym samym setupie)', async () => {
    mountWithBoundary('protected')
    await waitFor(() => expect(state.meCalls).toBeGreaterThan(0))
  })

  it('guest: boundary woła /me (guest-checking sprawdza czy jest sesja)', async () => {
    mountWithBoundary('guest')
    await waitFor(() => expect(state.meCalls).toBeGreaterThan(0))
  })

  it('useAuth() bez override czyta mode przez inject od PRZODKA (ścieżka konsumenta)', async () => {
    // Potomek pod komponentem, który provide-uje 'protected'. To ścieżka, której
    // używają komponenty w slotach boundary — inject działa bo provide jest u przodka.
    const Child = defineComponent({
      setup() {
        useAuth()
        return () => h('div', 'child')
      },
    })
    const Provider = defineComponent({
      setup(_, { slots }) {
        provide(AUTH_PROTECTED_KEY, 'protected')
        return () => slots.default?.()
      },
    })
    const Root = defineComponent({
      setup: () => () => h(Provider, null, { default: () => h(Child) }),
    })
    const client = createAuthClient({ baseUrl: BASE_URL })
    render(Root, { global: { plugins: [VueQueryPlugin, createAuth(client)] } })
    await waitFor(() => expect(state.meCalls).toBeGreaterThan(0))
  })
})
