import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import process from 'node:process'
import { DetectError, type Framework } from './detect.js'
import { AI_GUIDE, formatReport, runInit } from './init.js'

export interface CliIo {
  out: (line: string) => void
  err: (line: string) => void
}

export const HELP = `Użycie: npx @musikhood-dev/auth-client init [opcje]

Dodaje do aplikacji (React Router 7 / Vue 3) klienta auth, logowanie z 2FA
i globalne dialogi 2FA. Bez sieci, bez zależności od rejestru shadcn.

Opcje:
  --dry-run              pokaż, co zostanie utworzone/zmienione — nic nie zapisuj
  --force                nadpisz istniejące pliki (poza istniejącą stroną logowania)
  --cwd <katalog>        katalog aplikacji (domyślnie bieżący)
  --framework react|vue  wymuś framework (domyślnie wykrywany z package.json)
  --env-var <NAZWA>      zmienna z adresem API (domyślnie wykrywana z lib/auth.ts
                         i plików .env*, inaczej VITE_API_BASE_URL)
  --skip-format          nie formatuj wygenerowanych plików prettierem repo
  --yes, -y              bez pytań (init i tak nie zadaje pytań)
  --help, -h             ta pomoc`

// Templates ship next to dist/ (and next to src/ in the repo): walk up from this file.
export function findTemplatesDir(start: string = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start
  for (;;) {
    const candidate = join(dir, 'templates')
    if (existsSync(join(dir, 'package.json')) && existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Nie znaleziono katalogu templates/ paczki auth-client')
    dir = parent
  }
}

function isFramework(value: string | undefined): value is Framework {
  return value === 'react' || value === 'vue'
}

// Returns the process exit code.
export function main(argv: string[], io: CliIo, templatesDir?: string): number {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(argv)
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error))
    io.err('')
    io.err(HELP)
    return 1
  }
  const { values, positionals } = parsed

  if (values.help || positionals.length === 0) {
    io.out(HELP)
    return values.help ? 0 : 1
  }
  if (positionals[0] !== 'init' || positionals.length > 1) {
    io.err(`Nieznana komenda: ${positionals.join(' ')}`)
    io.err('')
    io.err(HELP)
    return 1
  }
  if (values.framework !== undefined && !isFramework(values.framework)) {
    io.err(`--framework: oczekiwano react albo vue, podano "${values.framework}"`)
    return 1
  }

  const options = {
    cwd: resolve(values.cwd ?? process.cwd()),
    dryRun: values['dry-run'] ?? false,
    force: values.force ?? false,
    framework: values.framework,
    envVar: values['env-var'],
    skipFormat: values['skip-format'] ?? false,
    templatesDir: templatesDir ?? findTemplatesDir(),
  }
  if (options.envVar !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(options.envVar)) {
    io.err(
      `--env-var: oczekiwano nazwy zmiennej (np. VITE_BACKEND_URL), podano "${options.envVar}"`,
    )
    return 1
  }
  try {
    const result = runInit(options)
    const guide = join(dirname(options.templatesDir), AI_GUIDE)
    // Relative inside the project (node_modules/…), absolute otherwise (e.g. a linked checkout).
    const relativeGuide = relative(options.cwd, guide)
    const guidePath = !existsSync(guide)
      ? null
      : relativeGuide && !relativeGuide.startsWith('..')
        ? relativeGuide
        : guide
    for (const line of formatReport(result, { dryRun: options.dryRun, guidePath })) io.out(line)
    return 0
  } catch (error) {
    if (error instanceof DetectError) {
      io.err(error.message)
      return 1
    }
    throw error
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      'dry-run': { type: 'boolean' },
      force: { type: 'boolean' },
      cwd: { type: 'string' },
      framework: { type: 'string' },
      'env-var': { type: 'string' },
      'skip-format': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
    },
  })
}
