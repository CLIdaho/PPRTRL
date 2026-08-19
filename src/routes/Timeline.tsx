import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import type { Entry } from '../db/types'
import { EntryCard } from '../components/EntryCard'
import { PlusIcon, SearchIcon } from '../components/icons'
import { formatDayHeading } from '../lib/format'

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

      {entries.length > 0 && (
        <div className="stack" style={{ marginBottom: 18 }}>
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
        <div className="empty">
          <h3>Start the trail</h3>
          <p>
            Record what happened while it is fresh. Each file you attach is hashed the moment it
            arrives, and every action is logged in order.
          </p>
          <Link to="/entry/new" className="btn primary">
            <PlusIcon size={18} />
            Record the first entry
          </Link>
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
