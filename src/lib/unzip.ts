/**
 * A minimal ZIP reader, used to restore backups.
 *
 * Papertrail writes stored (uncompressed) entries, but a backup may have been
 * re-zipped by a file manager along the way, so deflated entries are handled too
 * via the platform's DecompressionStream.
 */

const decoder = new TextDecoder()

function findEndOfCentralDirectory(view: DataView): number {
  // The end record is at most 22 bytes plus a 64 KB comment.
  const start = Math.max(0, view.byteLength - 22 - 0xffff)
  for (let i = view.byteLength - 22; i >= start; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This backup is compressed and this browser cannot decompress it.')
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Returns every file in the archive, keyed by its path. */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const out = new Map<string, Blob>()

  const eocd = findEndOfCentralDirectory(view)
  if (eocd < 0) throw new Error('Not a valid ZIP archive.')
  const count = view.getUint16(eocd + 10, true)
  let pointer = view.getUint32(eocd + 16, true)

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) break
    const method = view.getUint16(pointer + 10, true)
    const compressedSize = view.getUint32(pointer + 20, true)
    const nameLength = view.getUint16(pointer + 28, true)
    const extraLength = view.getUint16(pointer + 30, true)
    const commentLength = view.getUint16(pointer + 32, true)
    const localOffset = view.getUint32(pointer + 42, true)
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength))
    pointer += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue

    // The local header repeats the name and extra fields, at its own lengths.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    if (method === 0) {
      out.set(name, new Blob([raw as BlobPart]))
    } else if (method === 8) {
      out.set(name, new Blob([(await inflateRaw(raw)) as BlobPart]))
    } else {
      throw new Error(`Unsupported compression in "${name}".`)
    }
  }
  return out
}
