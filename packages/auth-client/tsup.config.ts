import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
    vue: 'src/vue.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  external: ['react', 'react-dom', 'vue', '@tanstack/react-query', '@tanstack/vue-query'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' }
  },
})
