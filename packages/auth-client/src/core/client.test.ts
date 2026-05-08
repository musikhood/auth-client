import { describe, it, expect, vi } from 'vitest'
import { createAuthClient } from './client.js'
import { InvalidCredentialsError, LoginForbiddenError, SessionExpiredError } from './errors.js'
import { BASE_URL, state } from '../test/server.js'

function newClient(opts?: { onUnauthorized?: () => void }) {
  return createAuthClient({
    baseUrl: BASE_URL,
    onUnauthorized: opts?.onUnauthorized,
  })
}

describe('createAuthClient', () => {
  it('rzuca przy braku baseUrl', () => {
    expect(() => createAuthClient({ baseUrl: '' })).toThrow(/baseUrl/)
  })
})

describe('login', () => {
  it('200 → zwraca tokeny i emituje login', async () => {
    const client = newClient()
    const onLogin = vi.fn()
    client.on('login', onLogin)

    const tokens = await client.login({ username: 'jan', password: 'tajne' })

    expect(tokens.token).toBe('jwt-token-abc')
    expect(state.loginCalls).toBe(1)
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('401 → InvalidCredentialsError', async () => {
    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    const client = newClient()
    await expect(client.login({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
  })

  it('403 → LoginForbiddenError', async () => {
    state.loginResponse = { status: 403, body: { error: 'Account disabled' } }
    const client = newClient()
    await expect(client.login({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      LoginForbiddenError,
    )
  })

  it('401 z /login NIE odpala refreshu', async () => {
    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    const client = newClient()
    await expect(client.login({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
    expect(state.refreshCalls).toBe(0)
  })
})

describe('me', () => {
  it('200 → zwraca usera, isAuthenticated = true, emituje user-changed', async () => {
    const client = newClient()
    const onChange = vi.fn()
    client.on('user-changed', onChange)

    const user = await client.me()

    expect(user.id).toBe('u-1')
    expect(client.isAuthenticated()).toBe(true)
    expect(client.getCachedUser()?.id).toBe('u-1')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-1' }))
  })

  it('401 → próbuje refresh, jeśli OK to retry i zwraca usera', async () => {
    let firstCall = true
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    // Po refreshu kolejne /me ma zwrócić sukces.
    const client = newClient()
    // Manualnie podmieniamy handler raz: pierwsze /me 401, drugie 200.
    const { server } = await import('../test/server.js')
    const { http, HttpResponse } = await import('msw')
    server.use(
      http.get(`${BASE_URL}/api/v1/user/me`, () => {
        if (firstCall) {
          firstCall = false
          return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return HttpResponse.json(
          {
            id: 'u-1',
            email: 'user@example.com',
            displayName: 'Jan',
            roles: [],
            disabled: false,
          },
          { status: 200 },
        )
      }),
    )

    const user = await client.me()
    expect(user.id).toBe('u-1')
    expect(state.refreshCalls).toBe(1)
  })

  it('401 + refresh fail → SessionExpiredError, event unauthorized, onUnauthorized', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const onUnauthorized = vi.fn()
    const onUnauthorizedEvent = vi.fn()
    const client = newClient({ onUnauthorized })
    client.on('unauthorized', onUnauthorizedEvent)

    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    expect(onUnauthorizedEvent).toHaveBeenCalledOnce()
    expect(client.isAuthenticated()).toBe(false)
  })
})

describe('logout', () => {
  it('200 → czyści cache, emituje logout', async () => {
    const client = newClient()
    await client.me()
    expect(client.isAuthenticated()).toBe(true)

    const onLogout = vi.fn()
    client.on('logout', onLogout)

    await client.logout()
    expect(client.isAuthenticated()).toBe(false)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('idempotent — gdy backend zwróci 200 bez sesji też emituje logout', async () => {
    const client = newClient()
    const onLogout = vi.fn()
    client.on('logout', onLogout)

    await client.logout()
    await client.logout()
    expect(onLogout).toHaveBeenCalledTimes(2)
    expect(state.logoutCalls).toBe(2)
  })
})

describe('refresh lock', () => {
  it('N równoległych 401 wywołuje TYLKO JEDEN refresh', async () => {
    state.refreshDelayMs = 30
    let meCalls = 0
    const { server } = await import('../test/server.js')
    const { http, HttpResponse } = await import('msw')
    server.use(
      http.get(`${BASE_URL}/api/v1/user/me`, () => {
        meCalls += 1
        if (meCalls <= 5) {
          return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        return HttpResponse.json(
          {
            id: 'u-1',
            email: 'a@b.c',
            displayName: 'X',
            roles: [],
            disabled: false,
          },
          { status: 200 },
        )
      }),
    )

    const client = newClient()
    // Pięć równoległych żądań. Wszystkie dostaną 401, wszystkie wezmą udział
    // w pojedynczym refreshu, wszystkie zostaną retry'owane.
    const results = await Promise.all([
      client.me(),
      client.me(),
      client.me(),
      client.me(),
      client.me(),
    ])
    expect(results).toHaveLength(5)
    expect(state.refreshCalls).toBe(1)
  })
})

describe('events', () => {
  it('on() zwraca unsubscribe które działa', async () => {
    const client = newClient()
    const handler = vi.fn()
    const off = client.on('user-changed', handler)
    await client.me()
    expect(handler).toHaveBeenCalledOnce()
    off()
    handler.mockClear()
    await client.logout()
    // logout emituje user-changed=null, ale my już odpięci.
    expect(handler).not.toHaveBeenCalled()
  })
})
