import { describe, it, expect } from 'vitest'
import {
  canonicalJson,
  createDeviceFingerprintProvider,
  hashComponents,
  normalizeComponents,
  parseUserAgent,
  type DeviceComponents,
} from './device.js'

// Wspólny wektor z auth serverem (jego test DeviceFingerprint po stronie PHP).
// Zmiana hasha = zepsute porównanie X-Device-Fp ↔ claim `fph` dla wszystkich klientów.
const VECTOR: DeviceComponents = {
  browserFamily: 'Chrome',
  browserMajor: 129,
  os: 'macOS',
  platform: 'MacIntel',
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webglVendor: 'Google Inc. (Apple)',
  webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
  timezone: 'Europe/Warsaw',
  languages: ['pl-PL', 'pl', 'en-US'],
  screen: '1728x1117',
  colorDepth: 30,
  canvasHash: 'a1b2c3d4',
  touchPoints: 0,
}
const VECTOR_CANONICAL =
  '{"browserFamily":"Chrome","browserMajor":129,"canvasHash":"a1b2c3d4","colorDepth":30,"deviceMemory":8,"hardwareConcurrency":8,"languages":["pl-PL","pl","en-US"],"os":"macOS","platform":"MacIntel","screen":"1728x1117","timezone":"Europe/Warsaw","touchPoints":0,"webglRenderer":"ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)","webglVendor":"Google Inc. (Apple)"}'
const VECTOR_HASH = '8f2969c8eb86dfe2a5d8c73a1c1d03fe18edb87496738959a710b41366cc3528'

describe('device fingerprint — kontrakt z auth serverem', () => {
  it('kanoniczny JSON i hash zgodne z wektorem PHP', async () => {
    expect(canonicalJson(normalizeComponents(VECTOR))).toBe(VECTOR_CANONICAL)
    expect(await hashComponents(VECTOR)).toBe(VECTOR_HASH)
  })

  it('normalizacja jak na serwerze: trim, puste out, nieznane klucze out, języki ≤ 10', () => {
    const raw = {
      os: '  Linux ',
      screen: '',
      platform: undefined,
      evil: 'x',
      deviceMemory: Number.NaN,
      languages: ['a', '', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    } as unknown as DeviceComponents
    const n = normalizeComponents(raw)
    expect(n).toEqual({ os: 'Linux', languages: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] })
  })

  it('kolejność kluczy nie wpływa na hash', async () => {
    const reversed = Object.fromEntries(Object.entries(VECTOR).reverse()) as DeviceComponents
    expect(await hashComponents(reversed)).toBe(VECTOR_HASH)
  })
})

describe('parseUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      'Chrome',
      129,
      'macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
      'Edge',
      128,
      'Windows',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Firefox',
      131,
      'Linux',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
      'Safari',
      17,
      'iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
      'Chrome',
      129,
      'Android',
    ],
  ])('%s', (ua, family, major, os) => {
    expect(parseUserAgent(ua)).toEqual({ browserFamily: family, browserMajor: major, os })
  })
})

describe('createDeviceFingerprintProvider', () => {
  it('liczy raz i cache-uje na czas życia strony', async () => {
    let calls = 0
    const provider = createDeviceFingerprintProvider(() => {
      calls += 1
      return VECTOR
    })
    expect(provider.peek()).toBeNull()
    const [a, b] = await Promise.all([provider.get(), provider.get()])
    const c = await provider.get()
    expect(a?.hash).toBe(VECTOR_HASH)
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(provider.peek()).toBe(a)
    expect(calls).toBe(1)
  })

  it('brak komponentów (SSR) → null', async () => {
    const provider = createDeviceFingerprintProvider(() => null)
    expect(await provider.get()).toBeNull()
  })

  it('wyjątek kolektora nie psuje requestów → null', async () => {
    const provider = createDeviceFingerprintProvider(() => {
      throw new Error('canvas blocked')
    })
    expect(await provider.get()).toBeNull()
  })
})
