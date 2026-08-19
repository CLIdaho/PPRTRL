import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { useRecord } from '../db/hooks'
import { deleteEntry, getBlob } from '../db/repo'
import type { Attachment } from '../db/types'
import { useBlobUrl } from '../components/BlobImage'
import { Sheet } from '../components/Sheet'
import { EditIcon, kindIcons, ShieldIcon, TrashIcon } from '../components/icons'
import { formatBytes, isPreviewable, KIND_LABEL } from '../lib/files'
import { formatDateTime, isoLocal, relativeTime } from '../lib/format'
import { download } from '../lib/zip'

function AttachmentView({ att }: { att: Attachment }) {
  const url = useBlobUrl(att.id)
  const Icon = kindIcons[att.kind]
  const previewable = isPreviewable(att.kind, att.mime)

  return (
    <div className="card stack">
      <div className="row" style={{ gap: 11 }}>
        <span className="file-icon"><Icon /></span>
        <div className="grow">
          <div className="truncate" style={{ fontWeight: 540 }}>{att.name}</div>
          <div className="tiny faint">
            {KIND_LABEL[att.kind]} · {formatBytes(att.size)} · added {relativeTime(att.addedAt)}
          </div>
        </div>
        <button
          className="btn sm"
          onClick={() => void getBlob(att.id).then((b) => b && download(b, att.name))}
        >
          Save
        </button>
      </div>

      {url && previewable && (
        <div className="viewer">
          {att.kind === 'image' && <img src={url} alt={att.name} />}
          {att.kind === 'video' && <video src={url} controls preload="metadata" />}
          {att.kind === 'audio' && <audio src={url} controls />}
          {/* `sandbox` with no allowances: render the bytes, run nothing. */}
          {(att.kind === 'pdf' || att.kind === 'document') && (
            <iframe src={url} title={att.name} sandbox="" referrerPolicy="no-referrer" />
          )}
        </div>
      )}

      {!previewable && (
        <div className="viewer">
          <div className="file-fallback">
            <Icon size={26} />
            <p className="small" style={{ marginTop: 8 }}>
              This kind of file can’t be shown here. Tap Save to open it in another app — the file
              itself is stored safely either way.
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="tiny faint" title="A fingerprint of this file's contents, taken when you added it. Re-check it any time from the History screen.">
          Fingerprint taken when you added this file
        </div>
        <div className="mono tiny break" style={{ marginTop: 2 }}>{att.sha256}</div>
      </div>
    </div>
  )
}

export function EntryDetail() {
  const { entryId } = useParams()
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')

  const { loading, value: entry } = useRecord(() => db.entries.get(entryId!), [entryId])
  const attachments = useLiveQuery(
    () => db.attachments.where('entryId').equals(entryId!).sortBy('addedAt'),
    [entryId],
    [],
  )
  const theCase = useLiveQuery(
    async () => (entry?.caseId ? await db.cases.get(entry.caseId) : undefined),
    [entry?.caseId],
    undefined,
  )
  const history = useLiveQuery(
    () => db.ledger.where('subject').equals(entryId!).sortBy('seq'),
    [entryId],
    [],
  )

  if (loading) return <p className="muted">Loading…</p>
  if (!entry) return <p className="muted">That entry no longer exists.</p>

  const edited = entry.updatedAt - entry.recordedAt > 1000

  return (
    <>
      <div className="page-head">
        {theCase && (
          <Link to={`/case/${theCase.id}`} className="chip" style={{ textDecoration: 'none', marginBottom: 8 }}>
            {theCase.title}
          </Link>
        )}
        <h1 style={{ marginTop: theCase ? 8 : 0 }}>{entry.title}</h1>
        <p className="sub">{formatDateTime(entry.occurredAt)}</p>
      </div>

      {entry.deletedAt && (
        <div className="banner bad" style={{ marginBottom: 14 }}>
          <ShieldIcon />
          <div>
            You deleted this entry {relativeTime(entry.deletedAt)}. Its files are gone for good, but
            History still shows that it existed and was deleted — so your record has no silent gaps.
          </div>
        </div>
      )}

      <div className="stack">
        {entry.notes.trim() && (
          <div className="card">
            {entry.notes.trim().split(/\n{2,}/).map((para, i) => (
              <p key={i} style={{ marginTop: i ? 12 : 0, whiteSpace: 'pre-wrap' }}>{para}</p>
            ))}
          </div>
        )}

        {(entry.people.length > 0 || entry.location || entry.source || entry.tags.length > 0) && (
          <div className="card stack" style={{ gap: 10 }}>
            {entry.people.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="tiny faint" style={{ width: 62 }}>Who</span>
                {entry.people.map((p) => <span key={p} className="chip">{p}</span>)}
              </div>
            )}
            {entry.location && (
              <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <span className="tiny faint" style={{ width: 62, flex: 'none' }}>Where</span>
                <span className="small">{entry.location}</span>
              </div>
            )}
            {entry.source && (
              <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <span className="tiny faint" style={{ width: 62, flex: 'none' }}>Source</span>
                <span className="small">{entry.source}</span>
              </div>
            )}
            {entry.tags.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="tiny faint" style={{ width: 62 }}>Tags</span>
                {entry.tags.map((t) => <span key={t} className="chip accent">#{t}</span>)}
              </div>
            )}
          </div>
        )}

        {attachments.map((att) => <AttachmentView key={att.id} att={att} />)}

        <div className="card">
          <div className="section-label">When this was written down</div>
          <div className="small muted">Recorded {formatDateTime(entry.recordedAt)}</div>
          {edited && <div className="small muted">Last edited {formatDateTime(entry.updatedAt)}</div>}
          <div className="tiny faint mono" style={{ marginTop: 6 }}>{isoLocal(entry.occurredAt)}</div>

          {history.length > 0 && (
            <>
              <div className="divider" />
              <div className="section-label">What has happened to this entry</div>
              {history.map((h) => (
                <div className="ledger-item" key={h.seq}>
                  <span className="ledger-seq">{h.seq}</span>
                  <div>
                    <div className="small">{h.summary}</div>
                    <div className="tiny faint">{formatDateTime(h.at)} · {h.action}</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {!entry.deletedAt && (
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn danger" onClick={() => setConfirming(true)}>
              <TrashIcon />
              Delete
            </button>
            <Link className="btn" to={`/entry/${entry.id}/edit`}>
              <EditIcon />
              Edit
            </Link>
          </div>
        )}
      </div>

      {confirming && (
        <Sheet
          title="Delete this entry?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirming(false)}>Keep it</button>
              <button
                className="btn danger"
                onClick={() =>
                  void deleteEntry(entry.id, reason).then(() => navigate('/', { replace: true }))
                }
              >
                Delete
              </button>
            </>
          }
        >
          <p className="small muted" style={{ marginBottom: 14 }}>
            The attached files will be erased and cannot be recovered. The ledger will keep a
            permanent line saying this entry existed and was deleted — that is deliberate, so the
            trail never has a silent gap.
          </p>
          <div className="field">
            <label htmlFor="reason">Reason (recorded in the ledger)</label>
            <input
              id="reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate of entry above"
            />
          </div>
        </Sheet>
      )}
    </>
  )
}
