import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { recordNothingToReport } from '../db/repo'
import {
  answerPrompt, dismissPrompt, getSweep, materialisePrompts, occurredAtForPrompt,
} from '../db/reminders'
import type { Prompt } from '../db/types'
import { buildCoverage, type CoverageDay } from '../lib/coverage'
import { localDateKey, noonOn } from '../lib/schedule'
import { QuickCaptureSheet } from '../components/QuickCapture'
import { Explain } from '../components/Explain'
import { AlertIcon, PlusIcon, ShieldIcon } from '../components/icons'
import { formatDate, formatDateTime, relativeTime } from '../lib/format'

const STATE_LABEL: Record<CoverageDay['state'], string> = {
  logged: 'Entry logged',
  'nothing-to-report': 'Nothing to report',
  unaccounted: 'Unaccounted for',
  future: 'Not yet',
}

export function CheckIn() {
  const navigate = useNavigate()
  const [capturing, setCapturing] = useState<{ promptId: string | null; occurredAt?: number; title?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [backfilling, setBackfilling] = useState<string | null>(null)

  const sweep = useLiveQuery(() => getSweep(), [], undefined)
  const prompts = useLiveQuery(
    async () => (await db.prompts.where('state').equals('pending').toArray()).sort((a, b) => a.dueAt - b.dueAt),
    [], undefined,
  )
  const entries = useLiveQuery(() => db.entries.toArray(), [], undefined)

  // Catch up on every visit to this screen. Prompts that fired while the app was
  // closed are reconstructed from the rules here — this is the delivery channel
  // that cannot silently fail, unlike anything the platform schedules for us.
  useEffect(() => {
    void materialisePrompts()
  }, [])

  const coverage = useMemo(
    () => (entries && sweep ? buildCoverage(entries, sweep.lookbackDays) : null),
    [entries, sweep],
  )

  if (!sweep || prompts === undefined || !coverage) {
    return <p className="muted">Working out what you have missed…</p>
  }

  const todayKey = localDateKey(Date.now())
  const todayCovered = coverage.days.find((d) => d.date === todayKey)?.state !== 'unaccounted'

  async function nothingToReport(forDate: string, promptId: string | null) {
    setBusy(forDate)
    try {
      const entry = await recordNothingToReport({ forDate, occurredAt: noonOn(forDate), promptId })
      if (promptId) await answerPrompt(promptId, entry.id)
    } finally {
      setBusy(null)
      setBackfilling(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Check-in</h1>
        <p className="sub">
          {prompts.length > 0
            ? `${prompts.length} reminder${prompts.length === 1 ? '' : 's'} waiting`
            : todayCovered ? 'Today is accounted for' : 'Nothing waiting'}
        </p>
      </div>

      <div className="stack">
        <Explain question="What is this screen for?">
          <p>
            Two things. The top is <strong>anything you were reminded about</strong> — including
            reminders that came due while the app was shut, which are worked out again from your
            schedule every time you open this screen. Nothing gets lost, only seen late.
          </p>
          <p>
            The bottom is <strong>your coverage</strong>: which days have a record and which are
            blank. A day you confirmed was quiet and a day you never looked at are very different
            things, and this screen keeps them apart.
          </p>
        </Explain>

        {/* ------------------------------------------------ pending prompts */}
        {prompts.length > 0 && (
          <div className="card stack">
            <div className="section-label">Waiting for you</div>
            {prompts.map((prompt) => (
              <PromptRow
                key={prompt.id}
                prompt={prompt}
                busy={busy === prompt.id}
                onCapture={() =>
                  setCapturing({
                    promptId: prompt.id,
                    occurredAt: occurredAtForPrompt(prompt),
                    title: prompt.kind === 'anchor' ? prompt.label : '',
                  })
                }
                onNothing={() => {
                  setBusy(prompt.id)
                  void nothingToReport(prompt.forDate, prompt.id)
                }}
                onDismiss={() => void dismissPrompt(prompt.id)}
              />
            ))}
          </div>
        )}

        {/* ------------------------------------------------ today */}
        <div className="card stack">
          <div className="section-label">Today — {formatDate(Date.now())}</div>
          {todayCovered ? (
            <div className="banner ok">
              <ShieldIcon />
              <div>Today has a record. Nothing more is needed.</div>
            </div>
          ) : (
            <>
              <p className="small muted">Did anything happen today worth writing down?</p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn primary grow"
                  onClick={() => setCapturing({ promptId: null })}
                >
                  <PlusIcon size={18} />
                  Yes — record it
                </button>
                <button
                  className="btn grow"
                  disabled={busy === todayKey}
                  onClick={() => void nothingToReport(todayKey, null)}
                >
                  {busy === todayKey ? 'Saving…' : 'Nothing to report'}
                </button>
              </div>
              <p className="tiny faint">
                “Nothing to report” is a real record, not a skip. It gets a timestamp, appears in
                your timeline, and is listed in the export — which is what makes a quiet day
                different from a day nobody checked.
              </p>
            </>
          )}
        </div>

        {/* ------------------------------------------------ coverage */}
        <div className="card stack">
          <div className="section-label">The last {coverage.totalDays} days</div>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="chip ok">{coverage.logged} logged</span>
            <span className="chip">{coverage.nothingToReport} quiet</span>
            <span className={coverage.unaccounted ? 'chip bad' : 'chip'}>
              {coverage.unaccounted} unaccounted for
            </span>
          </div>

          <div className="coverage-grid" role="list" aria-label="Daily coverage">
            {coverage.days.map((day) => (
              <button
                key={day.date}
                type="button"
                role="listitem"
                className={`coverage-cell ${day.state}${day.backfilledOnly ? ' backfilled' : ''}`}
                aria-label={`${day.date}: ${STATE_LABEL[day.state]}${day.backfilledOnly ? ', written up later' : ''}`}
                title={`${day.date} — ${STATE_LABEL[day.state]}${day.backfilledOnly ? ' (written up later)' : ''}`}
                onClick={() =>
                  day.state === 'unaccounted'
                    ? setBackfilling(day.date)
                    : day.entries[0] && navigate(`/entry/${day.entries[0].id}`)
                }
              >
                <span className="coverage-day">{Number(day.date.slice(8))}</span>
              </button>
            ))}
          </div>

          <div className="row wrap coverage-key">
            <span><i className="swatch logged" /> Entry</span>
            <span><i className="swatch nothing-to-report" /> Quiet</span>
            <span><i className="swatch unaccounted" /> Blank</span>
            <span><i className="swatch backfilled-key" /> Written up later</span>
          </div>

          {coverage.unaccounted > 0 && (
            <p className="tiny faint">
              Tap a blank day to fill it in. Anything you add will be dated to that day, but marked
              as written today — the export never presents a backfilled entry as though you wrote it
              at the time.
            </p>
          )}
        </div>

        {!sweep.enabled && (
          <div className="banner">
            <AlertIcon />
            <div>
              You have no daily check-in set. <Link to="/reminders">Set one up</Link> and Papertrail
              will ask you once a day whether anything happened.
            </div>
          </div>
        )}

        <Link className="btn block" to="/reminders">Reminders &amp; schedule</Link>
      </div>

      {capturing && (
        <QuickCaptureSheet
          onClose={() => setCapturing(null)}
          promptId={capturing.promptId}
          occurredAt={capturing.occurredAt}
          defaultTitle={capturing.title ?? ''}
        />
      )}

      {backfilling && (
        <BackfillSheet
          date={backfilling}
          onClose={() => setBackfilling(null)}
          onNothing={() => void nothingToReport(backfilling, null)}
          onRecord={() => {
            const date = backfilling
            setBackfilling(null)
            setCapturing({ promptId: null, occurredAt: noonOn(date) })
          }}
        />
      )}
    </>
  )
}

function PromptRow({
  prompt, busy, onCapture, onNothing, onDismiss,
}: {
  prompt: Prompt
  busy: boolean
  onCapture: () => void
  onNothing: () => void
  onDismiss: () => void
}) {
  const lateBy = prompt.noticedAt - prompt.dueAt
  const late = lateBy > 30 * 60_000

  return (
    <div className="prompt-row">
      <div className="grow">
        <div style={{ fontWeight: 540 }}>{prompt.label}</div>
        <div className="tiny faint">
          Due {formatDateTime(prompt.dueAt)} · for {prompt.forDate}
        </div>
        {late && (
          <div className="tiny" style={{ color: 'var(--warn)', marginTop: 2 }}>
            Picked up {relativeTime(prompt.dueAt)} — the reminder did not reach you on time.
          </div>
        )}
      </div>
      <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn sm primary" onClick={onCapture} disabled={busy}>Record</button>
        <button className="btn sm" onClick={onNothing} disabled={busy}>Nothing to report</button>
        <button className="btn sm ghost" onClick={onDismiss} disabled={busy}>Skip</button>
      </div>
    </div>
  )
}

function BackfillSheet({
  date, onClose, onNothing, onRecord,
}: {
  date: string
  onClose: () => void
  onNothing: () => void
  onRecord: () => void
}) {
  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Fill in ${date}`}>
        <h2 style={{ fontSize: 17, marginBottom: 6 }}>{formatDate(noonOn(date))}</h2>
        <p className="small muted" style={{ marginBottom: 14 }}>
          This day has no record. Anything you add now will be dated to it, and marked as written
          today — so the gap between the two stays visible rather than being papered over.
        </p>
        <div className="stack">
          <button className="btn primary block" onClick={onRecord}>
            <PlusIcon size={18} />
            Record what happened
          </button>
          <button className="btn block" onClick={onNothing}>Nothing happened that day</button>
          <button className="btn ghost block" onClick={onClose}>Leave it blank</button>
        </div>
      </div>
    </div>
  )
}
