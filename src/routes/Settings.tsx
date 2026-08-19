import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { exportBackup, exportBundle, importBackup, type RestoreSummary } from '../lib/exporter'
import { ExportIcon, ShieldIcon } from '../components/icons'
import { formatBytes } from '../lib/files'

type Theme = 'dark' | 'light'

function useStorageEstimate() {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  useEffect(() => {
    if (!navigator.storage?.estimate) return
    void navigator.storage.estimate().then(setEstimate)
    void navigator.storage.persisted?.().then(setPersisted)
  }, [])

  return { estimate, persisted, setPersisted }
}

export function Settings() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('papertrail:theme') as Theme) ?? 'dark',
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { estimate, persisted, setPersisted } = useStorageEstimate()

  const counts = useLiveQuery(async () => ({
    cases: await db.cases.count(),
    entries: (await db.entries.toArray()).filter((e) => e.deletedAt === null).length,
    attachments: await db.attachments.count(),
    ledger: await db.ledger.count(),
  }), [], null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('papertrail:theme', theme)
  }, [theme])

  async function run(label: string, task: () => Promise<string>) {
    setBusy(label)
    setMessage(null)
    setError(null)
    try {
      setMessage(await task())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub">Backups, exports, and keeping your records safe.</p>
      </div>

      <div className="stack">
        <div className="banner">
          <ShieldIcon />
          <div>
            <strong>Everything here lives on this device only.</strong> There is no account and no
            server, nothing is uploaded, and the app works with no internet at all. That privacy has
            a cost: <strong>nobody is backing this up for you.</strong> If you lose this device or
            clear its browsing data, the records go with it.
          </div>
        </div>

        {counts && (
          <div className="card">
            <div className="section-label">What you have stored</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="chip">{counts.entries} entries</span>
              <span className="chip">{counts.cases} cases</span>
              <span className="chip">{counts.attachments} files</span>
              <span className="chip">{counts.ledger} ledger lines</span>
            </div>
            {estimate?.usage != null && (
              <p className="tiny faint" style={{ marginTop: 10 }}>
                Using {formatBytes(estimate.usage)}
                {estimate.quota ? ` of about ${formatBytes(estimate.quota)} available` : ''}.
              </p>
            )}
          </div>
        )}

        <div className="card stack">
          <div className="section-label">Backup — do this one</div>
          <p className="small muted">
            Saves everything you have — every case, entry, file and History line — into a single ZIP
            you can keep somewhere else. It is the only safety net you have, so make one now and
            again after anything important.
          </p>
          <button
            className="btn block"
            disabled={busy !== null}
            onClick={() =>
              void run('backup', async () => {
                const r = await exportBackup()
                return `Saved ${r.filename} (${formatBytes(r.size)}).`
              })
            }
          >
            <ExportIcon />
            {busy === 'backup' ? 'Building backup…' : 'Download a full backup'}
          </button>

          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void run('restore', async () => {
                const r: RestoreSummary = await importBackup(file)
                return `Restored ${r.entries} entries, ${r.cases} cases, and ${r.attachments} files.`
              })
            }}
          />
          <button className="btn block" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {busy === 'restore' ? 'Restoring…' : 'Restore from a backup'}
          </button>
          <p className="tiny faint">
            Restoring <strong>adds to</strong> what is already here — it never wipes or replaces your
            existing records, so it is safe to run on a device that already has entries.
          </p>
        </div>

        <div className="card stack">
          <div className="section-label">Export everything</div>
          <p className="small muted">
            For handing to someone else. A readable report of every entry, with the files and a way
            for them to check nothing was altered. Unlike a backup, this is meant to be opened and
            read by a person who does not have Papertrail.
          </p>
          <button
            className="btn block"
            disabled={busy !== null}
            onClick={() =>
              void run('export', async () => {
                const r = await exportBundle({ caseId: null, includeFiles: true })
                return `Saved ${r.filename} — ${r.entries} entries, ${r.files} files, ${formatBytes(r.size)}.`
              })
            }
          >
            <ExportIcon />
            {busy === 'export' ? 'Building bundle…' : 'Export all entries'}
          </button>
        </div>

        <div className="card stack">
          <div className="section-label">Stop your browser deleting this</div>
          <p className="small muted">
            Browsers sometimes clear stored data for sites they think you have stopped using. This
            asks yours to hold on to your records instead. Worth doing right now.
          </p>
          <button
            className="btn block"
            disabled={persisted === true || busy !== null}
            onClick={() =>
              void run('persist', async () => {
                const granted = (await navigator.storage?.persist?.()) ?? false
                setPersisted(granted)
                return granted
                  ? 'This device will now keep Papertrail data unless you delete it.'
                  : 'The browser declined. Installing Papertrail to your home screen usually grants it.'
              })
            }
          >
            {persisted === true ? 'Storage is already persistent' : 'Request persistent storage'}
          </button>
        </div>

        <div className="card stack">
          <div className="section-label">Appearance</div>
          <p className="tiny faint" style={{ marginTop: -4 }}>Light theme is easier to read outdoors.</p>
          <div className="row" style={{ gap: 6 }}>
            {(['dark', 'light'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                className="chip filter-chip"
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {message && <div className="banner ok"><ShieldIcon />{message}</div>}
        {error && <div className="banner bad"><ShieldIcon />{error}</div>}

        <p className="tiny faint" style={{ textAlign: 'center', marginTop: 8 }}>
          Papertrail shows that what you recorded has not changed since you recorded it. It cannot
          prove an event happened, and it is not legal advice.
        </p>
      </div>
    </>
  )
}
