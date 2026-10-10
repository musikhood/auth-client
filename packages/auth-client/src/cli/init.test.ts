// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectProject } from './detect.js'
import { renderTemplate, runInit, type InitOptions } from './init.js'
import { findTemplatesDir, main } from './main.js'
import { stripJsonComments } from './jsonc.js'
import { createFixture, EXISTING_VUE_APP, snapshotTree, writeFiles } from './test-fixtures.js'

const templatesDir = findTemplatesDir()
const roots: string[] = []

function fixture(...args: Parameters<typeof createFixture>): string {
  const root = createFixture(...args)
  roots.push(root)
  return root
}

function init(cwd: string, extra: Partial<InitOptions> = {}) {
  return runInit({ cwd, dryRun: false, force: false, templatesDir, ...extra })
}

function runCli(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = []
  const err: string[] = []
  const code = main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) }, templatesDir)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('detectProject', () => {
  it('React Router 7 + shadcn: katalog app/, alias ~/, shadcn z components.json, sonner', () => {
    const root = fixture('react-shadcn', { sonner: true })
    const project = detectProject(root)
    expect(project).toMatchObject({
      framework: 'react',
      reactRouter: true,
      appDir: 'app',
      alias: '~/',
      tailwind: true,
      toast: { kind: 'sonner', module: 'sonner', appModule: false },
      missingDeps: [],
    })
    expect(project.ui).toMatchObject({
      kind: 'shadcn',
      dir: 'app/components/ui',
      uiImport: '~/components/ui',
      utilsImport: '~/lib/utils',
      dialogCloseButtonProp: true,
    })
  })

  it('React Router 7 bez shadcn → wariant plain', () => {
    const project = detectProject(fixture('react-plain'))
    expect(project.ui.kind).toBe('plain')
    expect(project.toast).toBeNull()
  })

  it('components.json bez kompletu komponentów ui → plain', () => {
    const root = fixture('react-shadcn')
    rmSync(join(root, 'app/components/ui/checkbox.tsx'))
    expect(detectProject(root).ui.kind).toBe('plain')
  })

  it('Vue 3: katalog src/, alias @/ z tsconfig.app.json (references + komentarze)', () => {
    const project = detectProject(fixture('vue'))
    expect(project).toMatchObject({
      framework: 'vue',
      appDir: 'src',
      alias: '@/',
      vueRouter: true,
    })
  })

  it('brak aliasu w tsconfig → importy względne', () => {
    const root = fixture('react-plain')
    writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": {} }')
    const project = detectProject(root)
    expect(project.alias).toBeNull()
    init(root)
    const dialog = readFileSync(join(root, 'app/components/auth/mfa-step-up-dialog.tsx'), 'utf8')
    expect(dialog).toContain(`from '../../lib/auth'`)
    expect(dialog).toContain(`from './mfa-code-form'`)
  })

  it('--framework nadpisuje wykrywanie; nieznany projekt → błąd', () => {
    const root = fixture('react-plain')
    expect(detectProject(root, { framework: 'vue' }).framework).toBe('vue')
    writeFileSync(join(root, 'package.json'), '{"dependencies":{}}')
    expect(() => detectProject(root)).toThrow(/Nie rozpoznano frameworka/)
  })
})

