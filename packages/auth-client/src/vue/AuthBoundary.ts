import { defineComponent, provide } from 'vue'
import { AUTH_PROTECTED_KEY } from './key.js'

// Wszystko wewnątrz <AuthBoundary> ma "tryb chroniony" — useAuth() w tym poddrzewie
// woła /me, polluje co 30s i odświeża po focusie. Poza boundary useAuth() zwraca
// user: null bez żadnych requestów.
export const AuthBoundary = defineComponent({
  name: 'AuthBoundary',
  setup(_, { slots }) {
    provide(AUTH_PROTECTED_KEY, true)
    return () => slots.default?.()
  },
})
