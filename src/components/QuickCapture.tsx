import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { createEntry } from '../db/repo'
import { answerPrompt } from '../db/reminders'
import { PlusIcon } from './icons'

/**
 * Quick capture: tap, type one line, saved.
 *
 * The target is under ten seconds from tap to stored, which rules out a route
 * change (a paint and a scroll reset), a case picker, and any required field
 * beyond the text itself. Everything else — files, tags, people, a corrected
 * time — is added later from the drafts list, when the user is not standing in
 * front of the thing they are trying to write down.
 */
export function QuickCaptureSheet({
  onClose,
  promptId = null,
  occurredAt,
  defaultTitle = '',
}: {
  onClose: () => void
  promptId?: string | null
  occurredAt?: number
  defaultTitle?: string
}) {
  const [text, setText] = useState(defaultTitle)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    // Focus on the next frame: focusing during the same tick that opens the
    // sheet loses the keyboard on Android.
    const id = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save(thenOpen: boolean) {
    const title = text.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      const when = occurredAt ?? Date.now()
      const entry = await createEntry({
        caseId: null,
        // The first line becomes the title; anything after it is the account.
        title: title.split('\n')[0].slice(0, 120),
        notes: title.includes('\n') ? title.slice(title.indexOf('\n') + 1).trim() : '',
        occurredAt: when,
        tags: [],
        people: [],
        location: '',
        source: '',
        status: 'draft',
        promptId,
        provenance: promptId && occurredAt ? 'catch-up' : undefined,
      })
      if (promptId) await answerPrompt(promptId, entry.id)
      onClose()
      if (thenOpen) navigate(`/entry/${entry.id}/edit`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet quick-sheet" role="dialog" aria-modal="true" aria-label="Quick capture">
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>Write it down</h2>
        <p className="tiny faint" style={{ marginBottom: 12 }}>
          {occurredAt
            ? 'Dated to the day this is about. When you wrote it is recorded separately.'
            : 'Saved as a draft the moment you tap save. Add files and details later.'}
        </p>

        <textarea
          ref={input}
          className="textarea"
          style={{ minHeight: 120 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened?"
          enterKeyHint="done"
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter saves without reaching for the button.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void save(false)
            }
          }}
        />

        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <div className="grow" />
          <button className="btn" onClick={() => void save(true)} disabled={busy || !text.trim()}>
            Save &amp; add detail
          </button>
          <button className="btn primary" onClick={() => void save(false)} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The always-reachable capture button, pinned above the tab bar. */
export function QuickCaptureButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="fab" onClick={onOpen} aria-label="Quick capture — write something down now">
      <PlusIcon size={24} />
    </button>
  )
}