describe('init — React Router 7', () => {
  it('shadcn: tworzy lib, komponenty 2FA, stronę logowania i .env.example', () => {
    const root = fixture('react-shadcn', { sonner: true })
    const result = init(root)

    expect(result.actions.map((a) => [a.path, a.status])).toEqual([
      ['app/lib/auth.ts', 'created'],
      ['app/lib/mfa.ts', 'created'],
      ['app/components/auth/mfa-code-form.tsx', 'created'],
      ['app/components/auth/mfa-step-up-dialog.tsx', 'created'],
      ['app/components/auth/mfa-enrollment-required-dialog.tsx', 'created'],
      ['app/components/auth/login-form.tsx', 'created'],
      ['app/components/auth/auth-mfa-dialogs.tsx', 'created'],
      ['app/routes/login/login.tsx', 'created'],
      ['.env.example', 'created'],
    ])

    const auth = readFileSync(join(root, 'app/lib/auth.ts'), 'utf8')
    expect(auth).toContain(`import { toast } from 'sonner'`)
    expect(auth).toContain('baseUrl: import.meta.env.VITE_API_BASE_URL')
    expect(auth).toContain('broadcastSession: true')
    for (const name of [
      'MfaRequiredError',
      'MfaEnrollmentRequiredError',
      'MfaInvalidCodeError',
      'MfaTokenExpiredError',
      'TooManyAttemptsError',
      'SessionExpiredError',
    ]) {
      expect(auth).toContain(`'${name}'`)
    }

    const form = readFileSync(join(root, 'app/components/auth/mfa-code-form.tsx'), 'utf8')
    expect(form).toContain(`from '~/components/ui/checkbox'`)
    expect(form).toContain(`from '~/lib/utils'`)
    expect(form).toContain('rememberDevice: false')
    expect(form).not.toContain('@@')

    const stepUp = readFileSync(join(root, 'app/components/auth/mfa-step-up-dialog.tsx'), 'utf8')
    expect(stepUp).toContain('showCloseButton={false}')
    expect(stepUp).not.toContain('mfa.reset()')

    expect(readFileSync(join(root, '.env.example'), 'utf8')).toMatch(/^VITE_API_BASE_URL=$/m)
    // routes.ts does not register /login yet → a manual step says how.
    expect(result.manualSteps.join('\n')).toContain(`route('login', './routes/login/login.tsx')`)
    expect(result.manualSteps[0]).toContain('<AuthProvider client={authClient} navigate=')
    expect(result.manualSteps[0]).toContain('<AuthMfaDialogs />')
  })

  it('plain: bez importów UI, z auth-modal i bez toastu', () => {
    const root = fixture('react-plain')
    const result = init(root)
    expect(result.actions.map((a) => a.path)).toContain('app/components/auth/auth-modal.tsx')
    const tree = snapshotTree(root)
    for (const [path, content] of Object.entries(tree)) {
      if (!path.startsWith('app/components/auth/')) continue
      expect(content, path).not.toContain('components/ui')
      expect(content, path).not.toContain('@@')
    }
    const auth = tree['app/lib/auth.ts'] ?? ''
    expect(auth).not.toContain('import { toast }')
    expect(auth).toContain('export function reportAuthError')
  })

  it('--dry-run niczego nie zapisuje, ale raportuje', () => {
    const root = fixture('react-shadcn')
    const before = snapshotTree(root)
    const result = init(root, { dryRun: true })
    expect(result.actions.every((a) => a.status === 'created')).toBe(true)
    expect(snapshotTree(root)).toEqual(before)
  })

  it('drugie uruchomienie bez --force nic nie zmienia', () => {
    const root = fixture('react-shadcn')
    init(root)
    const after = snapshotTree(root)
    const second = init(root)
    expect(second.actions.every((a) => a.status === 'unchanged')).toBe(true)
    expect(snapshotTree(root)).toEqual(after)
  })

  it('zmienione pliki: bez --force pominięte, z --force nadpisane (poza stroną logowania)', () => {
    const root = fixture('react-shadcn')
    init(root)
    const formPath = join(root, 'app/components/auth/login-form.tsx')
    const routePath = join(root, 'app/routes/login/login.tsx')
    writeFileSync(formPath, '// my changes\n')
    writeFileSync(routePath, '// my login page\n')

    const skipped = init(root)
    expect(skipped.actions.find((a) => a.path.endsWith('login-form.tsx'))?.status).toBe('skipped')
    expect(readFileSync(formPath, 'utf8')).toBe('// my changes\n')

    const forced = init(root, { force: true })
    expect(forced.actions.find((a) => a.path.endsWith('login-form.tsx'))?.status).toBe(
      'overwritten',
    )
    expect(readFileSync(formPath, 'utf8')).toContain('export function LoginForm')
    // The app's own login page is never overwritten.
    expect(forced.actions.find((a) => a.path === 'app/routes/login/login.tsx')?.status).toBe(
      'skipped',
    )
    expect(readFileSync(routePath, 'utf8')).toBe('// my login page\n')
    expect(forced.manualSteps.join('\n')).toContain('<LoginForm />')
  })

  it('.env.example: dopisuje klucz raz, nie duplikuje', () => {
    const root = fixture('react-plain')
    writeFiles(root, { '.env.example': 'VITE_OTHER=1' })
    init(root)
    init(root, { force: true })
    const env = readFileSync(join(root, '.env.example'), 'utf8')
    expect(env.match(/VITE_API_BASE_URL=/g)).toHaveLength(1)
    expect(env.startsWith('VITE_OTHER=1\n# ')).toBe(true)

    const root2 = fixture('react-plain')
    writeFiles(root2, { '.env.example': 'VITE_API_BASE_URL=https://api.example.com\n' })
    const result = init(root2)
    expect(result.actions.find((a) => a.path === '.env.example')?.status).toBe('unchanged')
  })

  it('istniejący lib/auth.ts bez wymaganych eksportów → ostrzeżenie', () => {
    const root = fixture('react-plain')
    writeFiles(root, { 'app/lib/auth.ts': 'export const authClient = {}\n' })
    const result = init(root)
    expect(result.warnings.join('\n')).toMatch(/app\/lib\/auth\.ts .*reportAuthError/)
  })

  it('stary shadcn dialog (bez showCloseButton) → prop usunięty', () => {
    const root = fixture('react-shadcn')
    const dialogPath = join(root, 'app/components/ui/dialog.tsx')
    writeFileSync(dialogPath, readFileSync(dialogPath, 'utf8').replace(/showCloseButton/g, 'x'))
    const project = detectProject(root)
    const out = renderTemplate(
      readFileSync(
        join(templatesDir, 'react-shadcn/components/auth/mfa-step-up-dialog.tsx'),
        'utf8',
      ),
      project,
      'app/components/auth/mfa-step-up-dialog.tsx',
    )
    expect(out).not.toContain('showCloseButton')
    expect(out).toContain('onEscapeKeyDown')
  })
})

