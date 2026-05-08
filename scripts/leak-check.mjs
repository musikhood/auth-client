#!/usr/bin/env node
// Skanuje pliki staged (lub argumenty CLI) pod kątem prywatnych domen / identyfikatorów,
// żeby publiczne repo nie wyciekło niczego wewnętrznego.
import { execSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'

const FORBIDDEN_PATTERNS = [
  /vitkac\.com/i,
  /vitkac\.sni\.pl/i,
  /\bsni\.pl\b/i,
  /\bmusikhood\.(?!io\b|com\b)\w+/i,
]

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.lock', '.zip', '.gz', '.tgz',
])

function getFiles() {
  if (process.argv.length > 2) return process.argv.slice(2)
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
    return out.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const files = getFiles()
let leaked = false

for (const file of files) {
  if (SKIP_EXT.has(extname(file))) continue
  try {
    if (!statSync(file).isFile()) continue
  } catch {
    continue
  }
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    const m = content.match(pattern)
    if (m) {
      console.error(`leak-check: ${file} zawiera niedozwolony wzorzec: ${m[0]}`)
      leaked = true
    }
  }
}

if (leaked) {
  console.error('\nUsuń wpisy lub zastąp je generycznymi (np. https://auth.example.com).')
  process.exit(1)
}
