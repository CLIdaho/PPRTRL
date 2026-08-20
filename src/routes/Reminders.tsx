import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db, getSetting, putSetting } from '../db/db'
import {
  createAnchor, deleteAnchor, getSweep, saveSweep, updateAnchor,
} from '../db/reminders'
import { record } from '../db/ledger'
import type { Anchor, ScheduleRule, SweepSettings } from '../db/types'
import { describeRule, nextOccurrence, WEEKDAY_NAMES, WEEKDAY_SHORT } from '../lib/schedule'
import { buildCalendar } from '../lib/ics'
import { download } from '../lib/zip'
import { newId } from '../lib/id'
import {
  backgroundStatus, enableBackgroundChecks, isAndroid, isInstalled, isSamsungInternet,
  notificationSupport, requestNotificationPermission, showNow, type BackgroundState,
  type PermissionState,
} from '../lib/notify'
import { Sheet } from '../components/Sheet'
import { Explain } from '../components/Explain'
import { InstallPrompt } from '../components/InstallPrompt'
import { AlertIcon, ExportIcon, PlusIcon, ShieldIcon, TrashIcon } from '../components/icons'
import { formatDateTime } from '../lib/format'

const DEVICE_KEY = 'deviceId'

/** A stable per-device id, so calendar UIDs survive across exports. */
async function deviceId(): Promise<string> {
  const existing = await getSetting<string | null>(DEVICE_KEY, null)
  if (existing) return existing
  const fresh = newId('dev').replace(/[^a-z0-9_]/gi, '')
  await putSetting(DEVICE_KEY, fresh)
  return fresh
}

