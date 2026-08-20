import type { Anchor, ScheduleRule, SweepSettings } from '../db/types'
import { parseTime, parseLocalDateTime, WEEKDAY_NAMES } from './schedule'

/**
 * An RFC 5545 calendar file, written by hand for the same reason `zip.ts` is:
 * it carries a load-bearing promise (that a reminder actually fires) and should
 * not depend on a library to keep it.
 *
 * Times are written as *floating* local time — no TZID, no VTIMEZONE. A 21:00
 * check-in should be at 21:00 wherever the phone is, which is exactly what
 * floating time means. The alternative, a UTC instant or a TZID referencing a
 * VTIMEZONE block, would require shipping and maintaining a timezone database
 * to say something the user did not ask for.
 */

const CRLF = '\r\n'
const ICAL_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Escapes the four characters RFC 5545 reserves inside a text value. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Folds a content line to 75 octets, per RFC 5545 §3.1.
 *
 * The limit counts octets, not characters, so a line is measured after UTF-8
 * encoding — splitting on character count would overrun the limit on any
 * non-ASCII label, and splitting mid-sequence would corrupt it. Neither is
 * hypothetical: people name things in their own language.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line

  const out: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    // Never split inside a UTF-8 sequence: back up off any continuation byte.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--
    out.push(new TextDecoder().decode(bytes.subarray(start, end)))
    start = end
    // Continuation lines carry a leading space, which counts toward the 75.
    limit = 74
  }
  return out.join(`${CRLF} `)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Floating local timestamp: `YYYYMMDDTHHMMSS`, with no trailing Z. */
export function icsLocal(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

/** UTC timestamp: `YYYYMMDDTHHMMSSZ`. Used for DTSTAMP, which must be absolute. */
export function icsUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Translates a stored rule into an RRULE, or null for a one-off. */
export function toRRule(rule: ScheduleRule): string | null {
  if (rule.freq === 'once') return null

  const parts: string[] = [`FREQ=${rule.freq.toUpperCase()}`]
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  if (interval > 1) parts.push(`INTERVAL=${interval}`)

  if (rule.freq === 'weekly' && rule.byWeekday?.length) {
    const days = [...new Set(rule.byWeekday)].sort((a, b) => a - b).map((d) => ICAL_WEEKDAYS[d])
    parts.push(`BYDAY=${days.join(',')}`)
  }
  if (rule.freq === 'monthly' && rule.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${[...new Set(rule.byMonthDay)].sort((a, b) => a - b).join(',')}`)
  }
  if (rule.endDate) {
    // UNTIL on a floating DTSTART must itself be floating, per RFC 5545 §3.3.10.
    parts.push(`UNTIL=${rule.endDate.replace(/-/g, '')}T235900`)
  }
  return parts.join(';')
}

/** The first moment a rule describes, used as DTSTART. */
function ruleStart(rule: ScheduleRule): number | null {
  if (rule.freq === 'once') return parseLocalDateTime(rule.at)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rule.startDate.trim())
  if (!m) return null
  const { hour, minute } = parseTime(rule.time)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, 0).getTime()
}

export interface IcsEvent {
  uid: string
  summary: string
  description: string
  start: number
  rrule: string | null
  /** Minutes before the event to alarm. 0 alarms at the event itself. */
  alarmMinutesBefore: number
  durationMinutes: number
}

function renderEvent(event: IcsEvent, stamp: number): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART:${icsLocal(event.start)}`,
    `DURATION:PT${Math.max(1, Math.round(event.durationMinutes))}M`,
    `SUMMARY:${escapeText(event.summary)}`,
  ]
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
  if (event.rrule) lines.push(`RRULE:${event.rrule}`)

  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:${event.alarmMinutesBefore > 0 ? `-PT${event.alarmMinutesBefore}M` : 'PT0S'}`,
    `DESCRIPTION:${escapeText(event.summary)}`,
    'END:VALARM',
    'END:VEVENT',
  )
  return lines
}

export interface CalendarInput {
  anchors: Anchor[]
  sweep: SweepSettings
  /** Stable per-device, so re-importing updates events rather than duplicating them. */
  deviceId: string
  now?: number
}

/**
 * Builds the whole calendar: every enabled anchor plus the daily check-in.
 *
 * UIDs are derived from the anchor id and a fixed device suffix, never from the
 * export time. That is what makes a re-import after a schedule change *replace*
 * the old event instead of stacking a second copy beside it — the failure mode
 * that makes calendar exports useless in practice.
 */
export function buildCalendar(input: CalendarInput): string {
  const now = input.now ?? Date.now()
  const events: IcsEvent[] = []

  for (const anchor of input.anchors) {
    if (!anchor.enabled) continue
    const start = ruleStart(anchor.rule)
    if (start === null) continue

    // "Prompt after" moves the reminder past the event, so the calendar entry is
    // placed at the prompt time and the alarm fires on it.
    const offsetMs = anchor.promptAfterMinutes * 60_000
    events.push({
      uid: `${anchor.id}@papertrail.${input.deviceId}`,
      summary: anchor.promptAfterMinutes > 0 ? `Log: ${anchor.label}` : anchor.label,
      description: [
        anchor.note,
        anchor.promptAfterMinutes > 0
          ? `Papertrail reminder, ${anchor.promptAfterMinutes} minutes after "${anchor.label}".`
          : 'Papertrail reminder.',
        'Open Papertrail to record what happened.',
      ].filter(Boolean).join('\n'),
      start: start + offsetMs,
      rrule: toRRule(anchor.rule),
      alarmMinutesBefore: 0,
      durationMinutes: 15,
    })
  }

  if (input.sweep.enabled) {
    const { hour, minute } = parseTime(input.sweep.time)
    const d = new Date(now)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute, 0, 0).getTime()
    const days = (input.sweep.weekdays.length ? input.sweep.weekdays : [0, 1, 2, 3, 4, 5, 6])
    const everyDay = days.length === 7

    events.push({
      uid: `sweep@papertrail.${input.deviceId}`,
      summary: 'Papertrail check-in',
      description:
        'Did anything happen today worth recording?\n' +
        'Open Papertrail to add an entry, or mark the day as nothing to report.\n' +
        'A day nobody confirms is a gap in the record; a day confirmed quiet is not.',
      start,
      rrule: everyDay
        ? 'FREQ=DAILY'
        : `FREQ=WEEKLY;BYDAY=${[...days].sort((a, b) => a - b).map((i) => ICAL_WEEKDAYS[i]).join(',')}`,
      alarmMinutesBefore: 0,
      durationMinutes: 10,
    })
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Papertrail//Local-first evidence log//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Papertrail reminders',
    ...events.flatMap((e) => renderEvent(e, now)),
    'END:VCALENDAR',
  ]

  // A trailing CRLF is required: the last line must be terminated like any other.
  return lines.map(foldLine).join(CRLF) + CRLF
}

/** Human-readable weekday list for the setup screen. */
export function describeWeekdays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'every day'
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d])
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
