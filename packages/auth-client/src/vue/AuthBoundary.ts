import { computed, defineComponent, provide, ref, watch, type PropType } from 'vue'
import { AUTH_PROTECTED_KEY, type AuthProtectedMode } from './key.js'
import { useAuth } from './useAuth.js'

// API symetryczne do React AuthBoundary. Patrz tamtejszy plik dla pełnej dokumentacji.
export const AuthBoundary = defineComponent({
  name: 'AuthBoundary',
  props: {
    mode: {
      type: String as PropType<AuthProtectedMode>,
      default: 'protected',
    },
    requireRoles: {
      type: Array as PropType<string[]>,
      default: undefined,
    },
    requireAnyRole: {
      type: Array as PropType<string[]>,
      default: undefined,
    },
    onUnauthorized: {
      type: Function as PropType<() => void>,
      default: undefined,
    },
    onForbidden: {
      type: Function as PropType<() => void>,
      default: undefined,
    },
    onAuthenticated: {
      type: Function as PropType<() => void>,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    provide(AUTH_PROTECTED_KEY, props.mode)
    const { user, isLoading, error } = useAuth()

    const hasRequiredRoles = computed(() => {
      if (props.mode !== 'protected') return true
      if (!user.value) return false
      const userRoles = user.value.roles ?? []
      if (props.requireRoles && props.requireRoles.length > 0) {
        return props.requireRoles.every((r) => userRoles.includes(r))
      }
      if (props.requireAnyRole && props.requireAnyRole.length > 0) {
        return props.requireAnyRole.some((r) => userRoles.includes(r))
      }
      return true
    })

    // Guard: nie wołaj tego samego callbacku dwa razy z rzędu dla tego samego stanu.
    // Bez tego logout/refresh-fail wpadłby w pętlę (redirect → remount → ...).
    const lastFired = ref<'unauthorized' | 'forbidden' | 'authenticated' | null>(null)

    watch(
      [isLoading, user, error, hasRequiredRoles],
      ([loading, u, err, hasRoles]) => {
        if (loading) return
        if (props.mode === 'protected') {
          if (!u) {
            if (lastFired.value !== 'unauthorized') {
              lastFired.value = 'unauthorized'
              props.onUnauthorized?.()
            }
            return
          }
          if (!hasRoles) {
            if (lastFired.value !== 'forbidden') {
              lastFired.value = 'forbidden'
              ;(props.onForbidden ?? props.onUnauthorized)?.()
            }
            return
          }
          lastFired.value = null
          return
        }
        if (props.mode === 'guest') {
          if (u && lastFired.value !== 'authenticated') {
            lastFired.value = 'authenticated'
            props.onAuthenticated?.()
          } else if (!u) {
            lastFired.value = null
          }
        }
      },
      { immediate: true },
    )

    return () => {
      if (isLoading.value) return slots.fallback?.() ?? null
      if (props.mode === 'protected') {
        if (!user.value || !hasRequiredRoles.value) return slots.fallback?.() ?? null
        return slots.default?.()
      }
      // guest
      if (user.value) return slots.fallback?.() ?? null
      return slots.default?.()
    }
  },
})
