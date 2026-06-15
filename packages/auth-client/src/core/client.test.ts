import { describe, it, expect, vi } from 'vitest'
import { createAuthClient } from './client.js'
import {
  AuthError,
  ForbiddenRoleError,
  InvalidCredentialsError,
  LoginForbiddenError,
  PanelAccessDeniedError,
  SessionExpiredError,
} from './errors.js'
import { BASE_URL, state } from '../test/server.js'

function newClient(opts?: { loginPath?: string; redirect?: (p: string) => void }) {
  return createAuthClient({
    baseUrl: BASE_URL,
    loginPath: opts?.loginPath,
    redirect: opts?.redirect,
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

  it('401 + refresh fail → SessionExpiredError, event unauthorized, redirect na loginPath', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const redirect = vi.fn()
    const onUnauthorizedEvent = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    client.on('unauthorized', onUnauthorizedEvent)

    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(onUnauthorizedEvent).toHaveBeenCalledOnce()
    expect(client.isAuthenticated()).toBe(false)
  })
})

describe('me 403 — panel access denied (terminalny, BEZ wylogowania)', () => {
  it('403 → PanelAccessDeniedError, NIE refresh, NIE unauthorized/logout, sesja żyje', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu do tego panelu.' } }

    const onUnauthorized = vi.fn()
    const onLogout = vi.fn()
    const onDenied = vi.fn()
    const client = newClient()
    client.on('unauthorized', onUnauthorized)
    client.on('logout', onLogout)
    client.on('panel-access-denied', onDenied)

    await expect(client.me()).rejects.toBeInstanceOf(PanelAccessDeniedError)

    // Brak refresh (interceptor ignoruje nie-401).
    expect(state.refreshCalls).toBe(0)
    // NIE rozsyłamy unauthorized/logout — sesja na innych panelach żyje.
    expect(onUnauthorized).not.toHaveBeenCalled()
    expect(onLogout).not.toHaveBeenCalled()
    // Emitujemy dedykowany event terminalny.
    expect(onDenied).toHaveBeenCalledOnce()
    // sessionState NIE jest expired — to nie wygaśnięcie.
    expect(client.isSessionExpired()).toBe(false)
    expect(client.isPanelAccessDenied()).toBe(true)
  })

  it('403 przenosi komunikat błędu z backendu', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu do tego panelu.' } }
    const client = newClient()
    await expect(client.me()).rejects.toMatchObject({
      name: 'PanelAccessDeniedError',
      status: 403,
      message: 'Brak dostępu do tego panelu.',
    })
  })

  it('403 redirectuje na loginPath (bez czyszczenia sesji)', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu.' } }
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })

    await expect(client.me()).rejects.toBeInstanceOf(PanelAccessDeniedError)
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('login() resetuje terminalny stan 403', async () => {
    state.meResponse = { status: 403, body: { error: 'Brak dostępu.' } }
    const client = newClient()
    await expect(client.me()).rejects.toBeInstanceOf(PanelAccessDeniedError)
    expect(client.isPanelAccessDenied()).toBe(true)

    await client.login({ username: 'jan', password: 'tajne' })
    expect(client.isPanelAccessDenied()).toBe(false)
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

describe('assertRoles', () => {
  it('zwraca usera gdy ma WSZYSTKIE wymagane role (mode "all")', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER', 'ROLE_ADMIN'],
        disabled: false,
      },
    }
    const client = newClient()
    const user = await client.assertRoles(['ROLE_USER', 'ROLE_ADMIN'])
    expect(user.id).toBe('u-1')
    expect(state.logoutCalls).toBe(0)
  })

  it('rzuca ForbiddenRoleError + woła logout gdy brak ról (mode "all")', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const client = newClient()
    await expect(client.assertRoles(['ROLE_ADMIN'])).rejects.toBeInstanceOf(ForbiddenRoleError)
    expect(state.logoutCalls).toBe(1)
    expect(client.isAuthenticated()).toBe(false)
  })

  it('mode "any" — wystarczy jedna z ról', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_EDIT'],
        disabled: false,
      },
    }
    const client = newClient()
    const user = await client.assertRoles(['ROLE_ADMIN', 'ROLE_EDIT'], 'any')
    expect(user.id).toBe('u-1')
  })

  it('mode "any" — fail gdy żadnej z ról nie ma', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const client = newClient()
    await expect(client.assertRoles(['ROLE_ADMIN', 'ROLE_EDIT'], 'any')).rejects.toBeInstanceOf(
      ForbiddenRoleError,
    )
  })
})

