import { computed, defineComponent, provide, watch, type PropType } from 'vue'
import { AUTH_PROTECTED_KEY } from './key.js'
import { useAuth } from './useAuth.js'
import { useAuthClient } from './useAuthClient.js'

// Publiczny tryb props.
export type AuthBoundaryPublicMode = 'protected' | 'guest'

// Konsument NIE pisze żadnych callbacków. Paczka decyduje sama gdzie redirectować
// na podstawie konfiguracji loginPath/homePath/forbiddenPath w createAuthClient.
// Patrz: React AuthBoundary dla pełnej dokumentacji.
export const AuthBoundary = defineComponent({
  name: 'AuthBoundary',
  props: {
    mode: {
      type: String as PropType<AuthBoundaryPublicMode>,
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
  },
  setup(props, { slots }) {
    const boundaryMode = props.mode === 'guest' ? 'guest-checking' : 'protected'
    // Provide dla POTOMKÓW (komponenty w slotach wołające useAuth()).
    provide(AUTH_PROTECTED_KEY, boundaryMode)

    const client = useAuthClient()
    // WAŻNE: przekazujemy tryb jawnie. inject() w tym samym setupie NIE widzi
    // provide() powyżej (Vue: provide jest widoczne tylko dla potomków), więc bez
    // tego boundary'owy useAuth dostawałby mode=null → /me nigdy by nie leciało.
    const { user, isLoading } = useAuth(boundaryMode)

    const config = client.config
    const loginPath = config.loginPath
    const homePath = config.homePath ?? '/'
    const forbiddenPath = config.forbiddenPath ?? loginPath

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
      [isLoading, user, hasRequiredRoles],
      ([loading, u, hasRoles]) => {
        if (loading) return
        if (props.mode === 'protected') {
          if (!u) {
            if (loginPath) client.redirectTo(loginPath)
            return
          }
          if (!hasRoles) {
            if (forbiddenPath) client.redirectTo(forbiddenPath)
            return
          }
          return
        }
        // mode === 'guest'
        if (u) {
          client.redirectTo(homePath)
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
