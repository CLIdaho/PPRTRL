/**
 * A minimal ZIP writer (store method, no compression).
 *
 * Papertrail's exports are mostly already-compressed media, so deflate would buy
 * little and cost a dependency. Writing the container by hand keeps the app free
 * of any build-time library for its most important output.
 */

let CRC_TABLE: Int32Array | null = null

function crc32(bytes: Uint8Array, seed = 0): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let c = seed ^ -1
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** DOS date/time, which is what the ZIP header format still wants. */
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipFile {
  path: string
  data: Blob | string
  modified?: Date
}

interface CentralRecord {
  nameBytes: Uint8Array
  crc: number
  size: number
  offset: number
  time: number
  date: number
}

const encoder = new TextEncoder()

function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

export async function createZip(files: ZipFile[]): Promise<Blob> {
  const parts: (ArrayBuffer | ArrayBufferView | string)[] = []
  const central: CentralRecord[] = []
  let offset = 0

  for (const file of files) {
    const bytes = new Uint8Array(
      typeof file.data === 'string'
        ? encoder.encode(file.data).buffer
        : await file.data.arrayBuffer(),
    )
    const nameBytes = encoder.encode(file.path)
    const crc = crc32(bytes)
    const { time, date } = dosTime(file.modified ?? new Date())

    const header = new ArrayBuffer(30)
    const view = new DataView(header)
    u32(view, 0, 0x04034b50)
    view.setUint16(4, 20, true) // version needed
    view.setUint16(6, 0x0800, true) // UTF-8 filenames
    view.setUint16(8, 0, true) // method: store
    view.setUint16(10, time, true)
    view.setUint16(12, date, true)
    u32(view, 14, crc)
    u32(view, 18, bytes.length) // compressed size
    u32(view, 22, bytes.length) // uncompressed size
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, 0, true) // extra field length

    parts.push(header, nameBytes, bytes)
    central.push({ nameBytes, crc, size: bytes.length, offset, time, date })
    offset += 30 + nameBytes.length + bytes.length
  }

  const centralStart = offset
  for (const rec of central) {
    const header = new ArrayBuffer(46)
    const view = new DataView(header)
    u32(view, 0, 0x02014b50)
    view.setUint16(4, 20, true) // version made by
    view.setUint16(6, 20, true) // version needed
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, rec.time, true)
    view.setUint16(14, rec.date, true)
    u32(view, 16, rec.crc)
    u32(view, 20, rec.size)
    u32(view, 24, rec.size)
    view.setUint16(28, rec.nameBytes.length, true)
    view.setUint16(30, 0, true) // extra
    view.setUint16(32, 0, true) // comment
    view.setUint16(34, 0, true) // disk number
    view.setUint16(36, 0, true) // internal attrs
    u32(view, 38, 0) // external attrs
    u32(view, 42, rec.offset)
    parts.push(header, rec.nameBytes)
    offset += 46 + rec.nameBytes.length
  }

  const end = new ArrayBuffer(22)
  const endView = new DataView(end)
  u32(endView, 0, 0x06054b50)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, central.length, true)
  endView.setUint16(10, central.length, true)
  u32(endView, 12, offset - centralStart)
  u32(endView, 16, centralStart)
  endView.setUint16(20, 0, true)
  parts.push(end)

  return new Blob(parts as BlobPart[], { type: 'application/zip' })
}

/** Hands the finished archive to the browser as a download. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // Revoke late: Safari needs the URL to still resolve when the click is handled.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
