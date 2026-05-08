import { defineComponent, h } from 'vue'
import { useMe } from './useMe.js'

// Komponent z trzema slotami: default (zalogowany), fallback (niezalogowany), loading.
export const AuthGate = defineComponent({
  name: 'AuthGate',
  setup(_, { slots }) {
    const me = useMe()
    return () => {
      if (me.isLoading.value) return slots.loading?.() ?? null
      if (me.isError.value || me.data.value == null) return slots.fallback?.() ?? null
      return slots.default?.() ?? null
    }
  },
})

// Pomocniczy renderer — utylitarny, nieczęsto potrzebny, ale przydaje się gdy
// konsument woli funkcję zamiast komponentu.
export function renderAuthGate(slots: {
  default: () => unknown
  fallback?: () => unknown
  loading?: () => unknown
}) {
  return h(AuthGate, null, slots)
}