describe('init — Vue 3', () => {
  it('tworzy lib i komponenty .vue z aliasem @/', () => {
    const root = fixture('vue')
    const result = init(root)
    expect(result.actions.map((a) => [a.path, a.status])).toEqual([
      ['src/lib/auth.ts', 'created'],
      ['src/lib/mfa.ts', 'created'],
      ['src/components/auth/AuthModal.vue', 'created'],
      ['src/components/auth/MfaCodeForm.vue', 'created'],
      ['src/components/auth/MfaStepUpDialog.vue', 'created'],
      ['src/components/auth/MfaEnrollmentRequiredDialog.vue', 'created'],
      ['src/components/auth/AuthMfaDialogs.vue', 'created'],
      ['src/components/auth/LoginForm.vue', 'created'],
      ['.env.example', 'created'],
    ])
    const dialogs = readFileSync(join(root, 'src/components/auth/AuthMfaDialogs.vue'), 'utf8')
    expect(dialogs).toContain(`from '@/components/auth/MfaStepUpDialog.vue'`)
    const steps = result.manualSteps.join('\n')
    expect(steps).toContain('app.use(VueQueryPlugin)')
    expect(steps).toContain('createAuth(authClient, { navigate: (path) => router.push(path) })')
    expect(steps).toContain('<AuthMfaDialogs />')

    const second = init(root)
    expect(second.actions.every((a) => a.status === 'unchanged')).toBe(true)
  })
})

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')

