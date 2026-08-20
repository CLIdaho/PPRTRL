import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { db } from '../db/db'
import { useRecord } from '../db/hooks'
import type { Attachment } from '../db/types'
import { addAttachment, createEntry, removeAttachment, updateEntry } from '../db/repo'
import { FilePicker } from '../components/FilePicker'
import { kindIcons, TrashIcon } from '../components/icons'
import { formatBytes } from '../lib/files'
import { formatDateTime, fromLocalInput, parseList, toLocalInput } from '../lib/format'
import { shortHash } from '../lib/hash'

/** One form for both recording a new entry and editing an existing one. */
export function EntryForm() {
  const { entryId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const editing = Boolean(entryId)

  const { loading, value: existing } = useRecord(
    async () => (entryId ? await db.entries.get(entryId) : undefined),
    [entryId],
  )
  const cases = useLiveQuery(() => db.cases.orderBy('updatedAt').reverse().toArray(), [], [])
  const attachments = useLiveQuery(
    async () => (entryId ? await db.attachments.where('entryId').equals(entryId).sortBy('addedAt') : []),
    [entryId],
    [] as Attachment[],
  )

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => toLocalInput(Date.now()))
  const [caseId, setCaseId] = useState<string>(params.get('case') ?? '')
  const [tags, setTags] = useState('')
  const [people, setPeople] = useState('')
  const [location, setLocation] = useState('')
  const [source, setSource] = useState('')
  const [pending, setPending] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Populate once from the stored entry; later live updates must not stomp on
  // whatever the user is currently typing.
  useEffect(() => {
    if (!editing || !existing || loaded) return
    setTitle(existing.title)
    setNotes(existing.notes)
    setOccurredAt(toLocalInput(existing.occurredAt))
    setCaseId(existing.caseId ?? '')
    setTags(existing.tags.join(', '))
    setPeople(existing.people.join(', '))
    setLocation(existing.location)
    setSource(existing.source)
    setLoaded(true)
  }, [editing, existing, loaded])

  const pendingSize = useMemo(() => pending.reduce((n, f) => n + f.size, 0), [pending])

  async function save() {
    setBusy(true)
    try {
      const shared = {
        caseId: caseId || null,
        title,
        notes,
        occurredAt: fromLocalInput(occurredAt),
        tags: parseList(tags),
        people: parseList(people),
        location,
        source,
      }
      if (editing && entryId) {
        await updateEntry(entryId, {
          ...shared,
          title: shared.title.trim() || 'Untitled entry',
          location: shared.location.trim(),
          source: shared.source.trim(),
          // Enriching a quick capture is what completes it. recordedAt stays at
          // the moment of capture — finishing the detail later does not make the
          // entry newer, and pretending otherwise would lose the earlier claim.
          status: 'complete',
        })
        for (const file of pending) await addAttachment(entryId, file)
        navigate(`/entry/${entryId}`, { replace: true })
      } else {
        const entry = await createEntry(shared, pending)
        navigate(`/entry/${entry.id}`, { replace: true })
      }
    } finally {
      setBusy(false)
    }
  }

  if (editing && loading) return <p className="muted">Loading…</p>
  if (editing && !existing) return <p className="muted">That entry no longer exists.</p>

  return (
    <>
      <div className="page-head">
        <h1>{editing ? (existing?.status === 'draft' ? 'Add detail' : 'Edit entry') : 'Record an entry'}</h1>
        <p className="sub">
          {editing
            ? existing?.status === 'draft'
              ? 'Finishing a quick capture. When you wrote it stays as it was.'
              : 'Your original wording is kept in History, so editing never erases what you first said.'
            : 'Write it down while you still remember it clearly.'}
        </p>
      </div>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="card stack">
          <div className="field">
            <label htmlFor="title">What happened?</label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short description, e.g. “Third notice taped to door”"
              autoFocus={!editing}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="occurred">When did it happen?</label>
            <input
              id="occurred"
              className="input"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
            <span className="hint">
              Defaults to right now. Change it if you are writing this up after the fact — the
              timeline sorts by this, not by when you typed it.
            </span>
          </div>

          {/*
            recordedAt is shown, never offered. Making it an input the app then
            refuses to honour would be worse than not showing it at all.
          */}
          {editing && existing && (
            <div className="field">
              <label>When you wrote it down</label>
              <div className="readonly-stamp">
                {formatDateTime(existing.recordedAt)}
                <span className="tiny faint"> · fixed</span>
              </div>
              <span className="hint">
                Set once by the clock when this entry was created. Nothing in Papertrail can change
                it — that is what makes it worth anything.
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="notes">Tell the story</label>
            <textarea
              id="notes"
              className="textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was said and done, in your own words. Detail you write now is detail you will not have to reconstruct later."
            />
          </div>
        </div>

        <div className="card stack">
          <div className="section-label">Files</div>
          <p className="tiny faint" style={{ marginTop: -4 }}>
            Anything at all: photos, screenshots, video, voice memos, PDFs, letters, documents. Each
            one gets a fingerprint the moment you save, so you can prove later it was never altered.
          </p>
          <FilePicker onFiles={(files) => setPending((prev) => [...prev, ...files])} />

          {pending.length > 0 && (
            <div>
              {pending.map((file, i) => {
                const Icon = kindIcons.other
                return (
                  <div className="file-row" key={`${file.name}-${i}`}>
                    <span className="file-icon"><Icon /></span>
                    <div className="grow">
                      <div className="truncate">{file.name}</div>
                      <div className="tiny faint">{formatBytes(file.size)} · hashed when saved</div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setPending((prev) => prev.filter((_, index) => index !== i))}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              })}
              <p className="tiny faint" style={{ marginTop: 6 }}>
                {pending.length} file{pending.length === 1 ? '' : 's'} · {formatBytes(pendingSize)} to add
              </p>
            </div>
          )}

          {attachments.length > 0 && (
            <div>
              <div className="section-label" style={{ marginTop: 6 }}>Already attached</div>
              {attachments.map((att) => {
                const Icon = kindIcons[att.kind]
                return (
                  <div className="file-row" key={att.id}>
                    <span className="file-icon"><Icon /></span>
                    <div className="grow">
                      <div className="truncate">{att.name}</div>
                      <div className="tiny faint mono">{formatBytes(att.size)} · {shortHash(att.sha256)}</div>
                    </div>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${att.name}`}
                      onClick={() => void removeAttachment(att.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card stack">
          <div className="section-label">Details (all optional)</div>
          <p className="tiny faint" style={{ marginTop: -4 }}>
            Skip anything that does not apply. These make entries easier to find later, and make an
            export read far better to someone who wasn’t there.
          </p>

          <div className="field">
            <label htmlFor="case">Case</label>
            <select id="case" className="select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">No case</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="people">Who was involved?</label>
              <input
                id="people"
                className="input"
                value={people}
                onChange={(e) => setPeople(e.target.value)}
                placeholder="Comma separated" />
            </div>
            <div className="field">
              <label htmlFor="location">Where did it happen?</label>
              <input
                id="location"
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Address, room, phone number, URL"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="source">Where did these files come from?</label>
            <input
              id="source"
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. “screenshot of text thread”, “emailed to me by the office”"
            />
            <span className="hint">
              Where a piece of evidence came from often matters as much as the evidence itself.
            </span>
          </div>

          <div className="field">
            <label htmlFor="tags">Tags</label>
            <input
              id="tags"
              className="input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma separated"
            />
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn ghost" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Record entry'}
          </button>
        </div>
      </form>
    </>
  )
}
