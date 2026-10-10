// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectProject } from './detect.js'
import { renderTemplate, runInit, type InitOptions } from './init.js'
import { findTemplatesDir, main } from './main.js'
import { stripJsonComments } from './jsonc.js'
import { createFixture, snapshotTree, writeFiles } from './test-fixtures.js'

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
      toastModule: 'sonner',
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
    expect(project.toastModule).toBeNull()
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
    expect(detectProject(root, 'vue').framework).toBe('vue')
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
