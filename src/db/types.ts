/** Everything Papertrail stores lives in these five tables. Nothing leaves the device. */

export type CaseStatus = 'open' | 'resolved' | 'archived'

/** A container for related evidence — one dispute, one incident, one landlord. */
export interface Case {
  id: string
  title: string
  /** What this case is about, for the reader who opens the export in a year. */
  summary: string
  status: CaseStatus
  createdAt: number
  updatedAt: number
}

/**
 * One recorded thing that happened. An entry may be a plain note, or may carry
 * any number of attached files (photo, video, audio, PDF, document, anything).
 */
export interface Entry {
  id: string
  caseId: string | null
  title: string
  /** Free-text account: what happened, in the recorder's own words. */
  notes: string
  /** When the event happened — distinct from when it was recorded. */
  occurredAt: number
  /** When it was written down. Set once, never edited. */
  recordedAt: number
  updatedAt: number
  tags: string[]
  /** Who was involved or present. */
  people: string[]
  /** Free-text place: an address, a room, a URL, a phone number. */
  location: string
  /** Where the material came from: "screenshot of text thread", "emailed to me by X". */
  source: string
  /**
   * Entries are never hard-deleted from the ledger's point of view — that is the
   * whole point of a paper trail. Deleting sets this and drops the file bytes.
   */
  deletedAt: number | null
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'document' | 'other'

/** File metadata. The bytes live in the separate `blobs` table. */
export interface Attachment {
  id: string
  entryId: string
  name: string
  mime: string
  size: number
  kind: FileKind
  /** SHA-256 of the bytes, computed once at intake and never recomputed on write. */
  sha256: string
  /** Last-modified timestamp reported by the source file, when the OS gave us one. */
  fileModifiedAt: number | null
  addedAt: number
}

export interface BlobRecord {
  id: string
  data: Blob
}

export type LedgerAction =
  | 'trail.start'
  | 'case.create'
  | 'case.update'
  | 'entry.create'
  | 'entry.update'
  | 'entry.delete'
  | 'attachment.add'
  | 'attachment.remove'
  | 'export.case'
  | 'export.backup'
  | 'import.backup'
  | 'verify.run'

/**
 * The paper trail itself: an append-only, hash-chained log of every action taken
 * in the app. Each entry commits to the one before it, so a record cannot be
 * altered or removed after the fact without breaking every link that follows.
 */
export interface LedgerEntry {
  seq: number
  at: number
  action: LedgerAction
  /** id of the case / entry / attachment this concerns, or '-' for app-level events. */
  subject: string
  summary: string
  details: Record<string, unknown>
  prevHash: string
  hash: string
}
