import { db } from './db'
import { record } from './ledger'
import type { Attachment, Case, Entry, EntryKind, EntryProvenance, EntryStatus } from './types'
import { newId } from '../lib/id'
import { kindOf, safeFileName } from '../lib/files'
import { sha256Blob } from '../lib/hash'
import { isContemporaneous } from './migrate'

/**
 * Every mutation in here writes a ledger entry. That pairing is the product:
 * there is no code path that changes evidence without leaving a trace.
 */

export async function createCase(input: { title: string; summary: string }): Promise<Case> {
  const now = Date.now()
  const item: Case = {
    id: newId('case'),
    title: input.title.trim() || 'Untitled case',
    summary: input.summary.trim(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  }
  await db.cases.put(item)
  await record('case.create', item.id, `Case opened: ${item.title}`)
  return item
}

export async function updateCase(
  id: string,
  patch: Partial<Pick<Case, 'title' | 'summary' | 'status'>>,
): Promise<void> {
  const before = await db.cases.get(id)
  if (!before) return
  const after: Case = { ...before, ...patch, updatedAt: Date.now() }
  await db.cases.put(after)

  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => before[k] !== after[k])
  if (changed.length === 0) return
  const statusMoved = changed.includes('status')
  await record(
    'case.update',
    id,
    statusMoved ? `Case marked ${after.status}: ${after.title}` : `Case edited: ${after.title}`,
    { fields: changed, ...(statusMoved ? { from: before.status, to: after.status } : {}) },
  )
}

export interface EntryDraft {
  caseId: string | null
  title: string
  notes: string
  occurredAt: number
  tags: string[]
  people: string[]
  location: string
  source: string
  kind?: EntryKind
  status?: EntryStatus
  provenance?: EntryProvenance
  promptId?: string | null
}

export async function createEntry(draft: EntryDraft, files: File[] = []): Promise<Entry> {
  const now = Date.now()
  const provenance =
    draft.provenance ?? (isContemporaneous({ occurredAt: draft.occurredAt, recordedAt: now })
      ? 'contemporaneous'
      : 'backfilled')

  const entry: Entry = {
    id: newId('entry'),
    caseId: draft.caseId,
    title: draft.title.trim() || 'Untitled entry',
    notes: draft.notes,
    occurredAt: draft.occurredAt,
    // Set here, once, from the clock — never from the caller. This is the only
    // place in the app that assigns it.
    recordedAt: now,
    updatedAt: now,
    tags: draft.tags,
    people: draft.people,
    location: draft.location.trim(),
    source: draft.source.trim(),
    kind: draft.kind ?? 'entry',
    status: draft.status ?? 'complete',
    provenance,
    promptId: draft.promptId ?? null,
    deletedAt: null,
  }
  await db.entries.put(entry)
  await record('entry.create', entry.id, `Entry recorded: ${entry.title}`, {
    caseId: entry.caseId,
    occurredAt: entry.occurredAt,
    recordedAt: entry.recordedAt,
    kind: entry.kind,
    status: entry.status,
    provenance: entry.provenance,
    lagMs: entry.recordedAt - entry.occurredAt,
  })
  for (const file of files) await addAttachment(entry.id, file)
  return entry
}

/**
 * Records that a given day passed with nothing worth reporting.
 *
 * This is a real entry, not a marker: it gets a `recordedAt`, a ledger line, a
 * place in the timeline and a row in the export. A quiet day someone confirmed
 * was quiet is very different from a day nobody checked, and only an actual
 * record can carry that difference.
 */
export async function recordNothingToReport(input: {
  /** Local date the report covers, `YYYY-MM-DD`. */
  forDate: string
  /** Noon local on that date — a stable point that no time zone pushes off-day. */
  occurredAt: number
  promptId?: string | null
  caseId?: string | null
  note?: string
}): Promise<Entry> {
  return createEntry({
    caseId: input.caseId ?? null,
    title: `Nothing to report — ${input.forDate}`,
    notes: input.note?.trim() ?? '',
    occurredAt: input.occurredAt,
    tags: [],
    people: [],
    location: '',
    source: '',
    kind: 'nothing-to-report',
    status: 'complete',
    promptId: input.promptId ?? null,
  })
}

