// Test helpers: builds minimal consumer projects (React Router 7 with/without shadcn,
// Vue 3) in a temp directory for the `init` CLI tests.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

export type FixtureKind = 'react-shadcn' | 'react-plain' | 'vue' | 'vue-shadcn'

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

// shadcn-vue: one directory per component with an index.ts re-export (SFC stubs).
const sfc = (template: string, script = '') =>
  `<script setup lang="ts">\n${script}</script>\n\n<template>\n  ${template}\n</template>\n`
const SHADCN_VUE_STUBS: Record<string, string> = {
  'components.json': JSON.stringify(
    {
      $schema: 'https://shadcn-vue.com/schema.json',
      style: 'new-york',
      typescript: true,
      aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components/ui' },
    },
    null,
    2,
  ),
  'src/components/ui/button/Button.vue': sfc(
    '<button><slot /></button>',
    `defineProps<{ variant?: 'default' | 'outline' | 'link'; size?: 'default' | 'lg' }>()\n`,
  ),
  'src/components/ui/button/index.ts': `export { default as Button } from './Button.vue'\n`,
  'src/components/ui/input/Input.vue': sfc(
    '<input :value="modelValue" @input="emit(\'update:modelValue\', ($event.target as HTMLInputElement).value)" />',
    `defineProps<{ modelValue?: string | number }>()\nconst emit = defineEmits<{ (e: 'update:modelValue', value: string | number): void }>()\n`,
  ),
  'src/components/ui/input/index.ts': `export { default as Input } from './Input.vue'\n`,
  'src/components/ui/label/Label.vue': sfc(
    '<label><slot /></label>',
    `defineProps<{ for?: string }>()\n`,
  ),
  'src/components/ui/label/index.ts': `export { default as Label } from './Label.vue'\n`,
  'src/components/ui/dialog/Dialog.vue': sfc(
    '<div v-if="open"><slot /></div>',
    `defineProps<{ open?: boolean }>()\n`,
  ),
  'src/components/ui/dialog/DialogContent.vue': sfc(
    '<div role="dialog"><slot /><button>X</button></div>',
    `defineEmits<{\n  escapeKeyDown: [event: KeyboardEvent]\n  pointerDownOutside: [event: Event]\n  interactOutside: [event: Event]\n}>()\n`,
  ),
  'src/components/ui/dialog/DialogHeader.vue': sfc('<div><slot /></div>'),
  'src/components/ui/dialog/DialogTitle.vue': sfc('<h2><slot /></h2>'),
  'src/components/ui/dialog/DialogDescription.vue': sfc('<p><slot /></p>'),
  'src/components/ui/dialog/index.ts': [
    'Dialog',
    'DialogContent',
    'DialogHeader',
    'DialogTitle',
    'DialogDescription',
  ]
    .map((name) => `export { default as ${name} } from './${name}.vue'`)
    .join('\n')
    .concat('\n'),
}

// Existing Vue + shadcn-vue app that already logs in (2.1-style auth), modelled on
// a real Vue panel before the 2FA pilot: VITE_BACKEND_URL, shadcn use-toast, vue-sonner listed but
// unused, its own LoginView on /login, plugins already installed in main.ts.
export const EXISTING_VUE_APP: Record<string, string> = {
  'src/lib/auth.ts': `import { createAuthClient } from '@musikhood-dev/auth-client'
import { toast } from '@/components/ui/toast/use-toast'

export const authClient = createAuthClient({
  baseUrl: import.meta.env.VITE_BACKEND_URL,
  loginPath: '/login',
  homePath: '/product-list',
})

authClient.on('login-error', () => {
  toast({ title: 'Nieprawidłowy email lub hasło', variant: 'destructive' })
})
`,
  'src/components/ui/toast/use-toast.ts': `export function toast(props: { title?: string; description?: string; variant?: 'default' | 'destructive' }): void {\n  void props\n}\n`,
  'src/components/ui/toast/index.ts': `export { toast } from './use-toast'\n`,
  'src/components/auth/LoginView.vue': sfc('<form />'),
  'src/router/index.ts': `import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '@/components/auth/LoginView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
    },
  ],
})
`,
  'src/main.ts': `import { createApp } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { createAuth } from '@musikhood-dev/auth-client/vue'
import router from './router/index'
import { authClient } from './lib/auth'
import App from './App.vue'

const app = createApp(App)
app.use(VueQueryPlugin)
app.use(router)
app.use(createAuth(authClient, { navigate: (path: string) => router.push(path) }))
app.mount('#app')
`,
  'src/App.vue': sfc('<RouterView />'),
  '.env.development': 'VITE_BACKEND_URL="https://api.example.com"\n',
  '.env.production': 'VITE_BACKEND_URL="https://api.example.com"\n',
}

export function createFixture(kind: FixtureKind, options: { sonner?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), `auth-client-init-${kind}-`))
  if (kind === 'vue' || kind === 'vue-shadcn') {
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
    if (kind === 'vue-shadcn') writeFiles(root, SHADCN_VUE_STUBS)
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
  // `npx shadcn add sonner` — the toast component is what marks sonner as used (a bare
  // package.json entry does not).
  if (kind === 'react-shadcn' && options.sonner) {
    writeFiles(root, {
      'app/components/ui/sonner.tsx': `export function Toaster() {\n  return null\n}\n`,
    })
  }
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
