import { db } from '../db/db'
import { record, verifyChain } from '../db/ledger'
import { getBlob } from '../db/repo'
import type { Anchor, Attachment, Case, Entry, Prompt, SettingRecord } from '../db/types'
import { normalizeTimestamps, type StoredEntryRow } from '../db/migrate'
import { createZip, download, type ZipFile } from './zip'
import { buildReport, describeLag, type ReportAttachment } from './report'
import { buildCoverage, describeCoverage } from './coverage'
import { isContemporaneous, recordingLag } from '../db/migrate'
import { getSweep } from '../db/reminders'
import { buildCalendar } from './ics'
import { isoLocal } from './format'
import { safeFileName } from './files'
import { sha256Text } from './hash'

const APP_VERSION = '0.2.0'

function stamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'papertrail'
}

/** Keeps archive paths unique when two files share a name. */
function uniquePath(taken: Set<string>, desired: string): string {
  if (!taken.has(desired)) {
    taken.add(desired)
    return desired
  }
  const dot = desired.lastIndexOf('.')
  const base = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  let n = 2
  let candidate = `${base}-${n}${ext}`
  while (taken.has(candidate)) candidate = `${base}-${++n}${ext}`
  taken.add(candidate)
  return candidate
}

export interface ExportOptions {
  /** null exports every entry across every case. */
  caseId: string | null
  includeFiles: boolean
}

export interface ExportResult {
  filename: string
  entries: number
  files: number
  size: number
}

/**
 * Builds a bundle a third party can actually read: a printable report, the
 * original files, a machine-readable manifest, and the hash chain that proves
 * nothing was quietly changed between recording and handing it over.
 */
export async function exportBundle(options: ExportOptions): Promise<ExportResult> {
  const now = Date.now()
  const theCase = options.caseId ? ((await db.cases.get(options.caseId)) ?? null) : null

  const all = options.caseId
    ? await db.entries.where('caseId').equals(options.caseId).toArray()
    : await db.entries.toArray()
  const entries = all
    .filter((e) => e.deletedAt === null)
    .sort((a, b) => a.occurredAt - b.occurredAt)

  const taken = new Set<string>()
  const byEntry = new Map<string, ReportAttachment[]>()
  const zipFiles: ZipFile[] = []
  let fileCount = 0

  for (const [index, entry] of entries.entries()) {
    const attachments = (await db.attachments.where('entryId').equals(entry.id).toArray())
      .sort((a, b) => a.addedAt - b.addedAt)
    const listed: ReportAttachment[] = []
    for (const att of attachments) {
      const exportPath = uniquePath(
        taken,
        `${String(index + 1).padStart(3, '0')}-${safeFileName(att.name)}`,
      )
      listed.push({ ...att, exportPath })
      if (options.includeFiles) {
        const blob = await getBlob(att.id)
        if (blob) {
          zipFiles.push({ path: `files/${exportPath}`, data: blob, modified: new Date(att.addedAt) })
          fileCount++
        }
      }
    }
    byEntry.set(entry.id, listed)
  }

  const ledger = await db.ledger.orderBy('seq').toArray()
  const chain = await verifyChain()

  // Coverage is computed over everything recorded, not just this case: a case
  // covering three days out of ninety is not thirty-three percent covered, and
  // scoping the window to the case would imply exactly that.
  const sweep = await getSweep()
  const allEntries = await db.entries.toArray()
  const coverage = buildCoverage(allEntries, sweep.lookbackDays, now)

  const manifest = {
    format: 'papertrail-export/2',
    app: { name: 'Papertrail', version: APP_VERSION },
    exportedAt: isoLocal(now),
    scope: theCase ? { kind: 'case', id: theCase.id, title: theCase.title } : { kind: 'all' },
    includesFiles: options.includeFiles,
    integrity: {
      chainIntact: chain.intact,
      chainLength: chain.length,
      headHash: chain.headHash,
      problems: chain.problems,
    },
    case: theCase,
    coverage: {
      summary: describeCoverage(coverage),
      windowDays: coverage.totalDays,
      firstDate: coverage.firstDate,
      lastDate: coverage.lastDate,
      daysWithEntries: coverage.logged,
      daysConfirmedNothingToReport: coverage.nothingToReport,
      daysUnaccountedFor: coverage.unaccounted,
      longestGapDays: coverage.longestGapDays,
      note:
        'A day confirmed as nothing-to-report carries an actual record. A day marked unaccounted ' +
        'for means nothing was recorded that day — not that nothing happened.',
      days: coverage.days.map((d) => ({ date: d.date, state: d.state, backfilledOnly: d.backfilledOnly })),
    },
    counts: {
      entries: entries.filter((e) => e.kind !== 'nothing-to-report').length,
      nothingToReportDays: entries.filter((e) => e.kind === 'nothing-to-report').length,
      writtenAfterTheFact: entries.filter((e) => !isContemporaneous(e)).length,
      timestampsReconstructed: entries.filter((e) => e.timestampsMigrated).length,
    },
    entries: entries.map((entry) => ({
      ...entry,
      occurredAtISO: isoLocal(entry.occurredAt),
      recordedAtISO: isoLocal(entry.recordedAt),
      recordingGapMs: recordingLag(entry),
      recordingGap: describeLag(recordingLag(entry)),
      contemporaneous: isContemporaneous(entry),
      attachments: (byEntry.get(entry.id) ?? []).map((a) => ({
        name: a.name,
        path: options.includeFiles ? `files/${a.exportPath}` : null,
        mime: a.mime,
        size: a.size,
        kind: a.kind,
        sha256: a.sha256,
        addedAtISO: isoLocal(a.addedAt),
      })),
    })),
    ledger,
  }

  const manifestJson = JSON.stringify(manifest, null, 2)
  zipFiles.unshift(
    { path: 'report.html', data: buildReport({
      case: theCase, entries, attachmentsByEntry: byEntry, ledger,
      headHash: chain.headHash, generatedAt: now, coverage,
    }), modified: new Date(now) },
    { path: 'manifest.json', data: manifestJson, modified: new Date(now) },
    { path: 'README.txt', data: readme(chain.intact, chain.headHash, describeCoverage(coverage)), modified: new Date(now) },
  )

  const blob = await createZip(zipFiles)
  const filename = `papertrail-${slug(theCase?.title ?? 'all-entries')}-${stamp(now)}.zip`
  download(blob, filename)

  await record('export.case', theCase?.id ?? '-', `Exported ${theCase ? `case: ${theCase.title}` : 'all entries'}`, {
    entries: entries.length,
    files: fileCount,
    includesFiles: options.includeFiles,
    manifestSha256: await sha256Text(manifestJson),
    headHashAtExport: chain.headHash,
  })

  return { filename, entries: entries.length, files: fileCount, size: blob.size }
}

