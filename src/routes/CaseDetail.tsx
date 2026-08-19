import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { useRecord } from '../db/hooks'
import { updateCase } from '../db/repo'
import type { CaseStatus } from '../db/types'
import { EntryCard } from '../components/EntryCard'
import { Explain } from '../components/Explain'
import { Sheet } from '../components/Sheet'
import { ExportIcon, PlusIcon } from '../components/icons'
import { exportBundle, type ExportResult } from '../lib/exporter'
import { formatBytes } from '../lib/files'
import { formatDate } from '../lib/format'

const STATUSES: CaseStatus[] = ['open', 'resolved', 'archived']

export function CaseDetail() {
  const { caseId } = useParams()
  const [exporting, setExporting] = useState(false)
  const [includeFiles, setIncludeFiles] = useState(true)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [busy, setBusy] = useState(false)

  const { loading, value: theCase } = useRecord(() => db.cases.get(caseId!), [caseId])
  const entries = useLiveQuery(
    async () => (await db.entries.where('caseId').equals(caseId!).toArray())
      .filter((e) => e.deletedAt === null)
      .sort((a, b) => b.occurredAt - a.occurredAt),
    [caseId],
    [],
  )

  if (loading) return <p className="muted">Loading…</p>
  if (!theCase) return <p className="muted">That case no longer exists.</p>

  const span = entries.length
    ? `${formatDate(entries[entries.length - 1].occurredAt)} – ${formatDate(entries[0].occurredAt)}`
    : null

  return (
    <>
      <div className="page-head">
        <h1>{theCase.title}</h1>
        {theCase.summary && <p className="sub">{theCase.summary}</p>}
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          <span className="tiny faint" style={{ marginRight: 2 }}>Status</span>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className="chip filter-chip"
              aria-pressed={theCase.status === s}
              onClick={() => void updateCase(theCase.id, { status: s })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
        <Link className="btn primary" to={`/entry/new?case=${theCase.id}`}>
          <PlusIcon size={18} />
          Record entry
        </Link>
        <button className="btn" onClick={() => setExporting(true)} disabled={entries.length === 0}>
          <ExportIcon />
          Export case
        </button>
      </div>

      <Explain question="What does “export case” give me?">
        <p>
          One ZIP file holding a printable report of these entries, the original files, and a page
          explaining how anyone can check that nothing was altered.
        </p>
        <p>
          The person you send it to needs no account and no copy of Papertrail — they just open the
          report in a browser.
        </p>
      </Explain>

      <p className="small faint" style={{ marginTop: 14, marginBottom: 14 }}>
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        {span ? ` · ${span}` : ''}
      </p>

      {entries.length === 0 ? (
        <div className="empty">
          <h3>Nothing filed here yet</h3>
          <p>Record the first entry for this case.</p>
          <Link className="btn primary" to={`/entry/new?case=${theCase.id}`}>
            <PlusIcon size={18} />
            Record entry
          </Link>
        </div>
      ) : (
        <div className="stack">
          {entries.map((entry) => <EntryCard key={entry.id} entry={entry} />)}
        </div>
      )}

      {exporting && (
        <Sheet
          title={result ? 'Export ready' : 'Export this case'}
          onClose={() => {
            setExporting(false)
            setResult(null)
          }}
          footer={
            result ? (
              <button className="btn primary" onClick={() => { setExporting(false); setResult(null) }}>
                Done
              </button>
            ) : (
              <>
                <button className="btn ghost" onClick={() => setExporting(false)} disabled={busy}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void exportBundle({ caseId: theCase.id, includeFiles })
                      .then(setResult)
                      .finally(() => setBusy(false))
                  }}
                >
                  {busy ? 'Building…' : 'Build bundle'}
                </button>
              </>
            )
          }
        >
          {result ? (
            <p className="small muted">
              Saved <strong>{result.filename}</strong> — {result.entries}{' '}
              {result.entries === 1 ? 'entry' : 'entries'}, {result.files}{' '}
              {result.files === 1 ? 'file' : 'files'}, {formatBytes(result.size)}. Open{' '}
              <code>report.html</code> inside it to read the timeline.
            </p>
          ) : (
            <>
              <p className="small muted" style={{ marginBottom: 14 }}>
                You get a ZIP containing a printable report, a machine-readable manifest, the hash
                chain, and instructions anyone can follow to check the files were not altered.
              </p>
              <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeFiles}
                  onChange={(e) => setIncludeFiles(e.target.checked)}
                />
                <span className="small">
                  Include the files themselves
                  <span className="tiny faint" style={{ display: 'block' }}>
                    Uncheck for a small bundle with hashes only.
                  </span>
                </span>
              </label>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
