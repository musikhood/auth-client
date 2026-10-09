import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const BASE_URL = 'https://auth.example.com'

// Stan in-memory imitujący serwer — testy go modyfikują żeby wymusić różne ścieżki.
type Resp = { status: number; body: Record<string, unknown>; headers?: Record<string, string> }

// Ostatnie requesty per endpoint — testy 2FA sprawdzają body (`device`) i nagłówek X-Device-Fp.
export type Captured = { body: Record<string, unknown> | null; deviceFp: string | null }

type ServerState = {
  loginMfaResponse: Resp
  sessionMfaResponse: Resp
  enrollmentRequestResponse: Resp
  enrollmentConfirmResponse: Resp
  // Kolejka odpowiedzi /me (shift per call) — gdy pusta, używamy meResponse.
  meQueue: Resp[]
  meDelayMs: number
  captured: Record<string, Captured>
  meResponse: { status: number; body: Record<string, unknown> }
  refreshResponse: { status: number; body: Record<string, unknown> }
  loginResponse: Resp
  logoutResponse: { status: number; body: Record<string, unknown> }
  refreshCalls: number
  meCalls: number
  loginCalls: number
  logoutCalls: number
  refreshDelayMs: number
}

export const state: ServerState = {
  loginMfaResponse: { status: 200, body: defaultTokens() },
  sessionMfaResponse: { status: 200, body: defaultTokens() },
  enrollmentRequestResponse: {
    status: 200,
    body: { enrollment_url: 'https://auth.example.com/setup-2fa?token=t' },
  },
  enrollmentConfirmResponse: { status: 200, body: defaultConfirm() },
  meQueue: [],
  meDelayMs: 0,
  captured: {},
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
  state.loginMfaResponse = { status: 200, body: defaultTokens() }
  state.sessionMfaResponse = { status: 200, body: defaultTokens() }
  state.enrollmentRequestResponse = {
    status: 200,
    body: { enrollment_url: 'https://auth.example.com/setup-2fa?token=t' },
  }
  state.enrollmentConfirmResponse = { status: 200, body: defaultConfirm() }
  state.meQueue = []
  state.meDelayMs = 0
  state.captured = {}
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

async function capture(name: string, request: Request) {
  let body: Record<string, unknown> | null = null
  try {
    const text = await request.text()
    body = text ? (JSON.parse(text) as Record<string, unknown>) : null
  } catch {
    body = null
  }
  state.captured[name] = { body, deviceFp: request.headers.get('x-device-fp') }
}

function respond(r: Resp) {
  return HttpResponse.json(r.body, { status: r.status, headers: r.headers })
}

const handlers = [
  http.get(`${BASE_URL}/api/v1/user/me`, async ({ request }) => {
    state.meCalls += 1
    await capture('me', request)
    if (state.meDelayMs > 0) await new Promise((r) => setTimeout(r, state.meDelayMs))
    const queued = state.meQueue.shift()
    if (queued) return respond(queued)
    return HttpResponse.json(state.meResponse.body, { status: state.meResponse.status })
  }),
  http.post(`${BASE_URL}/api/login/mfa`, async ({ request }) => {
    await capture('loginMfa', request)
    return respond(state.loginMfaResponse)
  }),
  http.post(`${BASE_URL}/api/session/mfa`, async ({ request }) => {
    await capture('sessionMfa', request)
    return respond(state.sessionMfaResponse)
  }),
  http.post(`${BASE_URL}/api/mfa/enrollment/request`, async ({ request }) => {
    await capture('enrollmentRequest', request)
    return respond(state.enrollmentRequestResponse)
  }),
  http.post(`${BASE_URL}/api/mfa/enrollment/confirm`, async ({ request }) => {
    await capture('enrollmentConfirm', request)
    return respond(state.enrollmentConfirmResponse)
  }),
  http.post(`${BASE_URL}/api/token/refresh`, async ({ request }) => {
    await capture('refresh', request)
    state.refreshCalls += 1
    if (state.refreshDelayMs > 0) {
      await new Promise((r) => setTimeout(r, state.refreshDelayMs))
    }
    return HttpResponse.json(state.refreshResponse.body, { status: state.refreshResponse.status })
  }),
  http.post(`${BASE_URL}/api/login`, async ({ request }) => {
    state.loginCalls += 1
    await capture('login', request)
    const r = state.loginResponse as Resp
    return HttpResponse.json(r.body, { status: r.status, headers: r.headers })
  }),
  http.post(`${BASE_URL}/api/logout`, () => {
    state.logoutCalls += 1
    return HttpResponse.json(state.logoutResponse.body, { status: state.logoutResponse.status })
  }),
]

export const server = setupServer(...handlers)

// Odpowiedź confirm z sesją (link frontendowy): kody + pola tokenów jak login.
export function defaultConfirm(): Record<string, unknown> {
  return {
    recovery_codes: ['aaaaa-bbbbb'],
    return_url: 'https://panel.example.com',
    ...defaultTokens(),
  }
}
