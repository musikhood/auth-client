import { computed, defineComponent, provide, watch, type PropType } from 'vue'
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

    watch(
      [isLoading, user, error, hasRequiredRoles],
      ([loading, u, err, hasRoles]) => {
        if (loading) return
        if (props.mode === 'protected') {
          if (!u) {
            if (err || !loading) props.onUnauthorized?.()
            return
          }
          if (!hasRoles) (props.onForbidden ?? props.onUnauthorized)?.()
          return
        }
        if (props.mode === 'guest' && u) {
          props.onAuthenticated?.()
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
