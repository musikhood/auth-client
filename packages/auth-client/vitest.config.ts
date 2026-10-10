import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    // Behaviour tests of the `init` templates (templates/*) import them directly; their
    // placeholders / package imports resolve to the shared templates and to src/.
    alias: [
      { find: /^@@\/lib\/(.*)$/, replacement: fromRoot('./templates/shared/lib/$1') },
      { find: /^@musikhood-dev\/auth-client$/, replacement: fromRoot('./src/index.ts') },
    ],
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.*', 'src/index.ts', 'src/react.ts', 'src/vue.ts'],
    },
  },
})
