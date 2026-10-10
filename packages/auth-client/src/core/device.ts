// Device fingerprint (2FA / session binding). Collected in the browser, sent as
// `device` in login / refresh / MFA bodies and hashed into the `X-Device-Fp`
// header on every request. The server compares it with the session-bound one.
//
// CONTRACT with the auth server (`DeviceFingerprint.php`): the hash is SHA-256 (hex) of
// the canonical JSON of the NORMALIZED components — keys sorted, null / empty
// dropped, strings trimmed and cut to 256 chars, languages ≤ 10 × 35 chars.
// Both sides share a test vector (device.test.ts ↔ DeviceFingerprintTest.php).
//
// No external libraries, SSR-safe (no `window` → no fingerprint), result cached
// in memory for the lifetime of the page.

export type DeviceComponents = {
  // hard
  browserFamily?: string
  browserMajor?: number
  os?: string
  platform?: string
  // medium
  hardwareConcurrency?: number
  deviceMemory?: number
  webglVendor?: string
  webglRenderer?: string
  timezone?: string
  languages?: string[]
  // soft
  screen?: string
  colorDepth?: number
  canvasHash?: string
  touchPoints?: number
}

export type DeviceFingerprint = {
  components: DeviceComponents
  hash: string
}

const COMPONENT_KEYS: ReadonlyArray<keyof DeviceComponents> = [
  'browserFamily',
  'browserMajor',
  'os',
  'platform',
  'hardwareConcurrency',
  'deviceMemory',
  'webglVendor',
  'webglRenderer',
  'timezone',
  'languages',
  'screen',
  'colorDepth',
  'canvasHash',
  'touchPoints',
]

const MAX_STRING = 256
const MAX_LANGUAGES = 10
const MAX_LANGUAGE = 35

type ComponentValue = string | number | string[]

// Same normalization as the server — anything else would make hashes differ.
export function normalizeComponents(raw: DeviceComponents): Record<string, ComponentValue> {
  const out: Record<string, ComponentValue> = {}
  for (const key of COMPONENT_KEYS) {
    const value: unknown = raw[key]
    if (value === null || value === undefined) continue
    if (key === 'languages') {
      if (!Array.isArray(value)) continue
      const langs = value
        .slice(0, MAX_LANGUAGES)
        .filter((l): l is string => typeof l === 'string' && l !== '')
        .map((l) => l.slice(0, MAX_LANGUAGE))
      if (langs.length > 0) out[key] = langs
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '') out[key] = trimmed.slice(0, MAX_STRING)
    }
  }
  return out
}

export function canonicalJson(components: Record<string, ComponentValue>): string {
  const sorted: Record<string, ComponentValue> = {}
  for (const key of Object.keys(components).sort()) {
    const value = components[key]
    if (value !== undefined) sorted[key] = value
  }
  return JSON.stringify(sorted)
}

export async function sha256Hex(input: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashComponents(components: DeviceComponents): Promise<string | null> {
  return sha256Hex(canonicalJson(normalizeComponents(components)))
}

export type ParsedUserAgent = {
  browserFamily?: string
  browserMajor?: number
  os?: string
}

// Lightweight UA parsing — only family, major version and OS. Order matters
// (Edge/Opera/Samsung contain "Chrome", Chrome contains "Safari").
export function parseUserAgent(ua: string): ParsedUserAgent {
  const result: ParsedUserAgent = {}
  const browsers: Array<[string, RegExp]> = [
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /(?:OPR|Opera)\/(\d+)/],
    ['Samsung Internet', /SamsungBrowser\/(\d+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+).*Safari/],
  ]
  for (const [family, re] of browsers) {
    const m = re.exec(ua)
    if (m) {
      result.browserFamily = family
      result.browserMajor = Number(m[1])
      break
    }
  }

  if (/Windows/.test(ua)) result.os = 'Windows'
  else if (/iPhone|iPad|iPod/.test(ua)) result.os = 'iOS'
  else if (/Android/.test(ua)) result.os = 'Android'
  else if (/CrOS/.test(ua)) result.os = 'ChromeOS'
  else if (/Mac OS X|Macintosh/.test(ua)) result.os = 'macOS'
  else if (/Linux/.test(ua)) result.os = 'Linux'

  return result
}

