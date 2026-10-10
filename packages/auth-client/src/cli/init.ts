import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { detectProject, type Framework, type ProjectInfo } from './detect.js'

export interface InitOptions {
  cwd: string
  dryRun: boolean
  force: boolean
  framework?: Framework
  // Package templates directory (resolved automatically when omitted).
  templatesDir: string
}

export type FileStatus = 'created' | 'overwritten' | 'skipped' | 'unchanged' | 'appended'

export interface FileAction {
  // Path relative to the project root (posix).
  path: string
  status: FileStatus
  note?: string
}

export interface InitResult {
  project: ProjectInfo
  actions: FileAction[]
  warnings: string[]
  manualSteps: string[]
}

// One generated file: template (relative to templates/) → target (relative to appDir).
interface FileSpec {
  template: string
  target: string
  // 'create-only' = never overwritten, even with --force (the app's own page).
  policy?: 'create-only'
  // Exports (and MFA_TEXTS keys) other generated files import from this one.
  requiredExports?: string[]
  requiredKeys?: string[]
}

const GENERATED_MARKER = '@musikhood-dev/auth-client init'
const ENV_KEY = 'VITE_API_BASE_URL'
const ENV_BLOCK = `# auth-client: adres API (auth server / backend panelu), np. https://api.example.com\n${ENV_KEY}=\n`

const LIB_AUTH_EXPORTS = ['authClient', 'reportAuthError']
const LIB_MFA_EXPORTS = [
  'MFA_TEXTS',
  'isAuthError',
  'formatRetryAfter',
  'mfaErrorMessage',
  'loginErrorMessage',
]
const LIB_MFA_KEYS = [
  'invalidCredentials',
  'loginForbidden',
  'loginFailed',
  'logoutFailed',
  'invalidCode',
  'codeReused',
  'tokenExpired',
  'verifyFailed',
  'invalidPassword',
  'alreadyEnabled',
  'enrollmentFailed',
  'recoveryCodeHint',
]

function fileSpecs(project: ProjectInfo): FileSpec[] {
  const libAuth: FileSpec = {
    template: project.toastModule ? 'shared/lib/auth.toast.ts' : 'shared/lib/auth.ts',
    target: 'lib/auth.ts',
    requiredExports: LIB_AUTH_EXPORTS,
  }
  const libMfa: FileSpec = {
    template: 'shared/lib/mfa.ts',
    target: 'lib/mfa.ts',
    requiredExports: LIB_MFA_EXPORTS,
    requiredKeys: LIB_MFA_KEYS,
  }

  if (project.framework === 'vue') {
    return [
      libAuth,
      libMfa,
      ...[
        'AuthModal.vue',
        'MfaCodeForm.vue',
        'MfaStepUpDialog.vue',
        'MfaEnrollmentRequiredDialog.vue',
        'AuthMfaDialogs.vue',
        'LoginForm.vue',
      ].map((name) => ({
        template: `vue/components/auth/${name}`,
        target: `components/auth/${name}`,
      })),
    ]
  }

  const variant = project.ui.kind === 'shadcn' ? 'react-shadcn' : 'react-plain'
  const specs: FileSpec[] = [libAuth, libMfa]
  if (variant === 'react-plain') {
    specs.push({
      template: 'react-plain/components/auth/auth-modal.tsx',
      target: 'components/auth/auth-modal.tsx',
    })
  }
  for (const name of [
    'mfa-code-form.tsx',
    'mfa-step-up-dialog.tsx',
    'mfa-enrollment-required-dialog.tsx',
    'login-form.tsx',
  ]) {
    specs.push({
      template: `${variant}/components/auth/${name}`,
      target: `components/auth/${name}`,
    })
  }
  specs.push({
    template: 'react-common/components/auth/auth-mfa-dialogs.tsx',
    target: 'components/auth/auth-mfa-dialogs.tsx',
  })
  if (project.reactRouter) {
    specs.push({
      template: 'react-common/routes/login/login.tsx',
      target: 'routes/login/login.tsx',
      policy: 'create-only',
    })
  }
  return specs
}

