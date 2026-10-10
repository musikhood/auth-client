// Minimal JSONC reader for tsconfig.json / components.json: strips // and /* */ comments
// and trailing commas OUTSIDE strings (tsconfig paths like "@/*" contain "/*" inside
// strings, so a naive regex would break them).
export function stripJsonComments(input: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < input.length) {
    const ch = input[i] as string
    const next = input[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return removeTrailingCommas(out)
}

function removeTrailingCommas(input: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += input[i + 1] ?? ''
        i++
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === ',') {
      let j = i + 1
      while (j < input.length && /\s/.test(input[j] as string)) j++
      if (input[j] === '}' || input[j] === ']') continue
    }
    out += ch
  }
  return out
}

export function parseJsonc(input: string): unknown {
  return JSON.parse(stripJsonComments(input))
}