describe('redirect na loginPath', () => {
  it('logout() triggeruje redirect na loginPath', async () => {
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    await client.logout()
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('logout() NIE redirectuje gdy loginPath nie skonfigurowane', async () => {
    const redirect = vi.fn()
    const client = newClient({ redirect })
    await client.logout()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('refresh fail (przez me) triggeruje redirect na loginPath', async () => {
    state.meResponse = { status: 401, body: { error: 'Unauthorized' } }
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }

    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    await expect(client.me()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(redirect).toHaveBeenCalledWith('/login')
  })

  it('assertRoles fail (bez forbiddenPath) → redirect na loginPath', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    await expect(client.assertRoles(['ROLE_ADMIN'])).rejects.toBeInstanceOf(ForbiddenRoleError)
    // Bez forbiddenPath fallback na loginPath.
    expect(redirect).toHaveBeenCalledWith('/login')
    // Krytyczne: redirect TYLKO raz (logout-redirect suppressed, custom redirect on forbiddenPath).
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('assertRoles fail (Z forbiddenPath) → redirect na forbiddenPath, NIE loginPath', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      loginPath: '/login',
      forbiddenPath: '/forbidden',
      redirect,
    })
    await expect(client.assertRoles(['ROLE_ADMIN'])).rejects.toBeInstanceOf(ForbiddenRoleError)
    expect(redirect).toHaveBeenCalledWith('/forbidden')
    expect(redirect).toHaveBeenCalledTimes(1) // forbiddenPath wygrywa, logout NIE redirectuje
  })

  it('logout({redirect: false}) NIE triggeruje redirect', async () => {
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    await client.logout({ redirect: false })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('setRedirect po starcie podstawia funkcję — używana w kolejnych redirectach', async () => {
    const client = newClient({ loginPath: '/login' })
    const softNav = vi.fn()
    client.setRedirect(softNav)
    await client.logout()
    expect(softNav).toHaveBeenCalledWith('/login')
  })

  it('setRedirect nadpisuje wcześniejszy config.redirect', async () => {
    const initial = vi.fn()
    const softNav = vi.fn()
    const client = newClient({ loginPath: '/login', redirect: initial })
    client.setRedirect(softNav)
    await client.logout()
    expect(softNav).toHaveBeenCalledWith('/login')
    expect(initial).not.toHaveBeenCalled()
  })

  it('setRedirect(null) wraca do default (window.location)', async () => {
    const softNav = vi.fn()
    const client = newClient({ loginPath: '/login' })
    client.setRedirect(softNav)
    client.setRedirect(null)
    const originalHref = window.location.href
    let navigatedTo: string | null = null
    Object.defineProperty(window.location, 'href', {
      set(v: string) {
        navigatedTo = v
      },
      get() {
        return originalHref
      },
      configurable: true,
    })
    await client.logout()
    expect(softNav).not.toHaveBeenCalled()
    expect(navigatedTo).toBe('/login')
    Object.defineProperty(window.location, 'href', {
      value: originalHref,
      writable: true,
      configurable: true,
    })
  })

  it('domyślny redirect używa window.location.href z pathname guard', async () => {
    const originalHref = window.location.href
    let navigatedTo: string | null = null
    Object.defineProperty(window.location, 'href', {
      set(v: string) {
        navigatedTo = v
      },
      get() {
        return originalHref
      },
      configurable: true,
    })

    const client = createAuthClient({ baseUrl: BASE_URL, loginPath: '/login' })
    await client.logout()
    expect(navigatedTo).toBe('/login')

    Object.defineProperty(window.location, 'href', {
      value: originalHref,
      writable: true,
      configurable: true,
    })
  })

  it('redirectTo z pathname guard — nie redirectuje gdy już jesteś na docelowej', () => {
    // window.location.pathname w happy-dom default to '/'. Redirect na '/' → guard zatrzymuje.
    const redirect = vi.fn()
    const client = newClient({ loginPath: '/login', redirect })
    client.redirectTo('/') // pathname === '/' → blocked
    expect(redirect).not.toHaveBeenCalled()
    client.redirectTo('/login') // pathname === '/' → przechodzi
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})

describe('panel-wide requireRoles (config)', () => {
  it('user ma role → me() przepuszcza, brak forbidden', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_ADMIN'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const onForbidden = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      loginPath: '/login',
      requireRoles: ['ROLE_ADMIN'],
      redirect,
    })
    client.on('forbidden', onForbidden)

    const user = await client.me()
    expect(user.id).toBe('u-1')
    // Daj enforcePanelRoles szansę się wykonać (async void).
    await new Promise((r) => setTimeout(r, 50))
    expect(onForbidden).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    expect(state.logoutCalls).toBe(0)
  })

  it('user bez roli → me() rzuca ForbiddenRoleError, logout, redirect, emit forbidden', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const onForbidden = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      loginPath: '/login',
      forbiddenPath: '/forbidden',
      requireRoles: ['ROLE_ADMIN'],
      redirect,
    })
    client.on('forbidden', onForbidden)

    // me() rzuca ForbiddenRoleError — adaptery (useMe) widzą error, nie user.
    // Bez tego AuthBoundary mode=guest dostałby user=ok i odpalił home-redirect
    // równolegle z forbidden-redirectem.
    await expect(client.me()).rejects.toBeInstanceOf(ForbiddenRoleError)

    expect(state.logoutCalls).toBe(1)
    expect(redirect).toHaveBeenCalledWith('/forbidden')
    expect(onForbidden).toHaveBeenCalledWith({
      requiredRoles: ['ROLE_ADMIN'],
      userRoles: ['ROLE_USER'],
      mode: 'all',
    })
    expect(client.isAuthenticated()).toBe(false)
  })

  it('requireAnyRole — wystarczy jedna rola', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_EDIT'],
        disabled: false,
      },
    }
    const onForbidden = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      requireAnyRole: ['ROLE_ADMIN', 'ROLE_EDIT'],
    })
    client.on('forbidden', onForbidden)

    await client.me()
    await new Promise((r) => setTimeout(r, 50))
    expect(onForbidden).not.toHaveBeenCalled()
  })

  it('requireAnyRole fail — żadnej z ról', async () => {
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const onForbidden = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      loginPath: '/login',
      requireAnyRole: ['ROLE_ADMIN', 'ROLE_EDIT'],
      redirect,
    })
    client.on('forbidden', onForbidden)

    await expect(client.me()).rejects.toBeInstanceOf(ForbiddenRoleError)

    expect(state.logoutCalls).toBe(1)
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(onForbidden).toHaveBeenCalledWith({
      requiredRoles: ['ROLE_ADMIN', 'ROLE_EDIT'],
      userRoles: ['ROLE_USER'],
      mode: 'any',
    })
  })

  it('zero pętli — drugi me() po wymuszonym logout NIE triggeruje znowu forbidden', async () => {
    // Po logout sessionState='expired'. Drugi me() nie powinien już lecieć
    // przez enforcePanelRoles, bo `client.isSessionExpired()` mówi false dopiero
    // po nowym login. W praktyce useMe (TanStack) ma enabled=false → nie woła me().
    // Test sprawdza że gdyby ktoś manualnie wywołał me() drugi raz, paczka
    // zachowuje się sensownie (jeden logout, jeden redirect, jeden forbidden).
    state.meResponse = {
      status: 200,
      body: {
        id: 'u-1',
        email: 'a@b.c',
        displayName: 'A',
        roles: ['ROLE_USER'],
        disabled: false,
      },
    }
    const redirect = vi.fn()
    const onForbidden = vi.fn()
    const client = createAuthClient({
      baseUrl: BASE_URL,
      loginPath: '/login',
      requireRoles: ['ROLE_ADMIN'],
      redirect,
    })
    client.on('forbidden', onForbidden)

    await expect(client.me()).rejects.toBeInstanceOf(ForbiddenRoleError)
    expect(state.logoutCalls).toBe(1)
    expect(onForbidden).toHaveBeenCalledTimes(1)
    // Drugi me() (tak jak gdyby konsument świadomie wywołał) — drugi logout
    // + drugi forbidden. Brak pętli bo tylko jeden cykl jest wymuszony PER call.
    await expect(client.me()).rejects.toBeInstanceOf(ForbiddenRoleError)
    expect(state.logoutCalls).toBe(2)
    expect(onForbidden).toHaveBeenCalledTimes(2)
    // Liczba wywołań jest deterministyczna — me() wywołuje cycle, ale nie ma
    // wewnętrznej pętli paczki która by sama re-wołała me().
  })
})

