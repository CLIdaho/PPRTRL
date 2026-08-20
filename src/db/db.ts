import Dexie, { type Table } from 'dexie'
import type {
  Anchor, Attachment, BlobRecord, Case, Entry, LedgerEntry, Prompt, SettingRecord,
} from './types'
import { normalizeTimestamps, type StoredEntryRow } from './migrate'

/**
 * Counts what the version 2 upgrade had to repair, so the app can write one
 * honest ledger line about it rather than silently rewriting stored evidence.
 */
export interface MigrationReport {
  ran: boolean
  entriesSeen: number
  timestampsReconstructed: number
  at: number
}

const MIGRATION_KEY = 'papertrail:migration-v2'

/** Handed to the app after `db.open()` so it can record what the upgrade did. */
export let pendingMigration: MigrationReport | null = null

export function clearPendingMigration(): void {
  pendingMigration = null
}

class PapertrailDB extends Dexie {
  cases!: Table<Case, string>
  entries!: Table<Entry, string>
  attachments!: Table<Attachment, string>
  blobs!: Table<BlobRecord, string>
  ledger!: Table<LedgerEntry, number>
  anchors!: Table<Anchor, string>
  prompts!: Table<Prompt, string>
  settings!: Table<SettingRecord, string>

  constructor() {
    super('papertrail')

    this.version(1).stores({
      cases: 'id, status, updatedAt, createdAt',
      entries: 'id, caseId, occurredAt, recordedAt, updatedAt, deletedAt, *tags',
      attachments: 'id, entryId, kind, sha256, addedAt',
      blobs: 'id',
      ledger: '++seq, at, action, subject',
    })

    this.version(2)
      .stores({
        cases: 'id, status, updatedAt, createdAt',
        // `kind` and `status` are indexed so the coverage view can pull
        // nothing-to-report days, and the timeline its drafts, without a scan.
        entries: 'id, caseId, occurredAt, recordedAt, updatedAt, deletedAt, kind, status, promptId, *tags',
        attachments: 'id, entryId, kind, sha256, addedAt',
        blobs: 'id',
        ledger: '++seq, at, action, subject',
        anchors: 'id, enabled, updatedAt',
        prompts: 'id, anchorId, dueAt, state, forDate',
        settings: 'key',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        let seen = 0
        let reconstructed = 0

        await tx.table('entries').toCollection().modify((row: StoredEntryRow) => {
          seen++
          const { row: fixed, migrated } = normalizeTimestamps(row, now)
          if (migrated) reconstructed++
          // Assign in place: Dexie's `modify` writes back the mutated object.
          Object.assign(row, fixed)
        })

        pendingMigration = { ran: true, entriesSeen: seen, timestampsReconstructed: reconstructed, at: now }
        await tx.table('settings').put({ key: MIGRATION_KEY, value: pendingMigration })
      })
  }
}

export const db = new PapertrailDB()

/** Reads a settings row, falling back when it has never been written. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key)
  return row === undefined ? fallback : (row.value as T)
}

export async function putSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value })
}
