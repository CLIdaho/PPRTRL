import Dexie, { type Table } from 'dexie'
import type { Attachment, BlobRecord, Case, Entry, LedgerEntry } from './types'

class PapertrailDB extends Dexie {
  cases!: Table<Case, string>
  entries!: Table<Entry, string>
  attachments!: Table<Attachment, string>
  blobs!: Table<BlobRecord, string>
  ledger!: Table<LedgerEntry, number>

  constructor() {
    super('papertrail')
    this.version(1).stores({
      cases: 'id, status, updatedAt, createdAt',
      // `deletedAt` is indexed so the timeline can exclude removed entries cheaply.
      entries: 'id, caseId, occurredAt, recordedAt, updatedAt, deletedAt, *tags',
      attachments: 'id, entryId, kind, sha256, addedAt',
      blobs: 'id',
      ledger: '++seq, at, action, subject',
    })
  }
}

export const db = new PapertrailDB()
