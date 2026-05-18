// Cross-tab synchronizacja sesji.
// Każdy tab z `broadcastSession: true` w configu nasłuchuje wiadomości od pozostałych
// i emituje lokalne eventy gdy coś przyjdzie z drugiego taba — tak jakby to się
// stało lokalnie. Dzięki temu listenery (TanStack cache + AuthBoundary)
// reagują identycznie niezależnie od źródła.
//
// Preferuje BroadcastChannel (nowoczesne przeglądarki), fallback do storage event
// (Safari < 15.4, edge cases).

import type { AuthEmitter } from './events.js'
import type { AuthEventName, AuthEvents } from './types.js'

type BroadcastMessageType = 'logout' | 'unauthorized' | 'login'

type Envelope = { tabId: string; type: BroadcastMessageType }

const CHANNEL_NAME = '@musikhood-dev/auth-client'
const STORAGE_KEY = `${CHANNEL_NAME}:bus`
const SYNCED_EVENTS: BroadcastMessageType[] = ['logout', 'unauthorized', 'login']

export function attachBroadcastSync(emitter: AuthEmitter): () => void {
  if (typeof window === 'undefined') return () => {}

  const tabId = Math.random().toString(36).slice(2)
  const usingBroadcast = typeof BroadcastChannel !== 'undefined'
  const channel = usingBroadcast ? new BroadcastChannel(CHANNEL_NAME) : null

  // Flaga: gdy emitujemy z powodu inbound wiadomości, NIE wysyłamy jej dalej
  // (inaczej zapętlimy się przez wszystkie taby).
  let suppressOutbound = false

  const send = (type: BroadcastMessageType) => {
    const envelope: Envelope = { tabId, type }
    if (channel) {
      channel.postMessage(envelope)
    } else {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...envelope, ts: Date.now() }))
      } catch {
        // localStorage może być niedostępne (private mode, quota) — trudno.
      }
    }
  }

  const handleIncoming = (envelope: Envelope) => {
    if (!envelope || envelope.tabId === tabId) return
    if (!SYNCED_EVENTS.includes(envelope.type)) return
    suppressOutbound = true
    try {
      // Wszystkie syncowane eventy mają payload `void` w AuthEvents.
      emitter.emit(envelope.type as AuthEventName, undefined as AuthEvents[AuthEventName])
    } finally {
      suppressOutbound = false
    }
  }

  // Tworzymy handlery dla każdego eventu, trzymamy referencje żeby móc odpiąć.
  const outboundHandlers = new Map<BroadcastMessageType, () => void>()
  for (const type of SYNCED_EVENTS) {
    const handler = () => {
      if (suppressOutbound) return
      send(type)
    }
    outboundHandlers.set(type, handler)
    emitter.on(type as AuthEventName, handler as never)
  }

  let storageListener: ((e: StorageEvent) => void) | null = null
  if (channel) {
    channel.onmessage = (e) => handleIncoming(e.data)
  } else {
    storageListener = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        handleIncoming(JSON.parse(e.newValue))
      } catch {
        // ignored
      }
    }
    window.addEventListener('storage', storageListener)
  }

  return () => {
    for (const [type, handler] of outboundHandlers) {
      emitter.off(type as AuthEventName, handler as never)
    }
    channel?.close()
    if (storageListener) window.removeEventListener('storage', storageListener)
  }
}
