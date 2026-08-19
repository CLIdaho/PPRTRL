// Generates the PWA icons from code so the repo carries no opaque binary blobs
// that nobody can regenerate. Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const BG = [14, 17, 22]
const PAPER = [233, 236, 241]
const PAPER_DIM = [150, 160, 175]
const INK = [14, 17, 22]
const ACCENT = [232, 168, 74]

function canvas(size) {
  const px = new Uint8Array(size * size * 4)
  return {
    size,
    px,
    set(x, y, [r, g, b], a = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) return
      const i = (y * size + x) * 4
      const sa = a
      const da = px[i + 3] / 255
      const out = sa + da * (1 - sa)
      if (out <= 0) return
      px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / out)
      px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / out)
      px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / out)
      px[i + 3] = Math.round(out * 255)
    },
  }
}

// Anti-aliased rounded rectangle via signed distance.
function roundRect(c, x, y, w, h, r, color) {
  const cx = x + w / 2
  const cy = y + h / 2
  const hw = w / 2
  const hh = h / 2
  for (let py = Math.floor(y - 2); py <= Math.ceil(y + h + 2); py++) {
    for (let px = Math.floor(x - 2); px <= Math.ceil(x + w + 2); px++) {
      const dx = Math.abs(px + 0.5 - cx) - (hw - r)
      const dy = Math.abs(py + 0.5 - cy) - (hh - r)
      const d = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r
      const a = Math.min(1, Math.max(0, 0.5 - d))
      if (a > 0) c.set(px, py, color, a)
    }
  }
}

function png(c) {
  const { size, px } = c
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < size * 4; x++) raw[o++] = px[y * size * 4 + x]
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let TABLE = null
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      TABLE[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

function draw(size) {
  const c = canvas(size)
  const u = size / 512
  roundRect(c, 0, 0, size, size, 112 * u, BG)
  // A stack of sheets, back to front.
  roundRect(c, 168 * u, 96 * u, 208 * u, 268 * u, 20 * u, PAPER_DIM)
  roundRect(c, 148 * u, 122 * u, 216 * u, 278 * u, 20 * u, PAPER_DIM)
  roundRect(c, 126 * u, 148 * u, 226 * u, 290 * u, 22 * u, PAPER)
  // Ruled lines on the front sheet.
  for (let i = 0; i < 4; i++) {
    roundRect(c, 158 * u, (192 + i * 46) * u, (i === 3 ? 100 : 162) * u, 16 * u, 8 * u, INK)
  }
  // Accent seal: the chain link that makes the trail tamper-evident.
  roundRect(c, 300 * u, 300 * u, 104 * u, 104 * u, 52 * u, ACCENT)
  roundRect(c, 326 * u, 326 * u, 52 * u, 52 * u, 26 * u, BG)
  return c
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(draw(size)))
}
console.log('wrote public/icon-192.png public/icon-512.png')
