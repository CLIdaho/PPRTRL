import type { FileKind } from '../db/types'

const DOC_EXT = new Set([
  'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'csv', 'tsv', 'xls', 'xlsx', 'ods',
  'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key', 'eml', 'msg', 'json', 'xml', 'html',
])

export function kindOf(mime: string, name: string): FileKind {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('text/')) return 'document'

  // Phones and some desktops hand over an empty or generic MIME type, so fall
  // back to the extension rather than filing everything under "other".
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'pdf'
  if (DOC_EXT.has(ext)) return 'document'
  if (['heic', 'heif', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp'].includes(ext)) return 'video'
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'amr', 'flac'].includes(ext)) return 'audio'
  return 'other'
}

export const KIND_LABEL: Record<FileKind, string> = {
  image: 'Photo',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF',
  document: 'Document',
  other: 'File',
}

/**
 * Browsers can render these inline; everything else gets a download link.
 *
 * HTML is deliberately excluded. A blob: URL inherits the origin of the page
 * that created it, so an evidence file containing script would run with access
 * to this app's stored records. Evidence arrives from people you are in a
 * dispute with — it is never trusted content.
 */
export function isPreviewable(kind: FileKind, mime: string): boolean {
  const m = mime.toLowerCase()
  if (m === 'text/html' || m === 'application/xhtml+xml' || m === 'image/svg+xml') return false
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') return true
  return m.startsWith('text/') || m === 'application/json' || m === 'application/xml'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

/** Strips directory parts and characters that break archives or file systems. */
export function safeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file'
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file'
}