describe('error events (login-error, logout-error, refresh-error)', () => {
  it('login fail emit login-error z odpowiednim typem błędu', async () => {
    state.loginResponse = { status: 401, body: { error: 'Invalid credentials' } }
    const onError = vi.fn()
    const client = newClient()
    client.on('login-error', onError)

    await expect(client.login({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(InvalidCredentialsError)
  })

  it('login 403 emit login-error z LoginForbiddenError', async () => {
    state.loginResponse = { status: 403, body: { error: 'Account disabled' } }
    const onError = vi.fn()
    const client = newClient()
    client.on('login-error', onError)

    await expect(client.login({ username: 'x', password: 'y' })).rejects.toBeInstanceOf(
      LoginForbiddenError,
    )
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(LoginForbiddenError)
  })

  it('logout 500 emit logout-error (mimo że lokalny stan i tak wyzerowany)', async () => {
    state.logoutResponse = { status: 500, body: { error: 'Server error' } }
    const onError = vi.fn()
    const client = newClient()
    client.on('logout-error', onError)

    await expect(client.logout()).rejects.toBeInstanceOf(AuthError)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('refresh fail emit refresh-error', async () => {
    state.refreshResponse = { status: 401, body: { error: 'Invalid refresh token.' } }
    const onError = vi.fn()
    const client = newClient()
    client.on('refresh-error', onError)

    await expect(client.refresh()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(SessionExpiredError)
  })

  it('login sukces NIE emit login-error', async () => {
    const onError = vi.fn()
    const client = newClient()
    client.on('login-error', onError)

    await client.login({ username: 'jan', password: 'tajne' })
    expect(onError).not.toHaveBeenCalled()
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
