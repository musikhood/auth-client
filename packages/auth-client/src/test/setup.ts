import { afterAll, afterEach, beforeAll } from 'vitest'
import { server, resetState } from './server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetState()
})
afterAll(() => server.close())