function readme(intact: boolean, head: string, coverage: string): string {
  return `PAPERTRAIL EXPORT
=================

WHAT IS IN HERE
  report.html    Open this first. A readable timeline of every entry, with the
                 SHA-256 digest of each file. Prints to PDF from any browser.
  manifest.json  The same information in machine-readable form, plus the full
                 action log.
  files/         The original files, byte for byte as they were added.

HOW TO CHECK NOTHING WAS ALTERED
  Every file was hashed with SHA-256 the moment it was added to Papertrail, before
  any editing was possible. Re-hash a file and compare it to the digest listed for
  it in report.html or manifest.json:

    macOS / Linux    shasum -a 256 "files/001-example.jpg"
    Windows          certutil -hashfile "files\\001-example.jpg" SHA256

  A matching digest means the file is bit-for-bit what was recorded.

THE TWO TIMESTAMPS ON EVERY ENTRY
  Every entry carries two separate times, and the difference between them matters:

    Event occurred   when the thing being described happened. The person keeping
                     the log sets this, and can correct it.
    Written down     when the entry was created in the app. Set once from the
                     device clock, and no part of the app can change it
                     afterwards.

  Where those two are more than an hour apart, the entry is explicitly labelled
  as written up after the fact, together with the size of the gap. An entry
  written weeks later may be perfectly truthful, but it is not a contemporaneous
  note, and this bundle never presents it as one.

  A handful of entries may carry a warning that a timestamp was reconstructed.
  That means the value was missing from the stored record and was inferred from
  the other timestamp on the same entry. Treat those as approximate.

NOTHING-TO-REPORT DAYS AND GAPS
  ${coverage}

  Entries of type "nothing-to-report" record that the person keeping this log
  actively checked a given day and confirmed nothing happened. They are real
  records with their own timestamps, listed in the timeline and in
  manifest.json alongside everything else.

  A day that is neither logged nor confirmed is listed as unaccounted for. That
  means nothing was recorded on that day. It does not mean nothing happened.
  The coverage figures above state the difference plainly rather than leaving
  a reader to assume the log is complete.

THE ACTION LOG
  manifest.json contains a hash chain of every action ever taken in this
  Papertrail: entries created, edited, deleted, files added or removed, exports
  run. Each line includes the hash of the line before it, so a line cannot be
  removed or reworded after the fact without breaking every hash that follows.

  Chain state when this bundle was written: ${intact ? 'INTACT' : 'PROBLEMS FOUND — see integrity.problems in manifest.json'}
  Chain head hash: ${head}

WHAT THIS DOES AND DOES NOT PROVE
  It shows that the contents have not changed since they were recorded on this
  device, and it shows the order in which things were recorded. It is not a
  notarisation and it does not prove when an event actually happened, or that a
  recorded account is accurate. It is a consistent, checkable record — nothing
  more and nothing less.
`
}

