import { useState } from 'react'
import { AuthGate, useAuth } from '@musikhood-dev/auth-client/react'

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1>auth-client · React example</h1>
      <AuthGate fallback={<LoginPage />} loading={<p>Ładowanie…</p>}>
        <Dashboard />
      </AuthGate>
    </main>
  )
}

function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        login.mutate({ username, password })
      }}
    >
      <label>
        Login <input value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <br />
      <label>
        Hasło{' '}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <br />
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? 'Loguję…' : 'Zaloguj'}
      </button>
      {login.error && <p style={{ color: 'crimson' }}>{login.error.message}</p>}
    </form>
  )
}

function Dashboard() {
  const { user, logout } = useAuth()
  return (
    <div>
      <p>Witaj, {user?.displayName ?? user?.email}</p>
      <p>Role: {user?.roles.join(', ') || '(brak)'}</p>
      <button onClick={() => logout.mutate()} disabled={logout.isPending}>
        Wyloguj
      </button>
    </div>
  )
}
