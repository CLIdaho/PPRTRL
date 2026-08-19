import { db } from '../db/db'
import { record, verifyChain } from '../db/ledger'
import { getBlob } from '../db/repo'
import type { Attachment, Case, Entry } from '../db/types'
import { createZip, download, type ZipFile } from './zip'
import { buildReport, type ReportAttachment } from './report'
import { isoLocal } from './format'
import { safeFileName } from './files'
import { sha256Text } from './hash'

const APP_VERSION = '0.1.0'

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

  const manifest = {
    format: 'papertrail-export/1',
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
    entries: entries.map((entry) => ({
      ...entry,
      occurredAtISO: isoLocal(entry.occurredAt),
      recordedAtISO: isoLocal(entry.recordedAt),
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
      headHash: chain.headHash, generatedAt: now,
    }), modified: new Date(now) },
    { path: 'manifest.json', data: manifestJson, modified: new Date(now) },
    { path: 'README.txt', data: readme(chain.intact, chain.headHash), modified: new Date(now) },
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

function readme(intact: boolean, head: string): string {
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
  const [cases, entries, attachments, ledger] = await Promise.all([
    db.cases.toArray(), db.entries.toArray(), db.attachments.toArray(), db.ledger.orderBy('seq').toArray(),
  ])

  const files: ZipFile[] = [{
    path: 'papertrail-backup.json',
    data: JSON.stringify({ format: 'papertrail-backup/1', createdAt: isoLocal(now), cases, entries, attachments, ledger }, null, 2),
    modified: new Date(now),
  }]

  for (const att of attachments) {
    const blob = await getBlob(att.id)
    if (blob) files.push({ path: `blobs/${att.id}`, data: blob, modified: new Date(att.addedAt) })
  }

  const blob = await createZip(files)
  const filename = `papertrail-backup-${stamp(now)}.zip`
  download(blob, filename)
  await record('export.backup', '-', 'Full backup created', {
    cases: cases.length, entries: entries.length, attachments: attachments.length,
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
    entries?: Entry[]
    attachments?: Attachment[]
    ledger?: unknown[]
  }
  if (parsed.format !== 'papertrail-backup/1') {
    throw new Error(`Unrecognised backup format: ${parsed.format ?? 'unknown'}`)
  }

  const cases = parsed.cases ?? []
  const entries = parsed.entries ?? []
  const attachments = parsed.attachments ?? []

  await db.transaction('rw', db.cases, db.entries, db.attachments, db.blobs, async () => {
    await db.cases.bulkPut(cases)
    await db.entries.bulkPut(entries)
    await db.attachments.bulkPut(attachments)
    for (const att of attachments) {
      const blob = files.get(`blobs/${att.id}`)
      if (blob) await db.blobs.put({ id: att.id, data: blob })
    }
  })

  // The imported ledger belongs to another chain, so it is not spliced into this
  // device's chain. The import is recorded here instead, with its head hash.
  const imported = (parsed.ledger ?? []) as { hash?: string }[]
  await record('import.backup', '-', `Restored from backup: ${zip.name}`, {
    cases: cases.length,
    entries: entries.length,
    attachments: attachments.length,
    importedLedgerLength: imported.length,
    importedHeadHash: imported.length ? (imported[imported.length - 1].hash ?? null) : null,
  })

  return { cases: cases.length, entries: entries.length, attachments: attachments.length, ledger: imported.length }
}
