import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Entry } from '../db/types'
import { formatDateTime, relativeTime } from '../lib/format'
import { isContemporaneous } from '../db/migrate'
import { BlobImage } from './BlobImage'
import { kindIcons } from './icons'

const MAX_THUMBS = 4

export function EntryCard({ entry, caseTitle }: { entry: Entry; caseTitle?: string }) {
  const attachments = useLiveQuery(
    () => db.attachments.where('entryId').equals(entry.id).sortBy('addedAt'),
    [entry.id],
    [],
  )

  const shown = attachments.slice(0, MAX_THUMBS)
  const extra = attachments.length - shown.length

  const written = !isContemporaneous(entry)

  return (
    <Link
      to={`/entry/${entry.id}`}
      className={`card card-link entry-card${entry.kind === 'nothing-to-report' ? ' entry-kind-ntr' : ''}`}
    >
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="grow">
          <h3>{entry.title}</h3>
          <div className="time">{formatDateTime(entry.occurredAt)}</div>
          {/* Two timestamps, and the gap between them, wherever an entry is
              shown. An entry written up weeks later should never be able to
              pass itself off as one written at the time. */}
          {written && (
            <div className="provenance-tag" title={`Written down ${formatDateTime(entry.recordedAt)}`}>
              Written down {relativeTime(entry.recordedAt)}, not at the time
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {entry.status === 'draft' && <span className="chip accent">Draft</span>}
          {caseTitle && <span className="chip truncate" style={{ maxWidth: 130 }}>{caseTitle}</span>}
        </div>
      </div>

      {entry.notes.trim() && <p className="excerpt">{entry.notes}</p>}

      {(entry.tags.length > 0 || entry.people.length > 0) && (
        <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
          {entry.people.map((p) => <span key={`p-${p}`} className="chip">{p}</span>)}
          {entry.tags.map((t) => <span key={`t-${t}`} className="chip accent">#{t}</span>)}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="thumbs">
          {shown.map((att) => {
            const Icon = kindIcons[att.kind]
            return att.kind === 'image' ? (
              <BlobImage key={att.id} attachmentId={att.id} alt={att.name} className="thumb" />
            ) : (
              <div key={att.id} className="thumb" title={att.name}><Icon /></div>
            )
          })}
          {extra > 0 && <div className="thumb more">+{extra}</div>}
        </div>
      )}
    </Link>
  )
}
