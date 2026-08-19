/** SHA-256 helpers built on WebCrypto — no dependency, works offline. */

const enc = new TextEncoder()

export function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

export async function sha256Text(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)))
}

export async function sha256Blob(blob: Blob): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
}

/** Short, readable form for display: `a1b2c3d4…9f8e7d6c`. */
export function shortHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`
}

/**
 * JSON with keys sorted at every level, so the same logical value always hashes
 * to the same digest regardless of how the object was built.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}
