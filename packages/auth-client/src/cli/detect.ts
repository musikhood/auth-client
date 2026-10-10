import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { parseJsonc } from './jsonc.js'

export type Framework = 'react' | 'vue'

export type UiKit =
  | {
      kind: 'shadcn'
      // Directory of the shadcn components, relative to the project root.
      dir: string
      // Import specifiers from components.json (or derived from the alias).
      uiImport: string | null
      utilsImport: string | null
      // Newer shadcn <DialogContent> has `showCloseButton`; older versions do not.
      dialogCloseButtonProp: boolean
    }
  | { kind: 'plain'; reason: string }

export interface ProjectInfo {
  root: string
  framework: Framework
  frameworkLabel: string
  reactRouter: boolean
  vueRouter: boolean
  // App source dir relative to root ('app' for React Router 7, 'src' for Vue).
  appDir: string
  // Import alias pointing at appDir (e.g. '~/', '@/'); null = relative imports.
  alias: string | null
  ui: UiKit
  tailwind: boolean
  // Toast library found in dependencies (used by the generated lib/auth.ts).
  toastModule: 'sonner' | 'vue-sonner' | null
  // Packages the generated code needs but package.json does not list.
  missingDeps: string[]
}

export class DetectError extends Error {
  override name = 'DetectError'
}

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

type TsConfig = {
  extends?: string | string[]
  references?: { path: string }[]
  compilerOptions?: {
    baseUrl?: string
    paths?: Record<string, string[]>
  }
}

const SHADCN_COMPONENTS = ['button', 'dialog', 'input', 'label', 'checkbox'] as const

function readJsonFile<T>(file: string): T | null {
  if (!existsSync(file)) return null
  try {
    return parseJsonc(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

// First number of a semver range ('^7.13.0' → 7). null = unknown (workspace:*, latest, git url).
export function majorOf(range: string | undefined): number | null {
  if (!range) return null
  const match = /(\d+)/.exec(range)
  return match ? Number(match[1]) : null
}

function atLeast(range: string | undefined, major: number): boolean {
  if (range === undefined) return false
  const parsed = majorOf(range)
  return parsed === null || parsed >= major
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

// Collects `compilerOptions.paths` from tsconfig.json and the configs it extends /
// references (create-vue keeps paths in tsconfig.app.json). Targets are resolved to
// project-root-relative posix paths.
function collectPaths(root: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const visited = new Set<string>()

  const visit = (file: string) => {
    const abs = resolve(file)
    if (visited.has(abs)) return
    visited.add(abs)
    const config = readJsonFile<TsConfig>(abs)
    if (!config) return
    const dir = dirname(abs)

    const extendsList = Array.isArray(config.extends)
      ? config.extends
      : config.extends
        ? [config.extends]
        : []
    for (const ext of extendsList) {
      // Only local configs — package presets (@tsconfig/*) never declare app aliases.
      if (ext.startsWith('.')) visit(resolve(dir, ext.endsWith('.json') ? ext : `${ext}.json`))
    }

    const options = config.compilerOptions
    if (options?.paths) {
      const base = resolve(dir, options.baseUrl ?? '.')
      for (const [key, targets] of Object.entries(options.paths)) {
        result.set(
          key,
          targets.map((target) => toPosix(relative(root, resolve(base, target)))),
        )
      }
    }

    for (const ref of config.references ?? []) {
      const refPath = resolve(dir, ref.path)
      visit(refPath.endsWith('.json') ? refPath : join(refPath, 'tsconfig.json'))
    }
  }

  visit(join(root, 'tsconfig.json'))
  return result
}

function detectAlias(root: string, appDir: string, preferred: string[]): string | null {
  const paths = collectPaths(root)
  const matching: string[] = []
  for (const [key, targets] of paths) {
    if (!key.endsWith('/*')) continue
    if (targets.some((target) => target === `${appDir}/*`)) matching.push(key.slice(0, -1))
  }
  for (const alias of preferred) {
    if (matching.includes(alias)) return alias
  }
  return matching[0] ?? null
}

function detectUi(root: string, appDir: string): UiKit {
  const componentsJson = readJsonFile<{ aliases?: { ui?: string; utils?: string } }>(
    join(root, 'components.json'),
  )
  if (!componentsJson) return { kind: 'plain', reason: 'brak components.json' }

  const candidates = [`${appDir}/components/ui`, 'app/components/ui', 'src/components/ui']
  const dir = candidates.find((candidate) =>
    SHADCN_COMPONENTS.every((name) => existsSync(join(root, candidate, `${name}.tsx`))),
  )
  if (!dir) {
    return {
      kind: 'plain',
      reason: `components.json jest, ale brak kompletu komponentów (${SHADCN_COMPONENTS.join(', ')}) w components/ui`,
    }
  }
  const dialogSource = readFileSync(join(root, dir, 'dialog.tsx'), 'utf8')
  return {
    kind: 'shadcn',
    dir,
    uiImport: componentsJson.aliases?.ui ?? null,
    utilsImport: componentsJson.aliases?.utils ?? null,
    dialogCloseButtonProp: dialogSource.includes('showCloseButton'),
  }
}

export function detectProject(root: string, override?: Framework): ProjectInfo {
  const pkg = readJsonFile<PackageJson>(join(root, 'package.json'))
  if (!pkg) throw new DetectError(`Nie znaleziono package.json w ${root}`)
  const deps: Record<string, string> = {
    ...pkg.peerDependencies,
    ...pkg.devDependencies,
    ...pkg.dependencies,
  }

  const reactRouter = '@react-router/dev' in deps || atLeast(deps['react-router'], 7)
  const isVue = atLeast(deps.vue, 3)
  const isReact = 'react' in deps

  let framework: Framework
  if (override) framework = override
  else if (reactRouter) framework = 'react'
  else if (isVue) framework = 'vue'
  else if (isReact) framework = 'react'
  else {
    throw new DetectError(
      'Nie rozpoznano frameworka (oczekiwano React Router 7 albo Vue 3 w package.json). Użyj --framework react|vue.',
    )
  }

  const hasDir = (dir: string) => existsSync(join(root, dir))
  const appDir =
    framework === 'vue'
      ? 'src'
      : reactRouter
        ? hasDir('app') || !hasDir('src')
          ? 'app'
          : 'src'
        : hasDir('src') || !hasDir('app')
          ? 'src'
          : 'app'

  const alias = detectAlias(root, appDir, framework === 'vue' ? ['@/', '~/'] : ['~/', '@/'])

  const ui: UiKit =
    framework === 'react'
      ? detectUi(root, appDir)
      : { kind: 'plain', reason: 'Vue — wariant bez zależności UI' }

  const toastModule =
    framework === 'react'
      ? 'sonner' in deps
        ? 'sonner'
        : null
      : 'vue-sonner' in deps
        ? 'vue-sonner'
        : null

  const required =
    framework === 'react'
      ? ['@musikhood-dev/auth-client', '@tanstack/react-query']
      : ['@musikhood-dev/auth-client', '@tanstack/vue-query']

  return {
    root,
    framework,
    frameworkLabel:
      framework === 'vue' ? 'Vue 3' : reactRouter ? 'React Router 7' : 'React (bez React Router 7)',
    reactRouter: framework === 'react' && reactRouter,
    vueRouter: framework === 'vue' && 'vue-router' in deps,
    appDir,
    alias,
    ui,
    tailwind: 'tailwindcss' in deps || '@tailwindcss/vite' in deps,
    toastModule,
    missingDeps: required.filter((name) => !(name in deps)),
  }
}