export async function updateEntry(
  id: string,
  patch: Partial<Omit<Entry, 'id' | 'recordedAt' | 'deletedAt'>>,
): Promise<void> {
  const before = await db.entries.get(id)
  if (!before) return

  // The type already forbids these, but a type is a compile-time promise and
  // this is the one field the app's central claim rests on. Strip them at
  // runtime too, so a patch arriving from an import or a future caller cannot
  // rewrite when something was written down.
  const safe = { ...patch } as Record<string, unknown>
  delete safe.id
  delete safe.recordedAt
  delete safe.deletedAt
  delete safe.timestampsMigrated

  const after: Entry = { ...before, ...(safe as Partial<Entry>), updatedAt: Date.now() }

  // Correcting when something happened can move an entry across the line from
  // "written at the time" to "written up later". The export has to say which,
  // so the label is recomputed rather than left at whatever it was.
  if (safe.occurredAt !== undefined && before.provenance !== 'catch-up') {
    after.provenance = isContemporaneous(after) ? 'contemporaneous' : 'backfilled'
  }

  await db.entries.put(after)

  // Record what changed, and the previous value, so an edit never silently
  // overwrites the original account of events.
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(patch) as (keyof Entry)[]) {
    const a = JSON.stringify(before[key])
    const b = JSON.stringify(after[key])
    if (a !== b) fields[key] = { from: before[key], to: after[key] }
  }
  if (Object.keys(fields).length === 0) return
  await record('entry.update', id, `Entry edited: ${after.title}`, { changes: fields })
}

/**
 * Removes the file bytes and hides the entry, but keeps the record and every
 * hash. A deleted entry still shows in the ledger — that is the point.
 */
export async function deleteEntry(id: string, reason: string): Promise<void> {
  const entry = await db.entries.get(id)
  if (!entry) return
  const attachments = await db.attachments.where('entryId').equals(id).toArray()
  await db.transaction('rw', db.entries, db.attachments, db.blobs, async () => {
    await db.blobs.bulkDelete(attachments.map((a) => a.id))
    await db.attachments.bulkDelete(attachments.map((a) => a.id))
    await db.entries.put({ ...entry, deletedAt: Date.now(), updatedAt: Date.now() })
  })
  await record('entry.delete', id, `Entry deleted: ${entry.title}`, {
    reason: reason.trim() || '(none given)',
    attachmentsRemoved: attachments.map((a) => ({ name: a.name, sha256: a.sha256 })),
  })
}

export async function addAttachment(entryId: string, file: File): Promise<Attachment> {
  const blob = file.slice(0, file.size, file.type)
  const sha256 = await sha256Blob(blob)
  const name = safeFileName(file.name)
  const att: Attachment = {
    id: newId('att'),
    entryId,
    name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    kind: kindOf(file.type, name),
    sha256,
    fileModifiedAt: file.lastModified || null,
    addedAt: Date.now(),
  }
  await db.transaction('rw', db.attachments, db.blobs, db.entries, async () => {
    await db.attachments.put(att)
    await db.blobs.put({ id: att.id, data: blob })
    const entry = await db.entries.get(entryId)
    if (entry) await db.entries.put({ ...entry, updatedAt: Date.now() })
  })
  await record('attachment.add', att.id, `File attached: ${att.name}`, {
    entryId,
    sha256,
    size: att.size,
    mime: att.mime,
  })
  return att
}

export async function removeAttachment(id: string): Promise<void> {
  const att = await db.attachments.get(id)
  if (!att) return
  await db.transaction('rw', db.attachments, db.blobs, async () => {
    await db.blobs.delete(id)
    await db.attachments.delete(id)
  })
  await record('attachment.remove', id, `File removed: ${att.name}`, {
    entryId: att.entryId,
    sha256: att.sha256,
  })
}

export async function getBlob(attachmentId: string): Promise<Blob | null> {
  return (await db.blobs.get(attachmentId))?.data ?? null
}

export interface IntegrityResult {
  attachmentId: string
  name: string
  entryId: string
  status: 'ok' | 'altered' | 'missing'
  expected: string
  actual: string | null
}

/** Re-hashes every stored file and compares against the hash taken at intake. */
export async function verifyFiles(
  onProgress?: (done: number, total: number) => void,
): Promise<IntegrityResult[]> {
  const attachments = await db.attachments.toArray()
  const results: IntegrityResult[] = []
  let done = 0
  for (const att of attachments) {
    const blob = await getBlob(att.id)
    if (!blob) {
      results.push({
        attachmentId: att.id, name: att.name, entryId: att.entryId,
        status: 'missing', expected: att.sha256, actual: null,
      })
    } else {
      const actual = await sha256Blob(blob)
      results.push({
        attachmentId: att.id, name: att.name, entryId: att.entryId,
        status: actual === att.sha256 ? 'ok' : 'altered', expected: att.sha256, actual,
      })
    }
    onProgress?.(++done, attachments.length)
  }
  return results
}
