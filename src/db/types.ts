/** Everything Papertrail stores lives in these tables. Nothing leaves the device. */

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
/**
 * What sort of record an entry is.
 *
 * `nothing-to-report` is a real, first-class record — not the absence of one. A
 * day the user actively confirmed was quiet is evidence; a day nobody looked at
 * is a gap. Collapsing the two would destroy the only thing that makes a
 * coverage claim worth anything.
 */
export type EntryKind = 'entry' | 'nothing-to-report'

/** A quick-captured entry starts as a draft and is enriched later. */
export type EntryStatus = 'draft' | 'complete'

/**
 * How the entry came to be written, which governs how the export is allowed to
 * describe it.
 *
 * `contemporaneous` — written at the time.
 * `backfilled`      — written up later, from an unaccounted-for day.
 * `catch-up`        — written in response to a prompt that fired while the app
 *                     was closed, so it is dated to the prompt, not to now.
 */
export type EntryProvenance = 'contemporaneous' | 'backfilled' | 'catch-up'

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
  /** Plain note, or an explicit "nothing happened on this date" record. */
  kind: EntryKind
  /** Quick capture writes a draft; enriching it later makes it complete. */
  status: EntryStatus
  /** Whether this was written at the time, backfilled, or answered late. */
  provenance: EntryProvenance
  /** The scheduled prompt this answers, when it answers one. */
  promptId: string | null
  /**
   * Set by a schema migration that had to reconstruct a missing timestamp. Its
   * presence means the timestamps on this row are inferred rather than observed,
   * and the export says so rather than passing them off as recorded fact.
   */
  timestampsMigrated?: true
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

/**
 * A recurrence rule, stored as data rather than expressed in code.
 *
 * Deliberately a small subset of RFC 5545: enough for "every Tuesday at 5pm" or
 * "the 1st and 15th", and no more. `time` and the date bounds are local wall
 * clock on purpose — a 9pm reminder should stay at 9pm across a daylight-saving
 * change, which an absolute-millisecond schedule would not do.
 */
export type ScheduleRule =
  | {
      freq: 'once'
      /** Local wall clock, `YYYY-MM-DDTHH:MM`. */
      at: string
    }
  | {
      freq: 'daily' | 'weekly' | 'monthly'
      /** Every N days/weeks/months. 1 means every one. */
      interval: number
      /** For `weekly`: which days, 0 = Sunday. Empty means the start date's day. */
      byWeekday?: number[]
      /** For `monthly`: which dates, 1-31. A 31 is skipped in shorter months. */
      byMonthDay?: number[]
      /** Local wall clock, `HH:MM`. */
      time: string
      /** Local date, `YYYY-MM-DD`. No occurrence falls before this. */
      startDate: string
      /** Local date, `YYYY-MM-DD`, inclusive. null means it runs forever. */
      endDate: string | null
    }

/**
 * A recurring or one-off event the user wants to be reminded about — a weekly
 * handoff, a court date, a monthly rent payment.
 */
export interface Anchor {
  id: string
  label: string
  /** What to write about when it fires, shown in the prompt. */
  note: string
  rule: ScheduleRule
  /**
   * Minutes after the event to ask "how did that go?". 0 prompts at the event
   * itself; 120 prompts two hours later, once there is something to say.
   */
  promptAfterMinutes: number
  enabled: boolean
  /** Entries created from this anchor's prompts are filed here. */
  caseId: string | null
  createdAt: number
  updatedAt: number
}

/**
 * One prompt that was due at a particular moment. Rows are materialised from the
 * rules as their time passes, so a prompt the user never saw is still a fact on
 * the record rather than something inferred at read time.
 */
export interface Prompt {
  id: string
  /** The anchor it came from, or null for the daily sweep. */
  anchorId: string | null
  kind: 'anchor' | 'sweep'
  label: string
  /** When this prompt was due, as a timestamp. */
  dueAt: number
  /** Local date the prompt concerns, `YYYY-MM-DD`. */
  forDate: string
  /** When the app first noticed it was due — often well after `dueAt`. */
  noticedAt: number
  state: 'pending' | 'answered' | 'dismissed'
  /** The entry written in response, once there is one. */
  entryId: string | null
  resolvedAt: number | null
}

/** Everything the reminder system needs to know, in one row. */
export interface SweepSettings {
  enabled: boolean
  /** Local wall clock, `HH:MM`. */
  time: string
  /** Days of week the sweep runs, 0 = Sunday. */
  weekdays: number[]
  /** How many days back the coverage view shows. */
  lookbackDays: number
  /** The user has been shown the battery-optimisation instructions. */
  batterySetupSeen: boolean
  /** Last time the app was open, used to work out what was missed. */
  lastSeenAt: number
  /** When prompt materialisation last ran, so it never re-walks all of history. */
  lastSweptAt: number
}

/** A single-row settings store, so config lands in backups rather than localStorage. */
export interface SettingRecord {
  key: string
  value: unknown
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
  | 'schema.migrate'
  | 'anchor.create'
  | 'anchor.update'
  | 'anchor.delete'
  | 'sweep.configure'
  | 'prompt.missed'
  | 'prompt.dismiss'
  | 'export.calendar'

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
