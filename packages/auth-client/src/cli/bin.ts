// Entry of the `auth-client` bin (npx @musikhood-dev/auth-client init).
// stdout/stderr ARE the CLI's UI — the only place in the package that prints.
import process from 'node:process'
import { main } from './main.js'

process.exitCode = main(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
})
