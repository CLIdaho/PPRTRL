import type { Entry } from './types'

/**
 * The row shape as it may exist on disk, from any version of the app that ever
 * wrote to this database — or from a backup file produced by one. Every field is
 * optional because the whole point of this module is to cope with rows that are
 * missing the ones we now depend on.
 */
export type StoredEntryRow = Partial<Entry> | Record<string, unknown>

export interface NormalizeResult {
  row: Entry
  /** True only when a field was actually absent and had to be filled in. */
  migrated: boolean
  /** Which fields were repaired, for the ledger line and the export. */
  repaired: string[]
}

const isTimestamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Brings one stored entry up to the current schema without ever inventing a
 * timestamp it cannot justify.
 *
 * The rules, in order of preference:
 *   - `recordedAt` missing  -> fall back to `occurredAt`, then `updatedAt`.
 *   - `occurredAt` missing  -> fall back to `recordedAt`, then `updatedAt`.
 *   - both missing          -> `fallbackNow`, the only case where we guess.
 *
 * A row that already carries both is returned untouched with `migrated: false`,
 * so the migration flag means "this timestamp was reconstructed, treat it with
 * suspicion" rather than "this row was seen by version 2", which would be true
 * of every row and therefore worth nothing.
 *
 * Kept pure and free of Dexie so it can be tested directly, and so the same
 * function can clean rows arriving from a backup import.
 */
export function normalizeTimestamps(input: StoredEntryRow, fallbackNow: number): NormalizeResult {
  const row0 = input as Partial<Entry> & Record<string, unknown>
  const repaired: string[] = []

  const storedOccurred = isTimestamp(row0.occurredAt) ? row0.occurredAt : null
  const storedRecorded = isTimestamp(row0.recordedAt) ? row0.recordedAt : null
  const storedUpdated = isTimestamp(row0.updatedAt) ? row0.updatedAt : null

  let occurredAt = storedOccurred
  let recordedAt = storedRecorded

  if (recordedAt === null) {
    recordedAt = storedOccurred ?? storedUpdated ?? fallbackNow
    repaired.push('recordedAt')
  }
  if (occurredAt === null) {
    occurredAt = storedRecorded ?? storedUpdated ?? fallbackNow
    repaired.push('occurredAt')
  }

  // An entry cannot have been written down before the app existed to write it,
  // but it absolutely can have been written down long after the event. Only the
  // impossible direction is corrected.
  const updatedAt = storedUpdated ?? recordedAt

  const kind: Entry['kind'] =
    row0.kind === 'nothing-to-report' ? 'nothing-to-report' : 'entry'
  if (row0.kind === undefined) repaired.push('kind')

  const status: Entry['status'] = row0.status === 'draft' ? 'draft' : 'complete'
  if (row0.status === undefined) repaired.push('status')

  // Provenance is only inferred when absent. An entry written up more than a day
  // after the event it describes is not contemporaneous, and saying so is the
  // whole point of keeping two timestamps.
  let provenance: Entry['provenance']
  if (
    row0.provenance === 'backfilled' ||
    row0.provenance === 'catch-up' ||
    row0.provenance === 'contemporaneous'
  ) {
    provenance = row0.provenance
  } else {
    provenance = recordedAt - occurredAt > DAY ? 'backfilled' : 'contemporaneous'
    repaired.push('provenance')
  }

  const row: Entry = {
    id: asString(row0.id),
    caseId: typeof row0.caseId === 'string' ? row0.caseId : null,
    title: asString(row0.title) || 'Untitled entry',
    notes: asString(row0.notes),
    occurredAt,
    recordedAt,
    updatedAt,
    tags: asStringArray(row0.tags),
    people: asStringArray(row0.people),
    location: asString(row0.location),
    source: asString(row0.source),
    kind,
    status,
    provenance,
    promptId: typeof row0.promptId === 'string' ? row0.promptId : null,
    deletedAt: isTimestamp(row0.deletedAt) ? row0.deletedAt : null,
  }

  // Only a reconstructed *timestamp* earns the flag. Defaulting `kind` on an
  // entry written before that field existed is bookkeeping, not a repair to the
  // record, and flagging it would drown the cases that matter.
  const timestampRepaired = repaired.includes('occurredAt') || repaired.includes('recordedAt')
  if (timestampRepaired) row.timestampsMigrated = true

  return { row, migrated: timestampRepaired, repaired }
}

export const DAY = 86_400_000

/** How long after the event it describes an entry was written down. */
export function recordingLag(entry: Pick<Entry, 'occurredAt' | 'recordedAt'>): number {
  return entry.recordedAt - entry.occurredAt
}

/**
 * Whether an entry can honestly be described as written at the time. One hour is
 * generous enough to cover writing something up over a lunch break, and tight
 * enough that "I wrote this the next morning" does not pass.
 */
export function isContemporaneous(entry: Pick<Entry, 'occurredAt' | 'recordedAt'>): boolean {
  return Math.abs(recordingLag(entry)) <= 3_600_000
}
