import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const BASE_URL = 'https://auth.example.com'

// Stan in-memory imitujący serwer — testy go modyfikują żeby wymusić różne ścieżki.
type ServerState = {
  meResponse: { status: number; body: Record<string, unknown> }
  refreshResponse: { status: number; body: Record<string, unknown> }
  loginResponse: { status: number; body: Record<string, unknown> }
  logoutResponse: { status: number; body: Record<string, unknown> }
  refreshCalls: number
  meCalls: number
  loginCalls: number
  logoutCalls: number
  refreshDelayMs: number
}

export const state: ServerState = {
  meResponse: { status: 200, body: defaultUser() },
  refreshResponse: { status: 200, body: defaultTokens() },
  loginResponse: { status: 200, body: defaultTokens() },
  logoutResponse: { status: 200, body: { message: 'Logged out.' } },
  refreshCalls: 0,
  meCalls: 0,
  loginCalls: 0,
  logoutCalls: 0,
  refreshDelayMs: 0,
}

export function resetState() {
  state.meResponse = { status: 200, body: defaultUser() }
  state.refreshResponse = { status: 200, body: defaultTokens() }
  state.loginResponse = { status: 200, body: defaultTokens() }
  state.logoutResponse = { status: 200, body: { message: 'Logged out.' } }
  state.refreshCalls = 0
  state.meCalls = 0
  state.loginCalls = 0
  state.logoutCalls = 0
  state.refreshDelayMs = 0
}

function defaultUser() {
  return {
    id: 'u-1',
    email: 'user@example.com',
    displayName: 'Jan Kowalski',
    roles: ['ROLE_USER'],
    disabled: false,
  }
}

function defaultTokens() {
  return {
    token: 'jwt-token-abc',
    refresh_token: 'refresh-xyz',
    refresh_token_expiration: 9999999999,
    token_expiration: 9999999999,
  }
}

const handlers = [
  http.get(`${BASE_URL}/api/v1/user/me`, () => {
    state.meCalls += 1
    return HttpResponse.json(state.meResponse.body, { status: state.meResponse.status })
  }),
  http.post(`${BASE_URL}/api/token/refresh`, async () => {
    state.refreshCalls += 1
    if (state.refreshDelayMs > 0) {
      await new Promise((r) => setTimeout(r, state.refreshDelayMs))
    }
    return HttpResponse.json(state.refreshResponse.body, { status: state.refreshResponse.status })
  }),
  http.post(`${BASE_URL}/api/login`, () => {
    state.loginCalls += 1
    return HttpResponse.json(state.loginResponse.body, { status: state.loginResponse.status })
  }),
  http.post(`${BASE_URL}/api/logout`, () => {
    state.logoutCalls += 1
    return HttpResponse.json(state.logoutResponse.body, { status: state.logoutResponse.status })
  }),
]

export const server = setupServer(...handlers)