describe('init — shadcn-vue', () => {
  it('components.json + components/ui/<name>/index.ts → wariant vue-shadcn', () => {
    const root = fixture('vue-shadcn')
    const project = detectProject(root)
    expect(project.ui).toMatchObject({
      kind: 'shadcn',
      dir: 'src/components/ui',
      uiImport: '@/components/ui',
    })

    init(root)
    const modal = read(root, 'src/components/auth/AuthModal.vue')
    expect(modal).toContain(`from '@/components/ui/dialog'`)
    expect(modal).toContain('@escape-key-down.prevent')
    expect(modal).toContain('@pointer-down-outside.prevent')
    expect(modal).toContain('@interact-outside.prevent')
    expect(modal).toContain('[&>button:last-child]:hidden')
    const form = read(root, 'src/components/auth/MfaCodeForm.vue')
    expect(form).toContain(`from '@/components/ui/input'`)
    expect(form).toContain('@input="onCodeInput"')
    expect(form).toContain('accent-primary')
    // Shared with the plain variant (only composes AuthModal / MfaCodeForm).
    expect(read(root, 'src/components/auth/MfaStepUpDialog.vue')).toContain(
      "stage.value === 'step-up'",
    )
    expect(read(root, 'src/components/auth/LoginForm.vue')).toContain(
      `from '@/components/ui/button'`,
    )
  })

  it('niekompletne komponenty shadcn-vue → wariant bez UI', () => {
    const root = fixture('vue-shadcn')
    rmSync(join(root, 'src/components/ui/dialog'), { recursive: true })
    expect(detectProject(root).ui.kind).toBe('plain')
  })
})

describe('init — istniejący projekt (wzorzec: panel Vue sprzed 2FA)', () => {
  function existingApp(): string {
    const root = fixture('vue-shadcn')
    writeFiles(root, EXISTING_VUE_APP)
    const pkg = JSON.parse(read(root, 'package.json')) as { dependencies: Record<string, string> }
    pkg.dependencies['vue-sonner'] = '^1.3.0'
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2))
    return root
  }

  it('wykrywa VITE_BACKEND_URL, use-toast, shadcn-vue, /login i gotowe main.ts', () => {
    const project = detectProject(existingApp())
    expect(project.env).toMatchObject({
      key: 'VITE_BACKEND_URL',
      source: 'src/lib/auth.ts',
      definedIn: ['.env.development', '.env.production'],
      hasValue: true,
    })
    expect(project.toast).toMatchObject({
      kind: 'use-toast',
      module: 'components/ui/toast/use-toast',
      appModule: true,
      source: 'src/lib/auth.ts',
    })
    expect(project.unusedToastDeps).toEqual(['vue-sonner'])
    expect(project.ui.kind).toBe('shadcn')
    expect(project.loginPage).toEqual({
      routeFile: 'src/router/index.ts',
      pageFile: 'src/components/auth/LoginView.vue',
      mfaStep: false,
    })
    expect(project.wiring).toEqual({ provider: 'ok', dialogs: false, boundary: false })
  })

  it('--dry-run: zero fałszywych propozycji', () => {
    const root = existingApp()
    const before = snapshotTree(root)
    const result = init(root, { dryRun: true })
    expect(snapshotTree(root)).toEqual(before)

    const byPath = Object.fromEntries(result.actions.map((a) => [a.path, a]))
    expect(byPath['src/lib/auth.ts']?.status).toBe('skipped')
    expect(byPath['src/components/auth/LoginForm.vue']).toBeUndefined()
    expect(byPath['.env.example']).toMatchObject({ status: 'unchanged' })

    const steps = result.manualSteps.join('\n')
    expect(steps).not.toContain('app.use(VueQueryPlugin)')
    expect(steps).not.toContain('VITE_API_BASE_URL')
    expect(steps).not.toContain('Ustaw VITE_BACKEND_URL')
    expect(steps).toContain('src/App.vue')
    expect(steps).toContain('Masz już stronę logowania src/components/auth/LoginView.vue')
    expect(steps).toContain(
      `import MfaCodeForm, { type MfaCodeSubmit } from '@/components/auth/MfaCodeForm.vue'`,
    )

    // Existing lib/auth.ts: paste-ready fragment wired to the app's toast.
    const warning = result.warnings.join('\n')
    expect(warning).toContain('zastąp nim obecny listener login-error')
    expect(warning).toContain(`import { toast } from '@/components/ui/toast/use-toast'`)
    expect(warning).toContain('const INLINE_ERRORS')
    expect(warning).toContain("variant: 'destructive'")
    expect(warning).not.toContain('createAuthClient')
  })

  it('wpięcie kompletne → brak kroków dla main.ts / App.vue', () => {
    const root = existingApp()
    writeFiles(root, {
      'src/App.vue': '<template><RouterView /><AuthMfaDialogs /></template>\n',
      'src/components/Layout.vue': '<template><AuthBoundary><slot /></AuthBoundary></template>\n',
    })
    const steps = init(root, { dryRun: true }).manualSteps.join('\n')
    expect(steps).not.toContain('src/App.vue')
    expect(steps).not.toContain('<AuthBoundary> (np. w layoucie)')
  })

  it('strona logowania z krokiem 2FA (useMfa + MfaCodeForm) → bez przepisu', () => {
    const root = existingApp()
    writeFiles(root, {
      'src/components/auth/LoginView.vue':
        "<script setup lang=\"ts\">\nimport { useMfa } from '@musikhood-dev/auth-client/vue'\nimport MfaCodeForm from '@/components/auth/MfaCodeForm.vue'\n</script>\n",
    })
    const result = init(root, { dryRun: true })
    expect(result.project.loginPage?.mfaStep).toBe(true)
    expect(result.manualSteps.join('\n')).not.toContain('Masz już stronę logowania')
  })

  it('createAuth przed VueQueryPlugin → krok „zamień kolejność”', () => {
    const root = existingApp()
    writeFiles(root, {
      'src/main.ts': `app.use(createAuth(authClient))\napp.use(VueQueryPlugin)\n`,
    })
    expect(init(root, { dryRun: true }).manualSteps.join('\n')).toContain('zamień kolejność')
  })
})