type UADataBrand = { brand: string; version: string }
type NavigatorWithUAData = Navigator & {
  userAgentData?: { brands?: UADataBrand[]; platform?: string; mobile?: boolean }
  deviceMemory?: number
}

function fromUserAgentData(nav: NavigatorWithUAData): ParsedUserAgent {
  const data = nav.userAgentData
  if (!data) return {}
  const result: ParsedUserAgent = {}
  const brands = (data.brands ?? []).filter((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand))
  const brand = brands[0]
  if (brand) {
    result.browserFamily =
      brand.brand === 'Google Chrome' ? 'Chrome' : brand.brand.replace(/^Microsoft /, '')
    const major = Number.parseInt(brand.version, 10)
    if (Number.isFinite(major)) result.browserMajor = major
  }
  if (data.platform) {
    result.os =
      data.platform === 'macOS'
        ? 'macOS'
        : data.platform === 'Chrome OS'
          ? 'ChromeOS'
          : data.platform
  }
  return result
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function canvasHash(doc: Document): string | undefined {
  try {
    const canvas = doc.createElement('canvas')
    canvas.width = 220
    canvas.height = 30
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'
    ctx.fillRect(100, 1, 62, 20)
    ctx.fillStyle = '#069'
    ctx.fillText('auth-client fp ✓ 2FA', 2, 15)
    const data = canvas.toDataURL()
    return data && data !== 'data:,' ? fnv1a(data) : undefined
  } catch {
    return undefined
  }
}

function webgl(doc: Document): { vendor?: string; renderer?: string } {
  try {
    const canvas = doc.createElement('canvas')
    const gl = (canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return {}
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const vendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) as unknown
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as unknown
    return {
      vendor: typeof vendor === 'string' ? vendor : undefined,
      renderer: typeof renderer === 'string' ? renderer : undefined,
    }
  } catch {
    return {}
  }
}

// Collects raw components. Returns null outside the browser (SSR).
export function collectDeviceComponents(): DeviceComponents | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null
  const nav = navigator as NavigatorWithUAData
  const ua = { ...parseUserAgent(nav.userAgent ?? ''), ...fromUserAgentData(nav) }
  const gl = typeof document !== 'undefined' ? webgl(document) : {}

  let timezone: string | undefined
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timezone = undefined
  }

  const scr = typeof screen !== 'undefined' ? screen : undefined

  return {
    browserFamily: ua.browserFamily,
    browserMajor: ua.browserMajor,
    os: ua.os,
    platform: nav.platform || undefined,
    hardwareConcurrency: nav.hardwareConcurrency || undefined,
    deviceMemory: nav.deviceMemory,
    webglVendor: gl.vendor,
    webglRenderer: gl.renderer,
    timezone,
    languages: nav.languages
      ? Array.from(nav.languages)
      : nav.language
        ? [nav.language]
        : undefined,
    screen: scr ? `${scr.width}x${scr.height}` : undefined,
    colorDepth: scr?.colorDepth,
    canvasHash: typeof document !== 'undefined' ? canvasHash(document) : undefined,
    touchPoints: nav.maxTouchPoints,
  }
}

export type DeviceFingerprintProvider = {
  // Cached for the lifetime of the page. null = SSR / no WebCrypto / disabled.
  get(): Promise<DeviceFingerprint | null>
  // Sync access to the already computed fingerprint (null until first get()).
  peek(): DeviceFingerprint | null
}

export function createDeviceFingerprintProvider(
  collect: () => DeviceComponents | null = collectDeviceComponents,
): DeviceFingerprintProvider {
  let cached: DeviceFingerprint | null = null
  let pending: Promise<DeviceFingerprint | null> | null = null

  return {
    get() {
      if (cached) return Promise.resolve(cached)
      if (pending) return pending
      pending = (async () => {
        try {
          const raw = collect()
          if (!raw) return null
          const components = normalizeComponents(raw) as DeviceComponents
          const hash = await hashComponents(components)
          if (!hash) return null
          cached = { components, hash }
          return cached
        } catch {
          return null
        } finally {
          pending = null
        }
      })()
      return pending
    },
    peek() {
      return cached
    },
  }
}
