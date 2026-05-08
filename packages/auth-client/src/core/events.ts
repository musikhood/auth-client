import mitt, { type Emitter } from 'mitt'
import type { AuthEvents, AuthEventName, AuthEventListener } from './types.js'

export type AuthEmitter = {
  on<E extends AuthEventName>(event: E, handler: AuthEventListener<E>): void
  off<E extends AuthEventName>(event: E, handler: AuthEventListener<E>): void
  emit<E extends AuthEventName>(event: E, payload: AuthEvents[E]): void
}

export function createAuthEmitter(): AuthEmitter {
  const inner: Emitter<AuthEvents> = mitt<AuthEvents>()
  return {
    on: (event, handler) => inner.on(event, handler as never),
    off: (event, handler) => inner.off(event, handler as never),
    emit: (event, payload) => inner.emit(event, payload as never),
  }
}
