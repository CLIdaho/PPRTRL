import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import type { Entry } from '../db/types'
import { EntryCard } from '../components/EntryCard'
import { Explain } from '../components/Explain'
import { InstallPrompt } from '../components/InstallPrompt'
import { PlusIcon, SearchIcon } from '../components/icons'
import { formatDateTime, formatDayHeading } from '../lib/format'

function matches(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    entry.title.toLowerCase().includes(q) ||
    entry.notes.toLowerCase().includes(q) ||
    entry.location.toLowerCase().includes(q) ||
    entry.source.toLowerCase().includes(q) ||
    entry.tags.some((t) => t.toLowerCase().includes(q)) ||
    entry.people.some((p) => p.toLowerCase().includes(q))
  )
}

/** Groups entries into day buckets, newest day first. */
function byDay(entries: Entry[]): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>()
  for (const entry of entries) {
    const key = new Date(entry.occurredAt).toDateString()
    const bucket = groups.get(key)
    if (bucket) bucket.push(entry)
    else groups.set(key, [entry])
  }
  return [...groups.entries()]
}

export function Timeline() {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const entries = useLiveQuery(
    async () => (await db.entries.toArray())
      .filter((e) => e.deletedAt === null)
      .sort((a, b) => b.occurredAt - a.occurredAt),
    [],
    undefined,
  )
  const cases = useLiveQuery(() => db.cases.toArray(), [], [])
  const drafts = useLiveQuery(
    async () => (await db.entries.where('status').equals('draft').toArray())
      .filter((e) => e.deletedAt === null)
      .sort((a, b) => b.recordedAt - a.recordedAt),
    [], [],
  )
  const caseTitles = useMemo(
    () => new Map(cases.map((c) => [c.id, c.title] as const)),
    [cases],
  )

  const topTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of entries ?? []) {
      for (const t of entry.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
  }, [entries])

  const visible = useMemo(
    () => (entries ?? []).filter((e) => matches(e, query) && (!tag || e.tags.includes(tag))),
    [entries, query, tag],
  )

  if (entries === undefined) return <p className="muted">Opening your records…</p>

  return (
    <>
      <div className="page-head row between">
        <div>
          <h1>Timeline</h1>
          <p className="sub">
            {entries.length === 0
              ? 'Nothing recorded yet'
              : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}${
                  visible.length !== entries.length ? ` · ${visible.length} shown` : ''
                }`}
          </p>
        </div>
        <Link to="/entry/new" className="btn primary">
          <PlusIcon size={18} />
          Record
        </Link>
      </div>

      {drafts.length > 0 && (
        <div className="card stack" style={{ marginBottom: 14 }}>
          <div className="section-label">Drafts — finish these when you have a moment</div>
          <p className="tiny faint" style={{ marginTop: -4 }}>
            Captured quickly and saved as-is. They are already real records; adding files, tags and
            the right time only makes them stronger.
          </p>
          {drafts.map((d) => (
            <Link key={d.id} to={`/entry/${d.id}/edit`} className="prompt-row" style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="grow">
                <div className="truncate" style={{ fontWeight: 540 }}>{d.title}</div>
                <div className="tiny faint">{formatDateTime(d.occurredAt)}</div>
              </div>
              <span className="chip accent">Add detail</span>
            </Link>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <div className="stack" style={{ marginBottom: 18 }}>
          <InstallPrompt dismissible />
          <Explain question="What is this screen?">
            <p>
              Everything you have recorded, newest first, whether or not it belongs to a case. Tap
              any entry to see the full account and its files.
            </p>
            <p>
              Search looks through titles, your written account, names, places and tags. Tap a tag to
              show only entries carrying it.
            </p>
          </Explain>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              style={{ paddingLeft: 38 }}
              placeholder="Search entries, people, places, tags"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              aria-label="Search entries"
            />
            <span
              aria-hidden="true"
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--text-faint)', display: 'flex', pointerEvents: 'none',
              }}
            >
              <SearchIcon />
            </span>
          </div>

          {topTags.length > 0 && (
            <div className="row wrap" style={{ gap: 6 }}>
              {topTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="chip filter-chip"
                  aria-pressed={tag === t}
                  onClick={() => setTag(tag === t ? null : t)}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="stack">
          <div className="welcome-hero">
            <h1>Welcome to Papertrail</h1>
            <p>A private place to write down things as they happen, and keep proof they haven’t
              been changed since.</p>
          </div>

          <div className="card">
            <div className="section-label">How it works</div>
            <div className="step">
              <span className="step-num">1</span>
              <div>
                <h4>Write down what happened</h4>
                <p>A short title and the story in your own words. Do it while you still remember the
                  details — that is the part you cannot get back later.</p>
              </div>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <div>
                <h4>Attach anything that came with it</h4>
                <p>Photos, screenshots, video, voice recordings, PDFs, letters, documents. Papertrail
                  takes a fingerprint of each file the moment you add it.</p>
              </div>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <div>
                <h4>Hand someone the whole story later</h4>
                <p>Export a single file containing your timeline, your evidence, and a way for them
                  to check that none of it was altered.</p>
              </div>
            </div>
          </div>

          <Link to="/entry/new" className="btn primary block">
            <PlusIcon size={18} />
            Record your first entry
          </Link>

          <InstallPrompt dismissible />

          <Explain question="Where is my information stored?">
            <p>
              <strong>Only on this device.</strong> Papertrail has no account and no server. Nothing
              is uploaded anywhere, and once installed it works with no internet at all.
            </p>
            <p>
              The trade-off: nobody is backing it up for you. Visit Settings early to turn on
              persistent storage and save a backup somewhere safe.
            </p>
          </Explain>

          <Link className="btn block" to="/guide">Read the two-minute guide</Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h3>No matches</h3>
          <p>Nothing here matches that search.</p>
          <button
            className="btn"
            onClick={() => {
              setQuery('')
              setTag(null)
            }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        byDay(visible).map(([day, group]) => (
          <section key={day}>
            <h2 className="day-heading">{formatDayHeading(group[0].occurredAt)}</h2>
            <div className="stack">
              {group.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  caseTitle={entry.caseId ? caseTitles.get(entry.caseId) : undefined}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}
