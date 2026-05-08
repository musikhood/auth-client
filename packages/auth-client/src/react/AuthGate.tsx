import type { ReactNode } from 'react'
import { useMe } from './useMe.js'

export type AuthGateProps = {
  children: ReactNode
  // Renderowane gdy użytkownik nie jest zalogowany (404/401 z /me, błąd refresh).
  fallback?: ReactNode
  // Renderowane podczas pierwszego strzału do /me. Domyślnie null (nic).
  loading?: ReactNode
}

export function AuthGate({ children, fallback = null, loading = null }: AuthGateProps) {
  const me = useMe()
  if (me.isLoading) return <>{loading}</>
  if (me.isError || !me.data) return <>{fallback}</>
  return <>{children}</>
}
