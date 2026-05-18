import { defineComponent, h, provide, watch, type PropType } from 'vue'
import { AUTH_PROTECTED_KEY } from './key.js'
import { useAuth } from './useAuth.js'

// Wszystko wewnątrz <AuthBoundary> ma "tryb chroniony" — useAuth() w tym poddrzewie
// woła /me, polluje co 30s i odświeża po focusie. Poza boundary useAuth() zwraca
// user: null bez żadnych requestów.
//
// Sloty:
//   - default: zawartość chroniona, renderowana gdy user się zalogował.
//   - fallback: renderowany podczas pierwszego /me lub gdy user nie ma sesji.
//
// Props:
//   - onUnauthorized?: () => void — wołane gdy /me się nie udało (typowo redirect na /login).
export const AuthBoundary = defineComponent({
  name: 'AuthBoundary',
  props: {
    onUnauthorized: {
      type: Function as PropType<() => void>,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    provide(AUTH_PROTECTED_KEY, true)
    const { user, isLoading, isAuthenticated, error } = useAuth()

    watch(
      [isLoading, isAuthenticated, error],
      ([loading, authed, err]) => {
        if (!props.onUnauthorized) return
        if (!loading && !authed && err) {
          props.onUnauthorized()
        }
      },
      { immediate: true },
    )

    return () => {
      if (isLoading.value) return slots.fallback?.() ?? null
      if (!user.value) return slots.fallback?.() ?? null
      return slots.default?.()
    }
  },
})