export function Reminders() {
  const [editing, setEditing] = useState<Anchor | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Anchor | null>(null)
  const [permission, setPermission] = useState<PermissionState>(notificationSupport)
  const [background, setBackground] = useState<BackgroundState | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const anchors = useLiveQuery(async () => (await db.anchors.toArray()).sort(
    (a, b) => a.label.localeCompare(b.label)), [], undefined)
  const sweep = useLiveQuery(() => getSweep(), [], undefined)

  useEffect(() => {
    void backgroundStatus().then(setBackground)
  }, [])

  if (anchors === undefined || !sweep) return <p className="muted">Loading…</p>

  async function exportCalendar(current: SweepSettings) {
    const id = await deviceId()
    const list = await db.anchors.toArray()
    const ics = buildCalendar({ anchors: list, sweep: current, deviceId: id })
    download(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'papertrail-reminders.ics')
    await record('export.calendar', '-', 'Calendar file created', {
      anchors: list.filter((a) => a.enabled).length,
      sweepEnabled: current.enabled,
      sweepTime: current.time,
    })
    setMessage('Saved papertrail-reminders.ics. Open it and your phone will add the reminders to its calendar.')
  }

  return (
    <>
      <div className="page-head">
        <h1>Reminders</h1>
        <p className="sub">Recurring events, a daily check-in, and how they reach you.</p>
      </div>

      <div className="stack">
        <Explain question="Which of these actually wakes my phone?" defaultOpen>
          <p>
            <strong>The calendar file is the one that keeps time.</strong> Your phone's own calendar
            fires it, so it works with Papertrail closed, the screen off, and battery saving on.
            Set this up first.
          </p>
          <p>
            <strong>Notifications are a bonus.</strong> A web app cannot ask the phone to wake it at
            an exact time — the browser feature for that was proposed and never shipped. What is
            left lets the browser decide when to check, roughly twice a day at best, and Samsung's
            battery settings can stop it entirely. It often works. It cannot be relied on.
          </p>
          <p>
            <strong>Nothing is ever lost.</strong> Whatever happens with delivery, Papertrail works
            out every reminder you missed the next time you open it and puts them on the Check-in
            screen.
          </p>
        </Explain>

        {/* ------------------------------------------------ daily sweep */}
        <div className="card stack">
          <div className="section-label">Daily check-in</div>
          <p className="small muted">
            Once a day, Papertrail asks whether anything happened. You answer either way — an entry,
            or an explicit “nothing to report”. Both are real records.
          </p>

          <label className="row between switch-row">
            <span>Ask me every day</span>
            <input
              type="checkbox"
              checked={sweep.enabled}
              onChange={(e) => void saveSweep({ enabled: e.target.checked })}
            />
          </label>

          {sweep.enabled && (
            <>
              <div className="field">
                <label htmlFor="sweep-time">What time?</label>
                <input
                  id="sweep-time"
                  className="input"
                  type="time"
                  value={sweep.time}
                  onChange={(e) => void saveSweep({ time: e.target.value })}
                />
                <span className="hint">
                  Pick a time you are usually free and holding your phone — the end of the day works
                  well.
                </span>
              </div>

              <div className="field">
                <label>On which days?</label>
                <div className="row wrap" style={{ gap: 6 }}>
                  {WEEKDAY_SHORT.map((short, i) => (
                    <button
                      key={i}
                      type="button"
                      className="chip filter-chip"
                      aria-pressed={sweep.weekdays.includes(i)}
                      aria-label={WEEKDAY_NAMES[i]}
                      onClick={() => {
                        const next = sweep.weekdays.includes(i)
                          ? sweep.weekdays.filter((d) => d !== i)
                          : [...sweep.weekdays, i].sort((a, b) => a - b)
                        void saveSweep({ weekdays: next })
                      }}
                    >
                      {short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label htmlFor="lookback">How far back should the coverage view go?</label>
                <select
                  id="lookback"
                  className="select"
                  value={sweep.lookbackDays}
                  onChange={(e) => void saveSweep({ lookbackDays: Number(e.target.value) })}
                >
                  {[14, 30, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}
                </select>
              </div>
            </>
          )}
        </div>

        {/* ------------------------------------------------ anchors */}
        <div className="card stack">
          <div className="row between">
            <div className="section-label" style={{ margin: 0 }}>Scheduled events</div>
            <button className="btn sm primary" onClick={() => setEditing('new')}>
              <PlusIcon size={16} />
              Add
            </button>
          </div>
          <p className="small muted">
            Things that happen on a schedule — a weekly handoff, a monthly inspection, a court date.
            Papertrail prompts you around each one so it gets written down.
          </p>

          {anchors.length === 0 ? (
            <div className="empty" style={{ padding: '20px 8px' }}>
              <p className="small muted">No scheduled events yet.</p>
            </div>
          ) : (
            anchors.map((anchor) => {
              const next = anchor.enabled ? nextOccurrence(anchor.rule, Date.now()) : null
              return (
                <div className={`anchor-row${anchor.enabled ? '' : ' off'}`} key={anchor.id}>
                  <div className="grow">
                    <div style={{ fontWeight: 540 }}>{anchor.label}</div>
                    <div className="tiny faint">{describeRule(anchor.rule)}</div>
                    {anchor.promptAfterMinutes > 0 && (
                      <div className="tiny faint">
                        Prompts {anchor.promptAfterMinutes} minutes after
                      </div>
                    )}
                    {next && <div className="tiny" style={{ color: 'var(--accent)' }}>Next: {formatDateTime(next)}</div>}
                    {!anchor.enabled && <div className="tiny faint">Paused</div>}
                  </div>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn sm"
                      onClick={() => void updateAnchor(anchor.id, { enabled: !anchor.enabled })}
                    >
                      {anchor.enabled ? 'Pause' : 'Resume'}
                    </button>
                    <button className="btn sm" onClick={() => setEditing(anchor)}>Edit</button>
                    <button
                      className="icon-btn"
                      aria-label={`Delete ${anchor.label}`}
                      onClick={() => setConfirmDelete(anchor)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* ------------------------------------------------ delivery */}
        <div className="card stack">
          <div className="section-label">1. Add these to your calendar — do this one</div>
          <p className="small muted">
            Generates a file holding every reminder above. Open it and your phone adds them to its
            own calendar, which will alert you on time regardless of what the browser is doing.
            Do this again whenever you change a schedule.
          </p>
          <button className="btn primary block" onClick={() => void exportCalendar(sweep)}>
            <ExportIcon />
            Download calendar file
          </button>
        </div>

        <div className="card stack">
          <div className="section-label">2. Allow notifications — helpful, not dependable</div>
          <p className="small muted">
            Lets Papertrail put a reminder on your lock screen when the browser gives it a chance to
            run. Worth turning on; not worth relying on.
          </p>

          {permission === 'granted' ? (
            <>
              <div className="banner ok">
                <ShieldIcon />
                <div>Notifications are allowed on this device.</div>
              </div>
              <button
                className="btn block"
                onClick={() =>
                  void showNow('Papertrail test', 'If you can see this, notifications work on this device.')
                    .then((ok) => setMessage(ok ? 'Test notification sent.' : 'The browser refused to show it.'))
                }
              >
                Send a test notification
              </button>
            </>
          ) : permission === 'denied' ? (
            <div className="banner bad">
              <AlertIcon />
              <div>
                Notifications are blocked for this site. Undoing that needs your browser's own
                settings — find Papertrail under site permissions. The calendar file above works
                either way.
              </div>
            </div>
          ) : permission === 'unsupported' ? (
            <div className="banner">
              <AlertIcon />
              <div>This browser does not support notifications. Use the calendar file.</div>
            </div>
          ) : (
            <button
              className="btn block"
              onClick={() =>
                void requestNotificationPermission().then((p) => {
                  setPermission(p)
                  if (p === 'granted') void enableBackgroundChecks().then(setBackground)
                })
              }
            >
              Allow notifications
            </button>
          )}

          {permission === 'granted' && (
            <>
              <div className="divider" />
              <div className="section-label">Background checking</div>
              <p className="tiny faint" style={{ marginTop: -4 }}>
                {background?.registered
                  ? 'Registered. The browser decides when this runs — often around twice a day, sometimes not at all.'
                  : (background?.reason ?? 'Not registered.')}
              </p>
              {!background?.registered && background?.supported && (
                <button
                  className="btn block"
                  onClick={() => void enableBackgroundChecks().then(setBackground)}
                >
                  Turn on background checking
                </button>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------ samsung */}
        {(isAndroid() || isSamsungInternet()) && (
          <div className="card stack">
            <div className="section-label">3. Stop Android putting Papertrail to sleep</div>
            <p className="small muted">
              Samsung phones aggressively suspend apps they think you have stopped using, which
              stops notifications reaching you. Two settings to change, once:
            </p>
            <ol className="plain-list numbered">
              <li>
                <strong>Settings → Battery → Background usage limits</strong> — make sure Papertrail
                (or your browser, if you have not installed Papertrail to the home screen) is{' '}
                <strong>not</strong> in “Sleeping apps” or “Deep sleeping apps”.
              </li>
              <li>
                <strong>Settings → Apps → Papertrail → Battery</strong> — set it to{' '}
                <strong>Unrestricted</strong>.
              </li>
              <li>
                <strong>Settings → Battery → More battery settings</strong> — turn off{' '}
                <strong>Put unused apps to sleep</strong>, or add Papertrail to the exceptions.
              </li>
            </ol>
            <p className="tiny faint">
              Even with all three, Android may still delay a background check. The calendar file is
              not subject to any of this — which is why it is step 1 and this is step 3.
            </p>
            <label className="row between switch-row">
              <span className="small">I have done this</span>
              <input
                type="checkbox"
                checked={sweep.batterySetupSeen}
                onChange={(e) => void saveSweep({ batterySetupSeen: e.target.checked })}
              />
            </label>
          </div>
        )}

        {!isInstalled() && (
          <div className="card stack">
            <div className="section-label">Install Papertrail</div>
            <p className="small muted">
              Notifications and background checks only work at all once the app is installed to your
              home screen. In a browser tab, neither is available.
            </p>
            <InstallPrompt />
          </div>
        )}

        {message && <div className="banner ok"><ShieldIcon />{message}</div>}
      </div>

      {editing && (
        <AnchorEditor
          anchor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <Sheet
          title={`Delete “${confirmDelete.label}”?`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Keep it</button>
              <button
                className="btn danger"
                onClick={() => {
                  void deleteAnchor(confirmDelete.id)
                  setConfirmDelete(null)
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="small muted">
            The schedule is removed and its unanswered reminders go with it. Entries you already
            wrote from it are untouched, and History keeps a line saying this existed. Export a new
            calendar file afterwards so your phone stops alerting for it.
          </p>
        </Sheet>
      )}
    </>
  )
}

/** Add or edit one scheduled event. */
function AnchorEditor({ anchor, onClose }: { anchor: Anchor | null; onClose: () => void }) {
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const existing = anchor?.rule
  const [label, setLabel] = useState(anchor?.label ?? '')
  const [note, setNote] = useState(anchor?.note ?? '')
  const [freq, setFreq] = useState<ScheduleRule['freq']>(existing?.freq ?? 'weekly')
  const [interval, setInterval] = useState(existing && existing.freq !== 'once' ? existing.interval : 1)
  const [time, setTime] = useState(existing && existing.freq !== 'once' ? existing.time : '17:00')
  const [startDate, setStartDate] = useState(
    existing && existing.freq !== 'once' ? existing.startDate : iso)
  const [endDate, setEndDate] = useState(
    existing && existing.freq !== 'once' ? (existing.endDate ?? '') : '')
  const [onceAt, setOnceAt] = useState(
    existing?.freq === 'once' ? existing.at : `${iso}T09:00`)
  const [weekdays, setWeekdays] = useState<number[]>(
    existing && existing.freq === 'weekly' ? (existing.byWeekday ?? []) : [today.getDay()])
  const [monthDays, setMonthDays] = useState<number[]>(
    existing && existing.freq === 'monthly' ? (existing.byMonthDay ?? []) : [today.getDate()])
  const [promptAfter, setPromptAfter] = useState(anchor?.promptAfterMinutes ?? 0)
  const [busy, setBusy] = useState(false)

  const rule: ScheduleRule = freq === 'once'
    ? { freq: 'once', at: onceAt }
    : {
        freq,
        interval: Math.max(1, interval),
        time,
        startDate,
        endDate: endDate || null,
        ...(freq === 'weekly' ? { byWeekday: weekdays } : {}),
        ...(freq === 'monthly' ? { byMonthDay: monthDays } : {}),
      }

  const next = nextOccurrence(rule, Date.now())

  async function save() {
    setBusy(true)
    try {
      if (anchor) {
        await updateAnchor(anchor.id, { label, note, rule, promptAfterMinutes: promptAfter })
      } else {
        await createAnchor({ label, note, rule, promptAfterMinutes: promptAfter })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={anchor ? 'Edit scheduled event' : 'New scheduled event'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={() => void save()} disabled={busy || !label.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="a-label">What is it?</label>
          <input
            id="a-label"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Weekly handoff, Rent due, Supervision call"
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="a-note">What should you write about? (optional)</label>
          <input
            id="a-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Shown with the reminder"
          />
        </div>

        <div className="field">
          <label htmlFor="a-freq">How often?</label>
          <select
            id="a-freq"
            className="select"
            value={freq}
            onChange={(e) => setFreq(e.target.value as ScheduleRule['freq'])}
          >
            <option value="once">Once, on a date</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
            <option value="monthly">Every month</option>
          </select>
        </div>

        {freq === 'once' ? (
          <div className="field">
            <label htmlFor="a-once">When?</label>
            <input
              id="a-once"
              className="input"
              type="datetime-local"
              value={onceAt}
              onChange={(e) => setOnceAt(e.target.value)}
            />
          </div>
        ) : (
          <>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="a-time">At what time?</label>
                <input
                  id="a-time"
                  className="input"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="a-interval">Every</label>
                <select
                  id="a-interval"
                  className="select"
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 6, 12].map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? `${freq === 'daily' ? 'day' : freq === 'weekly' ? 'week' : 'month'}`
                        : `${n} ${freq === 'daily' ? 'days' : freq === 'weekly' ? 'weeks' : 'months'}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {freq === 'weekly' && (
              <div className="field">
                <label>On which days?</label>
                <div className="row wrap" style={{ gap: 6 }}>
                  {WEEKDAY_SHORT.map((short, i) => (
                    <button
                      key={i}
                      type="button"
                      className="chip filter-chip"
                      aria-pressed={weekdays.includes(i)}
                      aria-label={WEEKDAY_NAMES[i]}
                      onClick={() =>
                        setWeekdays(weekdays.includes(i)
                          ? weekdays.filter((d) => d !== i)
                          : [...weekdays, i].sort((a, b) => a - b))
                      }
                    >
                      {short}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {freq === 'monthly' && (
              <div className="field">
                <label>On which dates?</label>
                <div className="row wrap month-days">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="chip filter-chip"
                      aria-pressed={monthDays.includes(d)}
                      onClick={() =>
                        setMonthDays(monthDays.includes(d)
                          ? monthDays.filter((x) => x !== d)
                          : [...monthDays, d].sort((a, b) => a - b))
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
                {monthDays.some((d) => d > 28) && (
                  <span className="hint">
                    Dates after the 28th are skipped in months that are too short — the reminder
                    does not slide to the last day instead.
                  </span>
                )}
              </div>
            )}

            <div className="grid-2">
              <div className="field">
                <label htmlFor="a-start">Starting</label>
                <input
                  id="a-start"
                  className="input"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="a-end">Until (optional)</label>
                <input
                  id="a-end"
                  className="input"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="a-after">Ask me about it…</label>
          <select
            id="a-after"
            className="select"
            value={promptAfter}
            onChange={(e) => setPromptAfter(Number(e.target.value))}
          >
            <option value={0}>At the time</option>
            <option value={30}>30 minutes after</option>
            <option value={60}>1 hour after</option>
            <option value={120}>2 hours after</option>
            <option value={240}>4 hours after</option>
            <option value={720}>12 hours after</option>
            <option value={1440}>The next day</option>
          </select>
          <span className="hint">
            Prompting a little afterwards usually works better — there is something to say by then.
          </span>
        </div>

        <div className="banner">
          <ShieldIcon />
          <div>
            <strong>{describeRule(rule)}</strong>
            <br />
            {next
              ? `Next: ${formatDateTime(promptAfter ? next + promptAfter * 60_000 : next)}`
              : 'This schedule has no upcoming dates.'}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