/** A complete copy of the database, restorable into a fresh install. */
export async function exportBackup(): Promise<ExportResult> {
  const now = Date.now()
  const [cases, entries, attachments, ledger, anchors, prompts, settings] = await Promise.all([
    db.cases.toArray(), db.entries.toArray(), db.attachments.toArray(),
    db.ledger.orderBy('seq').toArray(), db.anchors.toArray(), db.prompts.toArray(),
    db.settings.toArray(),
  ])

  const files: ZipFile[] = [{
    path: 'papertrail-backup.json',
    data: JSON.stringify({
      format: 'papertrail-backup/2', createdAt: isoLocal(now),
      cases, entries, attachments, ledger, anchors, prompts, settings,
    }, null, 2),
    modified: new Date(now),
  }]

  // The calendar rides along, so restoring onto a new phone can re-arm the
  // reminders without the user having to remember to regenerate it.
  const sweep = await getSweep()
  if (anchors.length || sweep.enabled) {
    const device = settings.find((r) => r.key === 'deviceId')?.value
    files.push({
      path: 'papertrail-reminders.ics',
      data: buildCalendar({
        anchors, sweep,
        deviceId: typeof device === 'string' ? device : 'restored',
        now,
      }),
      modified: new Date(now),
    })
  }

  for (const att of attachments) {
    const blob = await getBlob(att.id)
    if (blob) files.push({ path: `blobs/${att.id}`, data: blob, modified: new Date(att.addedAt) })
  }

  const blob = await createZip(files)
  const filename = `papertrail-backup-${stamp(now)}.zip`
  download(blob, filename)
  await record('export.backup', '-', 'Full backup created', {
    cases: cases.length, entries: entries.length, attachments: attachments.length,
    anchors: anchors.length, prompts: prompts.length,
  })
  return { filename, entries: entries.length, files: attachments.length, size: blob.size }
}

export interface RestoreSummary {
  cases: number
  entries: number
  attachments: number
  ledger: number
}

/**
 * Restores from a backup produced by `exportBackup`. Existing rows with the same
 * id are replaced; ids are unique per device, so two devices merge rather than
 * collide. The restore itself is written to the ledger.
 */
export async function importBackup(zip: File): Promise<RestoreSummary> {
  const { readZip } = await import('./unzip')
  const files = await readZip(zip)
  const manifestBlob = files.get('papertrail-backup.json')
  if (!manifestBlob) throw new Error('Not a Papertrail backup: papertrail-backup.json is missing.')

  const parsed = JSON.parse(await manifestBlob.text()) as {
    format?: string
    cases?: Case[]
    entries?: StoredEntryRow[]
    attachments?: Attachment[]
    ledger?: unknown[]
    anchors?: Anchor[]
    prompts?: Prompt[]
    settings?: SettingRecord[]
  }
  // A backup written by version 1 predates the reminder tables and the entry
  // fields added with them, so it is accepted and its rows are brought up to
  // the current shape on the way in rather than rejected outright.
  if (parsed.format !== 'papertrail-backup/1' && parsed.format !== 'papertrail-backup/2') {
    throw new Error(`Unrecognised backup format: ${parsed.format ?? 'unknown'}`)
  }

  const cases = parsed.cases ?? []
  const attachments = parsed.attachments ?? []
  const anchors = parsed.anchors ?? []
  const prompts = parsed.prompts ?? []

  // Rows from an older backup go through exactly the same repair the schema
  // upgrade uses, so an import can never introduce an entry missing a
  // timestamp the rest of the app assumes is there.
  const restoreNow = Date.now()
  let reconstructed = 0
  const entries: Entry[] = (parsed.entries ?? []).map((row) => {
    const { row: fixed, migrated } = normalizeTimestamps(row, restoreNow)
    if (migrated) reconstructed++
    return fixed
  })

  // Table list as an array: Dexie's variadic transaction overloads stop short
  // of the number of stores this touches.
  await db.transaction(
    'rw',
    [db.cases, db.entries, db.attachments, db.blobs, db.anchors, db.prompts, db.settings],
    async () => {
      await db.cases.bulkPut(cases)
      await db.entries.bulkPut(entries)
      await db.attachments.bulkPut(attachments)
      if (anchors.length) await db.anchors.bulkPut(anchors)
      if (prompts.length) await db.prompts.bulkPut(prompts)
      // deviceId is deliberately not restored: a second phone importing this
      // backup must mint its own, or the two devices would emit colliding
      // calendar UIDs and overwrite each other's reminders.
      const settings = (parsed.settings ?? []).filter((r) => r.key !== 'deviceId')
      if (settings.length) await db.settings.bulkPut(settings)

      for (const att of attachments) {
        const blob = files.get(`blobs/${att.id}`)
        if (blob) await db.blobs.put({ id: att.id, data: blob })
      }
    },
  )

  // The imported ledger belongs to another chain, so it is not spliced into this
  // device's chain. The import is recorded here instead, with its head hash.
  const imported = (parsed.ledger ?? []) as { hash?: string }[]
  await record('import.backup', '-', `Restored from backup: ${zip.name}`, {
    format: parsed.format,
    cases: cases.length,
    entries: entries.length,
    attachments: attachments.length,
    anchors: anchors.length,
    timestampsReconstructed: reconstructed,
    importedLedgerLength: imported.length,
    importedHeadHash: imported.length ? (imported[imported.length - 1].hash ?? null) : null,
  })

  return { cases: cases.length, entries: entries.length, attachments: attachments.length, ledger: imported.length }
}