// Import specifier for an app-dir-relative module (e.g. 'lib/auth'), as seen from `fromFile`
// (project-root-relative). Uses the detected alias, otherwise a relative path.
export function importPath(project: ProjectInfo, fromFile: string, modulePath: string): string {
  if (project.alias) return `${project.alias}${modulePath}`
  let rel = relative(dirname(fromFile), join(project.appDir, modulePath)).split('\\').join('/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

function resolveSpecifier(project: ProjectInfo, fromFile: string, modulePath: string): string {
  const ui = project.ui
  if (ui.kind === 'shadcn') {
    if (modulePath.startsWith('components/ui/') && ui.uiImport) {
      return `${ui.uiImport}/${modulePath.slice('components/ui/'.length)}`
    }
    if (modulePath === 'lib/utils' && ui.utilsImport) return ui.utilsImport
  }
  return importPath(project, fromFile, modulePath)
}

// Replaces template placeholders:
//   '@@/<app-relative path>' → alias / relative import / shadcn alias from components.json
//   '@@toast-module'         → detected toast package
export function renderTemplate(source: string, project: ProjectInfo, targetFile: string): string {
  let out = source.replace(/(['"])@@\/([^'"]+)\1/g, (_match, quote: string, modulePath: string) => {
    return `${quote}${resolveSpecifier(project, targetFile, modulePath)}${quote}`
  })
  if (project.toastModule) out = out.split('@@toast-module').join(project.toastModule)
  if (project.ui.kind === 'shadcn' && !project.ui.dialogCloseButtonProp) {
    // Older shadcn dialog: no `showCloseButton` prop (the X closes nothing anyway — the
    // dialog is controlled and has no onOpenChange).
    out = out.replace(/^[ \t]*showCloseButton=\{false\}\r?\n/gm, '')
  }
  return out
}

function hasExport(source: string, name: string): boolean {
  return (
    new RegExp(
      `export\\s+(?:declare\\s+)?(?:async\\s+)?(?:const|let|var|function|class)\\s+${name}\\b`,
    ).test(source) ||
    new RegExp(`export\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`).test(source)
  )
}

function checkExisting(spec: FileSpec, source: string, displayPath: string): string | null {
  if (source.includes(GENERATED_MARKER)) return null
  const missing = [
    ...(spec.requiredExports ?? []).filter((name) => !hasExport(source, name)),
    ...(spec.requiredKeys ?? [])
      .filter((key) => !new RegExp(`\\b${key}\\s*:`).test(source))
      .map((key) => `MFA_TEXTS.${key}`),
  ]
  if (missing.length === 0) return null
  return `${displayPath} istnieje (nie z init) i nie ma: ${missing.join(', ')} — wygenerowane komponenty tego używają. Dopisz brakujące eksporty albo uruchom z --force (nadpisze plik).`
}

function writeFile(root: string, path: string, content: string, dryRun: boolean): void {
  if (dryRun) return
  const abs = join(root, path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

function updateEnvExample(root: string, dryRun: boolean): FileAction {
  const path = '.env.example'
  const abs = join(root, path)
  if (!existsSync(abs)) {
    writeFile(root, path, ENV_BLOCK, dryRun)
    return { path, status: 'created', note: ENV_KEY }
  }
  const current = readFileSync(abs, 'utf8')
  if (new RegExp(`^\\s*(?:export\\s+)?${ENV_KEY}\\s*=`, 'm').test(current)) {
    return { path, status: 'unchanged', note: `${ENV_KEY} już jest` }
  }
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
  writeFile(root, path, `${current}${separator}${ENV_BLOCK}`, dryRun)
  return { path, status: 'appended', note: ENV_KEY }
}

function manualSteps(project: ProjectInfo, actions: FileAction[]): string[] {
  const steps: string[] = []
  const app = project.appDir
  const actionFor = (path: string) => actions.find((action) => action.path === path)

  if (project.missingDeps.length > 0) {
    steps.push(`Zainstaluj brakujące paczki:\n\n    npm i ${project.missingDeps.join(' ')}`)
  }

  if (project.framework === 'react') {
    const rootFile = project.reactRouter ? `${app}/root.tsx` : `${app}/main.tsx`
    const auth = importPath(project, rootFile, 'lib/auth')
    const dialogs = importPath(project, rootFile, 'components/auth/auth-mfa-dialogs')
    if (project.reactRouter) {
      steps.push(
        `${rootFile} — owiń <Outlet /> w AuthProvider i dodaj dialogi 2FA:\n\n` +
          [
            `import { Outlet, useNavigate } from 'react-router'`,
            `import { AuthProvider } from '@musikhood-dev/auth-client/react'`,
            `import { authClient } from '${auth}'`,
            `import { AuthMfaDialogs } from '${dialogs}'`,
            ``,
            `export default function App() {`,
            `  const navigate = useNavigate()`,
            `  return (`,
            `    <AuthProvider client={authClient} navigate={(path) => navigate(path, { replace: true })}>`,
            `      <Outlet />`,
            `      <AuthMfaDialogs />`,
            `    </AuthProvider>`,
            `  )`,
            `}`,
          ]
            .map((line) => (line ? `    ${line}` : ''))
            .join('\n'),
      )
    } else {
      steps.push(
        `Owiń aplikację (np. w ${rootFile}) w AuthProvider i dodaj dialogi 2FA:\n\n` +
          [
            `import { AuthProvider } from '@musikhood-dev/auth-client/react'`,
            `import { authClient } from '${auth}'`,
            `import { AuthMfaDialogs } from '${dialogs}'`,
            ``,
            `<AuthProvider client={authClient}>`,
            `  <App />`,
            `  <AuthMfaDialogs />`,
            `</AuthProvider>`,
          ]
            .map((line) => (line ? `    ${line}` : ''))
            .join('\n'),
      )
    }

    const loginRoute = actionFor(`${app}/routes/login/login.tsx`)
    const loginForm = importPath(
      project,
      `${app}/routes/login/login.tsx`,
      'components/auth/login-form',
    )
    if (loginRoute && loginRoute.status === 'skipped') {
      steps.push(
        `Masz już ${loginRoute.path} — wyrenderuj w nim <LoginForm /> z '${loginForm}' (wewnątrz <AuthBoundary mode="guest">).`,
      )
    } else if (loginRoute) {
      const routesFile = join(project.root, app, 'routes.ts')
      const routes = existsSync(routesFile) ? readFileSync(routesFile, 'utf8') : null
      if (routes !== null && !routes.includes('routes/login/login')) {
        steps.push(
          `Zarejestruj trasę logowania w ${app}/routes.ts:\n\n    route('login', './routes/login/login.tsx'),`,
        )
      }
    } else {
      steps.push(
        `Formularz logowania: <LoginForm /> z '${importPath(project, rootFile, 'components/auth/login-form')}' — wyrenderuj go na /login wewnątrz <AuthBoundary mode="guest">.`,
      )
    }
  } else {
    const mainFile = `${app}/main.ts`
    const appFile = `${app}/App.vue`
    const navigate = project.vueRouter
      ? `createAuth(authClient, { navigate: (path) => router.push(path) })`
      : `createAuth(authClient)`
    steps.push(
      `${mainFile} — zainstaluj pluginy (VueQueryPlugin przed createAuth):\n\n` +
        [
          `import { VueQueryPlugin } from '@tanstack/vue-query'`,
          `import { createAuth } from '@musikhood-dev/auth-client/vue'`,
          `import { authClient } from '${importPath(project, mainFile, 'lib/auth')}'`,
          ``,
          `app.use(VueQueryPlugin)`,
          `app.use(${navigate})`,
        ]
          .map((line) => (line ? `    ${line}` : ''))
          .join('\n'),
    )
    steps.push(
      `${appFile} — dodaj dialogi 2FA:\n\n` +
        [
          `<script setup lang="ts">`,
          `import AuthMfaDialogs from '${importPath(project, appFile, 'components/auth/AuthMfaDialogs.vue')}'`,
          `</script>`,
          ``,
          `<template>`,
          project.vueRouter ? `  <RouterView />` : `  <!-- twoja aplikacja -->`,
          `  <AuthMfaDialogs />`,
          `</template>`,
        ]
          .map((line) => (line ? `    ${line}` : ''))
          .join('\n'),
    )
    steps.push(
      `Formularz logowania: LoginForm z '${importPath(project, appFile, 'components/auth/LoginForm.vue')}' — wyrenderuj go na /login wewnątrz <AuthBoundary mode="guest">.`,
    )
  }

  steps.push(
    `Ustaw ${ENV_KEY} w .env (wzór: .env.example). Trasy chronione owiń w <AuthBoundary> (np. w layoucie).`,
  )
  return steps
}

export function runInit(options: InitOptions): InitResult {
  const project = detectProject(options.cwd, options.framework)
  const actions: FileAction[] = []
  const warnings: string[] = []

  for (const spec of fileSpecs(project)) {
    const path = `${project.appDir}/${spec.target}`
    const abs = join(project.root, path)
    const content = renderTemplate(
      readFileSync(join(options.templatesDir, spec.template), 'utf8'),
      project,
      path,
    )

    if (!existsSync(abs)) {
      writeFile(project.root, path, content, options.dryRun)
      actions.push({ path, status: 'created' })
      continue
    }
    const current = readFileSync(abs, 'utf8')
    if (current === content) {
      actions.push({ path, status: 'unchanged' })
      continue
    }
    if (options.force && spec.policy !== 'create-only') {
      writeFile(project.root, path, content, options.dryRun)
      actions.push({ path, status: 'overwritten' })
      continue
    }
    actions.push({
      path,
      status: 'skipped',
      note:
        spec.policy === 'create-only' && options.force
          ? 'nie nadpisujemy stron aplikacji'
          : undefined,
    })
    const warning = checkExisting(spec, current, path)
    if (warning) warnings.push(warning)
  }

  actions.push(updateEnvExample(project.root, options.dryRun))

  return { project, actions, warnings, manualSteps: manualSteps(project, actions) }
}

const STATUS_LABEL: Record<FileStatus, string> = {
  created: 'utworzono',
  overwritten: 'nadpisano',
  skipped: 'pominięto (istnieje)',
  unchanged: 'bez zmian',
  appended: 'dopisano',
}

// Same statuses in the future tense — `--dry-run` reports what WOULD happen.
const STATUS_LABEL_DRY_RUN: Record<FileStatus, string> = {
  created: 'utworzę',
  overwritten: 'nadpiszę',
  skipped: 'pominę (istnieje)',
  unchanged: 'bez zmian',
  appended: 'dopiszę',
}

export function formatReport(result: InitResult, options: Pick<InitOptions, 'dryRun'>): string[] {
  const { project } = result
  const lines: string[] = []
  lines.push('@musikhood-dev/auth-client init')
  if (options.dryRun) lines.push('Tryb --dry-run: nic nie zostanie zapisane.')
  lines.push('')
  lines.push(`  framework: ${project.frameworkLabel} (katalog ${project.appDir}/)`)
  lines.push(
    `  importy:   ${project.alias ? `alias ${project.alias} (tsconfig)` : 'ścieżki względne (brak aliasu w tsconfig)'}`,
  )
  lines.push(
    `  UI:        ${project.ui.kind === 'shadcn' ? `shadcn/ui (${project.ui.dir})` : `bez zależności UI — ${project.ui.reason}`}${project.tailwind ? ', Tailwind' : ''}`,
  )
  lines.push(
    `  toast:     ${project.toastModule ?? 'nie wykryto — miejsce do podpięcia w lib/auth.ts (reportAuthError)'}`,
  )
  lines.push('')

  const labels = options.dryRun ? STATUS_LABEL_DRY_RUN : STATUS_LABEL
  const width = Math.max(...Object.values(labels).map((label) => label.length))
  for (const action of result.actions) {
    const note = action.note ? `  (${action.note})` : ''
    lines.push(`  ${labels[action.status].padEnd(width)}  ${action.path}${note}`)
  }

  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('Uwaga:')
    for (const warning of result.warnings) lines.push(`  ! ${warning}`)
  }

  lines.push('')
  lines.push('Dalej ręcznie:')
  result.manualSteps.forEach((step, index) => {
    lines.push('')
    lines.push(`${index + 1}. ${step}`)
  })
  lines.push('')
  lines.push(
    'Backend (panel w auth-panelu, bundle): https://github.com/musikhood/auth-client-bundle/blob/main/INTEGRATION.md',
  )
  return lines
}
