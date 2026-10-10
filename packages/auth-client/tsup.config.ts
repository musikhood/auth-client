import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      react: 'src/react.ts',
      vue: 'src/vue.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    // dist/ is cleaned by the `build` script — both configs run in parallel, so a
    // per-config clean could wipe the other one's output.
    clean: false,
    treeshake: true,
    splitting: false,
    target: 'es2022',
    external: ['react', 'react-dom', 'vue', '@tanstack/react-query', '@tanstack/vue-query'],
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.mjs' }
    },
  },
  {
    // `npx @musikhood-dev/auth-client init` — plain Node >= 18, no runtime deps.
    entry: { cli: 'src/cli/bin.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node18',
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
    outExtension() {
      return { js: '.mjs' }
    },
  },
])
