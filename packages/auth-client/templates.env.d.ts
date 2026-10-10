// import.meta.env for the type-check of the template behaviour test (tsconfig.templates.json):
// the generated lib/auth.ts reads the API base URL from it. Consumer apps get it from Vite.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
