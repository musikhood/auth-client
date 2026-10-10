import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { detectProject, GENERATED_MARKER, type Framework, type ProjectInfo } from './detect.js'

export interface InitOptions {
  cwd: string
  dryRun: boolean
  force: boolean
  framework?: Framework
  // --env-var: env variable with the API base URL (default: detected).
  envVar?: string
  // --skip-format: do not run the repo's prettier on the generated files.
  skipFormat?: boolean
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
  // Style of the generated files: formatted with the repo's prettier, or left as shipped.
  formatting: string
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

// Key used in the shipped templates; replaced by the detected / --env-var key.
const TEMPLATE_ENV_KEY = 'VITE_API_BASE_URL'
const envBlock = (key: string) =>
  `# auth-client: adres API (auth server / backend panelu), np. https://api.example.com\n${key}=\n`

// Shipped next to templates/ in the package (see "files" in package.json).
export const AI_GUIDE = 'AI_INTEGRATION.md'

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

function libAuthTemplate(project: ProjectInfo): string {
  if (!project.toast) return 'shared/lib/auth.ts'
  return project.toast.kind === 'use-toast'
    ? 'shared/lib/auth.use-toast.ts'
    : 'shared/lib/auth.toast.ts'
}

// Vue components in generation order. Shared by both Vue variants: the ones that only
// compose AuthModal / MfaCodeForm.
const VUE_FILES = [
  'AuthModal.vue',
  'MfaCodeForm.vue',
  'MfaStepUpDialog.vue',
  'MfaEnrollmentRequiredDialog.vue',
  'AuthMfaDialogs.vue',
  'LoginForm.vue',
]
const VUE_SHARED = ['MfaStepUpDialog.vue', 'AuthMfaDialogs.vue']

function fileSpecs(project: ProjectInfo): FileSpec[] {
  const libAuth: FileSpec = {
    template: libAuthTemplate(project),
    target: 'lib/auth.ts',
    requiredExports: LIB_AUTH_EXPORTS,
  }
  const libMfa: FileSpec = {
    template: 'shared/lib/mfa.ts',
    target: 'lib/mfa.ts',
    requiredExports: LIB_MFA_EXPORTS,
    requiredKeys: LIB_MFA_KEYS,
  }
  // An existing login page of the app gets a merge recipe instead of a generated form.
  const generateLogin = project.loginPage === null

  if (project.framework === 'vue') {
    const variant = project.ui.kind === 'shadcn' ? 'vue-shadcn' : 'vue'
    const names = VUE_FILES.filter((name) => generateLogin || name !== 'LoginForm.vue')
    return [
      libAuth,
      libMfa,
      ...names.map((name) => ({
        template: `${VUE_SHARED.includes(name) ? 'vue' : variant}/components/auth/${name}`,
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
    ...(generateLogin ? ['login-form.tsx'] : []),
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
  if (project.reactRouter && generateLogin) {
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
  const toast = project.toast
  if (toast) {
    const specifier = toast.appModule ? importPath(project, targetFile, toast.module) : toast.module
    out = out.split('@@toast-module').join(specifier)
  }
  if (project.env.key !== TEMPLATE_ENV_KEY) {
    out = out
      .split(`import.meta.env.${TEMPLATE_ENV_KEY}`)
      .join(`import.meta.env.${project.env.key}`)
  }
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

function updateEnvExample(project: ProjectInfo, dryRun: boolean): FileAction {
  const path = '.env.example'
  const { key, definedIn } = project.env
  // The key is already documented in some env file of the app — nothing to propose.
  if (definedIn.length > 0) {
    return { path, status: 'unchanged', note: `${key} już jest w ${definedIn.join(', ')}` }
  }
  const abs = join(project.root, path)
  if (!existsSync(abs)) {
    writeFile(project.root, path, envBlock(key), dryRun)
    return { path, status: 'created', note: key }
  }
  const current = readFileSync(abs, 'utf8')
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n'
  writeFile(project.root, path, `${current}${separator}${envBlock(key)}`, dryRun)
  return { path, status: 'appended', note: key }
}

const indent = (lines: string[]) => lines.map((line) => (line ? `    ${line}` : '')).join('\n')

// Paste-ready part of the generated lib/auth.ts for an existing file: the inline-error
// filter, reportAuthError (wired to the detected toast) and the login-error listener.
function libAuthSnippet(project: ProjectInfo, templatesDir: string, path: string): string {
  const rendered = renderTemplate(
    readFileSync(join(templatesDir, libAuthTemplate(project)), 'utf8'),
    project,
    path,
  )
  const imports = rendered
    .split('\n')
    .filter((line) => line.startsWith('import '))
    .map((line) => line.replace('{ createAuthClient, isAuthErrorNamed }', '{ isAuthErrorNamed }'))
  const body = rendered.slice(rendered.indexOf('// Shown inline')).trimEnd().split('\n')
  return indent([...imports, '', ...body])
}

function loginRecipe(project: ProjectInfo, page: string): string {
  const vue = project.framework === 'vue'
  const form = vue ? 'MfaCodeForm.vue' : 'mfa-code-form'
  const formImport = importPath(project, page, `components/auth/${form}`)
  const mfaImport = importPath(project, page, 'lib/mfa')
  const reference = vue
    ? `templates/${project.ui.kind === 'shadcn' ? 'vue-shadcn' : 'vue'}/components/auth/LoginForm.vue`
    : `templates/${project.ui.kind === 'shadcn' ? 'react-shadcn' : 'react-plain'}/components/auth/login-form.tsx`
  const lines = vue
    ? [
        `import MfaCodeForm, { type MfaCodeSubmit } from '${formImport}'`,
        `import { useMfa } from '@musikhood-dev/auth-client/vue'`,
        `import { isAuthError, loginErrorMessage, MFA_TEXTS, mfaErrorMessage } from '${mfaImport}'`,
        ``,
        `const { stage, verify, reset } = useMfa()`,
        `const mfaError = ref<string | null>(null)`,
        ``,
        `// w catch logowania (zamiast własnego komunikatu):`,
        `if (isAuthError(e, 'MfaRequiredError')) return // stage === 'code' — krok kodu`,
        `if (isAuthError(e, 'MfaEnrollmentRequiredError')) {`,
        `  if (e.enrollmentUrl) window.location.assign(e.enrollmentUrl)`,
        `  else errorMessage.value = MFA_TEXTS.enrollmentFailed`,
        `  return`,
        `}`,
        `errorMessage.value = loginErrorMessage(e)`,
        ``,
        `async function handleMfaSubmit(data: MfaCodeSubmit) {`,
        `  mfaError.value = null`,
        `  try {`,
        `    await verify(data)`,
        `  } catch (e) {`,
        `    if (isAuthError(e, 'MfaTokenExpiredError')) {`,
        `      errorMessage.value = MFA_TEXTS.tokenExpired // klient wrócił już do kroku hasła`,
        `      return`,
        `    }`,
        `    mfaError.value = mfaErrorMessage(e) ?? MFA_TEXTS.verifyFailed`,
        `  }`,
        `}`,
        ``,
        `<!-- w szablonie: krok kodu zamiast formularza hasła, wygląd strony bez zmian -->`,
        `<MfaCodeForm v-if="stage === 'code'" :is-pending="verify.isPending.value" :error="mfaError"`,
        `  submit-label="Zweryfikuj" cancel-label="Wróć do logowania"`,
        `  @submit="handleMfaSubmit" @cancel="() => { mfaError = null; reset() }" />`,
        `<form v-else …>…obecny formularz…</form>`,
      ]
    : [
        `import { MfaCodeForm, type MfaCodeSubmit } from '${formImport}'`,
        `import { useMfa } from '@musikhood-dev/auth-client/react'`,
        `import { isAuthError, loginErrorMessage, MFA_TEXTS, mfaErrorMessage } from '${mfaImport}'`,
        ``,
        `const mfa = useMfa()`,
        `const [mfaError, setMfaError] = useState<string | null>(null)`,
        ``,
        `// w catch logowania (zamiast własnego komunikatu):`,
        `if (isAuthError(e, 'MfaRequiredError')) return // mfa.stage === 'code' — krok kodu`,
        `if (isAuthError(e, 'MfaEnrollmentRequiredError')) {`,
        `  if (e.enrollmentUrl) window.location.assign(e.enrollmentUrl)`,
        `  else setError(MFA_TEXTS.enrollmentFailed)`,
        `  return`,
        `}`,
        `setError(loginErrorMessage(e))`,
        ``,
        `// render: krok kodu zamiast formularza hasła, wygląd strony bez zmian`,
        `mfa.stage === 'code' ? (`,
        `  <MfaCodeForm isPending={mfa.verify.isPending} error={mfaError} submitLabel="Zweryfikuj"`,
        `    onSubmit={(data: MfaCodeSubmit) => void mfa.verify(data).catch((e: unknown) =>`,
        `      isAuthError(e, 'MfaTokenExpiredError') ? setError(MFA_TEXTS.tokenExpired)`,
        `        : setMfaError(mfaErrorMessage(e) ?? MFA_TEXTS.verifyFailed))}`,
        `    onCancel={() => { setMfaError(null); mfa.reset() }} cancelLabel="Wróć do logowania" />`,
        `) : (<form>…obecny formularz…</form>)`,
      ]
  return (
    `Masz już stronę logowania ${page} — LoginForm nie został wygenerowany. Dodaj w niej krok kodu 2FA` +
    ` (pełny wzór: node_modules/@musikhood-dev/auth-client/${reference}):\n\n${indent(lines)}`
  )
}

function manualSteps(project: ProjectInfo, actions: FileAction[]): string[] {
  const steps: string[] = []
  const app = project.appDir
  const { wiring } = project
  const actionFor = (path: string) => actions.find((action) => action.path === path)

  if (project.missingDeps.length > 0) {
    steps.push(`Zainstaluj brakujące paczki:\n\n    npm i ${project.missingDeps.join(' ')}`)
  }

  if (project.framework === 'react') {
    const rootFile = project.reactRouter ? `${app}/root.tsx` : `${app}/main.tsx`
    const auth = importPath(project, rootFile, 'lib/auth')
    const dialogs = importPath(project, rootFile, 'components/auth/auth-mfa-dialogs')
    if (wiring.provider === 'ok' && !wiring.dialogs) {
      steps.push(
        `${rootFile} — dodaj dialogi 2FA wewnątrz <AuthProvider> (np. obok <Outlet />):\n\n` +
          indent([`import { AuthMfaDialogs } from '${dialogs}'`, ``, `<AuthMfaDialogs />`]),
      )
    } else if (wiring.provider !== 'ok' && project.reactRouter) {
      steps.push(
        `${rootFile} — owiń <Outlet /> w AuthProvider i dodaj dialogi 2FA:\n\n` +
          indent([
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
          ]),
      )
    } else if (wiring.provider !== 'ok') {
      steps.push(
        `Owiń aplikację (np. w ${rootFile}) w AuthProvider i dodaj dialogi 2FA:\n\n` +
          indent([
            `import { AuthProvider } from '@musikhood-dev/auth-client/react'`,
            `import { authClient } from '${auth}'`,
            `import { AuthMfaDialogs } from '${dialogs}'`,
            ``,
            `<AuthProvider client={authClient}>`,
            `  <App />`,
            `  <AuthMfaDialogs />`,
            `</AuthProvider>`,
          ]),
      )
    }

    if (project.loginPage) {
      if (!project.loginPage.mfaStep) {
        steps.push(loginRecipe(project, project.loginPage.pageFile ?? project.loginPage.routeFile))
      }
    } else {
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
    }
  } else {
    const mainFile = `${app}/main.ts`
    const appFile = `${app}/App.vue`
    const navigate = project.vueRouter
      ? `createAuth(authClient, { navigate: (path) => router.push(path) })`
      : `createAuth(authClient)`
    if (wiring.provider === 'wrong-order') {
      steps.push(
        `${mainFile} — app.use(VueQueryPlugin) musi być PRZED app.use(createAuth(...)) — zamień kolejność.`,
      )
    } else if (wiring.provider === 'missing') {
      steps.push(
        `${mainFile} — zainstaluj pluginy (VueQueryPlugin przed createAuth):\n\n` +
          indent([
            `import { VueQueryPlugin } from '@tanstack/vue-query'`,
            `import { createAuth } from '@musikhood-dev/auth-client/vue'`,
            `import { authClient } from '${importPath(project, mainFile, 'lib/auth')}'`,
            ``,
            `app.use(VueQueryPlugin)`,
            `app.use(${navigate})`,
          ]),
      )
    }
    if (!wiring.dialogs) {
      steps.push(
        `${appFile} — dodaj dialogi 2FA (poza <AuthBoundary> jest OK):\n\n` +
          indent([
            `<script setup lang="ts">`,
            `import AuthMfaDialogs from '${importPath(project, appFile, 'components/auth/AuthMfaDialogs.vue')}'`,
            `</script>`,
            ``,
            `<template>`,
            project.vueRouter ? `  <RouterView />` : `  <!-- twoja aplikacja -->`,
            `  <AuthMfaDialogs />`,
            `</template>`,
          ]),
      )
    }
    if (project.loginPage) {
      if (!project.loginPage.mfaStep) {
        steps.push(loginRecipe(project, project.loginPage.pageFile ?? project.loginPage.routeFile))
      }
    } else {
      steps.push(
        `Formularz logowania: LoginForm z '${importPath(project, appFile, 'components/auth/LoginForm.vue')}' — wyrenderuj go na /login wewnątrz <AuthBoundary mode="guest">.`,
      )
    }
  }

  const envStep = project.env.hasValue
    ? null
    : `Ustaw ${project.env.key} w .env (wzór: .env.example).`
  const boundaryStep = wiring.boundary
    ? null
    : 'Trasy chronione owiń w <AuthBoundary> (np. w layoucie).'
  const tail = [envStep, boundaryStep].filter((step): step is string => step !== null)
  if (tail.length > 0) steps.push(tail.join(' '))
  return steps
}

// Formats the files written in this run with the repo's prettier (local install + config).
function formatFiles(project: ProjectInfo, paths: string[], options: InitOptions): string {
  if (!project.prettier) {
    return 'brak prettier w repo — pliki w stylu paczki (pojedyncze cudzysłowy, bez średników)'
  }
  if (options.skipFormat)
    return `prettier pominięty (--skip-format; konfiguracja: ${project.prettier.config})`
  if (options.dryRun || paths.length === 0) return `prettier repo (${project.prettier.config})`
  try {
    execFileSync(process.execPath, [project.prettier.bin, '--write', ...paths], {
      cwd: project.root,
      stdio: 'pipe',
    })
    return `sformatowano prettierem repo (${project.prettier.config})`
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return `prettier nie zadziałał (${message}) — pliki w stylu paczki`
  }
}

export function runInit(options: InitOptions): InitResult {
  const project = detectProject(options.cwd, {
    framework: options.framework,
    envVar: options.envVar,
  })
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
    if (warning) {
      warnings.push(
        spec.target === 'lib/auth.ts'
          ? `${warning}\n\n    Fragment do wklejenia${/on\(\s*['"]login-error/.test(current) ? ' (zastąp nim obecny listener login-error)' : ''}:\n\n${libAuthSnippet(project, options.templatesDir, path)}`
          : warning,
      )
    }
  }

  actions.push(updateEnvExample(project, options.dryRun))

  const written = actions
    .filter((action) => action.status === 'created' || action.status === 'overwritten')
    .map((action) => action.path)
    .filter((path) => /\.(?:ts|tsx|vue)$/.test(path))
  const formatting = formatFiles(project, written, options)

  return { project, actions, warnings, manualSteps: manualSteps(project, actions), formatting }
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

export interface ReportContext {
  dryRun: boolean
  // Path to AI_INTEGRATION.md shipped with the package (relative to the project), if any.
  guidePath?: string | null
}

export function formatReport(result: InitResult, options: ReportContext): string[] {
  const { project } = result
  const lines: string[] = []
  lines.push('@musikhood-dev/auth-client init')
  if (options.dryRun) lines.push('Tryb --dry-run: nic nie zostanie zapisane.')
  lines.push('')
  lines.push(`  framework: ${project.frameworkLabel} (katalog ${project.appDir}/)`)
  lines.push(
    `  importy:   ${project.alias ? `alias ${project.alias} (tsconfig)` : 'ścieżki względne (brak aliasu w tsconfig)'}`,
  )
  const uiLabel =
    project.ui.kind === 'shadcn'
      ? `${project.framework === 'vue' ? 'shadcn-vue' : 'shadcn/ui'} (${project.ui.dir})`
      : `bez zależności UI — ${project.ui.reason}`
  lines.push(`  UI:        ${uiLabel}${project.tailwind ? ', Tailwind' : ''}`)
  const toast = project.toast
  const unused = project.unusedToastDeps.length
    ? ` (${project.unusedToastDeps.join(', ')} w package.json, ale nieużywany — pominięty)`
    : ''
  lines.push(
    `  toast:     ${
      toast
        ? `${toast.kind === 'use-toast' ? 'shadcn use-toast' : toast.kind} — ${toast.appModule ? `${project.alias ?? ''}${toast.module}` : toast.module} (wykryto: ${toast.source})`
        : 'nie wykryto — miejsce do podpięcia w lib/auth.ts (reportAuthError)'
    }${unused}`,
  )
  lines.push(`  API URL:   ${project.env.key} (źródło: ${project.env.source})`)
  if (project.loginPage) {
    lines.push(
      `  logowanie: istniejąca strona ${project.loginPage.pageFile ?? '?'} (trasa w ${project.loginPage.routeFile}) — bez LoginForm${project.loginPage.mfaStep ? ', krok kodu 2FA już jest' : ''}`,
    )
  }
  lines.push(`  styl:      ${result.formatting}`)
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
  if (result.manualSteps.length === 0) {
    lines.push('Dalej ręcznie: nic — wpięcie jest już kompletne.')
  } else {
    lines.push('Dalej ręcznie:')
    result.manualSteps.forEach((step, index) => {
      lines.push('')
      lines.push(`${index + 1}. ${step}`)
    })
  }
  lines.push('')
  lines.push(
    `Instrukcja integracji (dla agenta AI): ${options.guidePath ?? `node_modules/@musikhood-dev/auth-client/${AI_GUIDE}`}`,
  )
  lines.push(
    'Backend z bundlem: vendor/musikhood/auth-client-bundle/AI_INTEGRATION.md (bin/console auth-client:doctor)',
  )
  return lines
}