describe('init — zmienna z adresem API', () => {
  it('--env-var: w lib/auth.ts i .env.example', () => {
    const root = fixture('vue')
    init(root, { envVar: 'VITE_AUTH_URL' })
    expect(read(root, 'src/lib/auth.ts')).toContain('baseUrl: import.meta.env.VITE_AUTH_URL')
    expect(read(root, '.env.example')).toContain('VITE_AUTH_URL=')
  })

  it('klucz z .env.development → bez dopisywania do .env.example', () => {
    const root = fixture('react-plain')
    writeFiles(root, { '.env.development': 'VITE_BACKEND_URL=http://localhost:8080\n' })
    const result = init(root)
    expect(read(root, 'app/lib/auth.ts')).toContain('import.meta.env.VITE_BACKEND_URL')
    expect(result.actions.find((a) => a.path === '.env.example')).toMatchObject({
      status: 'unchanged',
      note: 'VITE_BACKEND_URL już jest w .env.development',
    })
    expect(existsSync(join(root, '.env.example'))).toBe(false)
    expect(result.manualSteps.join('\n')).not.toContain('Ustaw VITE_BACKEND_URL')
  })
})

describe('init — toast wg faktycznego użycia', () => {
  it('sonner tylko w package.json (bez importów i komponentu) → nie wykryto', () => {
    const root = fixture('react-plain')
    const pkg = JSON.parse(read(root, 'package.json')) as { dependencies: Record<string, string> }
    pkg.dependencies.sonner = '^2.0.0'
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    const project = detectProject(root)
    expect(project.toast).toBeNull()
    expect(project.unusedToastDeps).toEqual(['sonner'])
  })

  it('import { toast } from "sonner" w kodzie → sonner', () => {
    const root = fixture('react-plain')
    writeFiles(root, {
      'app/lib/notify.ts': `import { toast } from 'sonner'\nexport const n = toast\n`,
    })
    expect(detectProject(root).toast).toMatchObject({ kind: 'sonner', source: 'app/lib/notify.ts' })
  })
})

