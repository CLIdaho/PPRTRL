import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { createCase } from '../db/repo'
import { Explain } from '../components/Explain'
import { Sheet } from '../components/Sheet'
import { PlusIcon } from '../components/icons'
import { relativeTime } from '../lib/format'

const STATUS_CHIP = { open: 'chip accent', resolved: 'chip ok', archived: 'chip' } as const

export function Cases() {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')

  const cases = useLiveQuery(() => db.cases.orderBy('updatedAt').reverse().toArray(), [], undefined)
  const counts = useLiveQuery(async () => {
    const map = new Map<string, number>()
    await db.entries.each((e) => {
      if (e.caseId && e.deletedAt === null) map.set(e.caseId, (map.get(e.caseId) ?? 0) + 1)
    })
    return map
  }, [], new Map<string, number>())

  const loose = useLiveQuery(
    async () => (await db.entries.toArray()).filter((e) => !e.caseId && e.deletedAt === null).length,
    [],
    0,
  )

  if (cases === undefined) return <p className="muted">Loading…</p>

  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Cases</h1>
          <p className="sub">A folder for one situation you are documenting.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <PlusIcon size={18} />
          New
        </button>
      </div>

      {cases.length === 0 ? (
        <div className="stack">
          <div className="empty">
            <h3>No cases yet</h3>
            <p>
              A case groups related entries so you can export that one story on its own — without
              everything else you have recorded coming along with it.
            </p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              <PlusIcon size={18} />
              Open your first case
            </button>
          </div>
          <Explain question="Do I have to use cases?" defaultOpen>
            <p>
              <strong>No.</strong> Entries work perfectly well on their own, and you can file them
              into a case later at any time.
            </p>
            <p>
              Cases earn their keep when you have more than one thing going on at once, or when you
              want to hand someone just the part that concerns them.
            </p>
          </Explain>
        </div>
      ) : (
        <div className="stack">
          {cases.map((c) => (
            <Link key={c.id} to={`/case/${c.id}`} className="card card-link">
              <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div className="grow">
                  <h3 style={{ fontSize: 16 }}>{c.title}</h3>
                  {c.summary && <p className="excerpt">{c.summary}</p>}
                </div>
                <span className={STATUS_CHIP[c.status]}>{c.status}</span>
              </div>
              <div className="tiny faint" style={{ marginTop: 10 }}>
                {counts.get(c.id) ?? 0} {(counts.get(c.id) ?? 0) === 1 ? 'entry' : 'entries'} ·
                {' '}updated {relativeTime(c.updatedAt)}
              </div>
            </Link>
          ))}
        </div>
      )}

      {cases.length > 0 && (
        <Explain question="What does a case actually do?">
          <p>
            It keeps one story together. When you export a case you get a report covering just those
            entries — useful when handing something to a lawyer, an inspector, or HR who has no
            business seeing the rest.
          </p>
          <p>
            Marking a case <strong>resolved</strong> or <strong>archived</strong> only changes its
            label. Nothing is deleted or hidden, and the change is written to your History log.
          </p>
        </Explain>
      )}

      {loose > 0 && (
        <p className="small faint" style={{ marginTop: 16 }}>
          {loose} {loose === 1 ? 'entry is' : 'entries are'} not filed under any case.
        </p>
      )}

      {creating && (
        <Sheet
          title="Open a case"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button
                className="btn primary"
                disabled={!title.trim()}
                onClick={() =>
                  void createCase({ title, summary }).then(() => {
                    setTitle('')
                    setSummary('')
                    setCreating(false)
                  })
                }
              >
                Open case
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="field">
              <label htmlFor="case-title">Title</label>
              <input
                id="case-title"
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. “Unit 4B repairs”"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="case-summary">What this is about</label>
              <textarea
                id="case-summary"
                className="textarea"
                style={{ minHeight: 80 }}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Context for whoever reads the export later — including you, a year from now."
              />
            </div>
          </div>
        </Sheet>
      )}
    </>
  )
}
