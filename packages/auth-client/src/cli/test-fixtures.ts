// Test helpers: builds minimal consumer projects (React Router 7 with/without shadcn,
// Vue 3) in a temp directory for the `init` CLI tests.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

export type FixtureKind = 'react-shadcn' | 'react-plain' | 'vue'

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf8')
  }
}

const SHADCN_STUBS: Record<string, string> = {
  'components.json': JSON.stringify(
    {
      style: 'new-york',
      tsx: true,
      aliases: { components: '~/components', utils: '~/lib/utils', ui: '~/components/ui' },
    },
    null,
    2,
  ),
  'app/lib/utils.ts': `export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ')
}
`,
  'app/components/ui/button.tsx': `import type { ButtonHTMLAttributes } from 'react'
export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline'; size?: 'default' | 'lg' },
) {
  const { variant: _variant, size: _size, ...rest } = props
  return <button {...rest} />
}
`,
  'app/components/ui/input.tsx': `import type { InputHTMLAttributes } from 'react'
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />
}
`,
  'app/components/ui/label.tsx': `import type { LabelHTMLAttributes } from 'react'
export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} />
}
`,
  'app/components/ui/checkbox.tsx': `type CheckedState = boolean | 'indeterminate'
export function Checkbox(props: {
  id?: string
  checked?: CheckedState
  disabled?: boolean
  onCheckedChange?: (checked: CheckedState) => void
}) {
  return (
    <input
      type="checkbox"
      id={props.id}
      checked={props.checked === true}
      disabled={props.disabled}
      onChange={(e) => props.onCheckedChange?.(e.target.checked)}
    />
  )
}
`,
  'app/components/ui/dialog.tsx': `import type { HTMLAttributes, ReactNode } from 'react'
export function Dialog(props: { open?: boolean; onOpenChange?: (open: boolean) => void; children?: ReactNode }) {
  return props.open ? <>{props.children}</> : null
}
export function DialogContent(
  props: HTMLAttributes<HTMLDivElement> & {
    showCloseButton?: boolean
    onEscapeKeyDown?: (event: KeyboardEvent) => void
    onInteractOutside?: (event: Event) => void
  },
) {
  const { showCloseButton: _s, onEscapeKeyDown: _e, onInteractOutside: _i, ...rest } = props
  return <div role="dialog" {...rest} />
}
export const DialogHeader = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />
export const DialogFooter = (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />
export const DialogTitle = (props: HTMLAttributes<HTMLHeadingElement>) => <h2 {...props} />
export const DialogDescription = (props: HTMLAttributes<HTMLParagraphElement>) => <p {...props} />
`,
}

export function createFixture(kind: FixtureKind, options: { sonner?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), `auth-client-init-${kind}-`))
  if (kind === 'vue') {
    writeFiles(root, {
      'package.json': JSON.stringify(
        {
          name: 'fixture-vue',
          private: true,
          dependencies: {
            vue: '^3.5.0',
            'vue-router': '^4.4.0',
            '@tanstack/vue-query': '^5.59.0',
            '@musikhood-dev/auth-client': '^2.3.0',
          },
        },
        null,
        2,
      ),
      // create-vue layout: aliases live in tsconfig.app.json (referenced, with comments).
      'tsconfig.json': `{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }],
}
`,
      'tsconfig.app.json': `{
  // create-vue style
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }, /* alias */
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
`,
      'src/main.ts': `export {}\n`,
    })
    return root
  }

  const dependencies: Record<string, string> = {
    react: '^19.1.1',
    'react-dom': '^19.1.1',
    'react-router': '^7.13.0',
    '@tanstack/react-query': '^5.100.0',
    '@musikhood-dev/auth-client': '^2.3.0',
  }
  if (options.sonner) dependencies.sonner = '^2.0.7'
  writeFiles(root, {
    'package.json': JSON.stringify(
      {
        name: `fixture-${kind}`,
        private: true,
        type: 'module',
        dependencies,
        devDependencies: { '@react-router/dev': '^7.13.0', tailwindcss: '^4.2.0' },
      },
      null,
      2,
    ),
    'tsconfig.json': `{
  "include": ["**/*"],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "~/*": ["./app/*"] },
    "jsx": "react-jsx",
    "strict": true
  }
}
`,
    'app/root.tsx': `export default function App() {\n  return null\n}\n`,
    'app/routes.ts': `export default []\n`,
  })
  if (kind === 'react-shadcn') writeFiles(root, SHADCN_STUBS)
  return root
}

// Snapshot of every file (path → content) to compare runs.
export function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) walk(abs)
      else out[relative(root, abs).split('\\').join('/')] = readFileSync(abs, 'utf8')
    }
  }
  walk(root)
  return out
}