describe('init — istniejąca strona logowania (React Router 7)', () => {
  it('route("login", …) na własną stronę → bez LoginForm i trasy, przepis scalenia', () => {
    const root = fixture('react-shadcn')
    writeFiles(root, {
      'app/routes.ts': `import { route } from '@react-router/dev/routes'\nexport default [route('login', 'routes/auth/login.tsx')]\n`,
      'app/routes/auth/login.tsx': 'export default function Login() {\n  return null\n}\n',
      'app/root.tsx':
        'export default function App() {\n  return <AuthProvider><Outlet /><AuthMfaDialogs /></AuthProvider>\n}\n',
    })
    const result = init(root)
    const paths = result.actions.map((a) => a.path)
    expect(paths).not.toContain('app/components/auth/login-form.tsx')
    expect(paths).not.toContain('app/routes/login/login.tsx')
    const steps = result.manualSteps.join('\n')
    expect(steps).toContain('Masz już stronę logowania app/routes/auth/login.tsx')
    expect(steps).toContain(`from '~/components/auth/mfa-code-form'`)
    expect(steps).not.toContain('owiń <Outlet />')
  })

  it('strona wygenerowana wcześniej przez init się nie liczy', () => {
    const root = fixture('react-shadcn')
    init(root)
    writeFiles(root, {
      'app/routes.ts': `export default [route('login', './routes/login/login.tsx')]\n`,
    })
    expect(detectProject(root).loginPage).toBeNull()
  })
})

describe('init — prettier repo', () => {
  const repoPrettier = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../node_modules/prettier',
  )

  it.skipIf(!existsSync(repoPrettier))(
    'formatuje wygenerowane pliki konfiguracją repo',
    () => {
      const root = fixture('vue')
      writeFiles(root, { '.prettierrc': '{ "semi": true, "singleQuote": false }\n' })
      mkdirSync(join(root, 'node_modules'))
      symlinkSync(repoPrettier, join(root, 'node_modules/prettier'), 'dir')
      const result = init(root)
      expect(result.formatting).toContain('sformatowano prettierem repo (.prettierrc)')
      const auth = read(root, 'src/lib/auth.ts')
      expect(auth).toContain('from "@musikhood-dev/auth-client";')
    },
    60_000,
  )

  it('bez konfiguracji → pliki w stylu paczki, raport to mówi', () => {
    const result = init(fixture('vue'))
    expect(result.formatting).toContain('brak prettier w repo')
  })
})

describe('CLI main', () => {
  it('--help → 0, bez komendy → 1, nieznana opcja → 1', () => {
    expect(runCli(['--help']).code).toBe(0)
    expect(runCli([]).code).toBe(1)
    expect(runCli(['init', '--nope']).code).toBe(1)
    expect(runCli(['deploy']).code).toBe(1)
    expect(runCli(['init', '--framework', 'svelte']).code).toBe(1)
  })

  it('init --dry-run --cwd: raport + kroki ręczne, nic nie zapisane', () => {
    const root = fixture('react-shadcn')
    const res = runCli(['init', '--dry-run', '--cwd', root, '--yes'])
    expect(res.code).toBe(0)
    expect(res.out).toContain('Tryb --dry-run')
    // Future tense in dry-run: nothing was created.
    expect(res.out).toContain('utworzę')
    expect(res.out).not.toContain('utworzono')
    expect(res.out).toContain('Dalej ręcznie:')
    expect(existsSync(join(root, 'app/lib/auth.ts'))).toBe(false)
  })

  it('brak package.json → 1 z komunikatem', () => {
    const root = fixture('react-plain')
    rmSync(join(root, 'package.json'))
    const res = runCli(['init', '--cwd', root])
    expect(res.code).toBe(1)
    expect(res.err).toContain('Nie znaleziono package.json')
  })
})

describe('stripJsonComments', () => {
  it('nie rusza "/*" w stringach, usuwa komentarze i przecinki końcowe', () => {
    const src = `{ // c\n "paths": { "@/*": ["./src/*"], }, /* x */ "a": "http://b" }`
    expect(JSON.parse(stripJsonComments(src))).toEqual({
      paths: { '@/*': ['./src/*'] },
      a: 'http://b',
    })
  })
})
