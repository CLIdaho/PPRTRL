import type { ScheduleRule } from '../db/types'

/**
 * Recurrence, evaluated in local wall-clock time.
 *
 * The one rule that governs everything here: an occurrence is a *calendar*
 * description ("the 3rd Tuesday at 17:00"), never a fixed number of
 * milliseconds. Adding 86_400_000 to a timestamp to get "tomorrow" is wrong
 * twice a year in any zone that observes daylight saving — the reminder silently
 * shifts an hour and, at the boundary, lands on the wrong day. So every step
 * here moves calendar fields and lets `Date` resolve the offset.
 */

export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

/** `YYYY-MM-DD` for a timestamp, in local time. */
export function localDateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Parses `HH:MM`, tolerating malformed input rather than throwing at render time. */
export function parseTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) return { hour: 9, minute: 0 }
  return {
    hour: Math.min(23, Math.max(0, Number(m[1]))),
    minute: Math.min(59, Math.max(0, Number(m[2]))),
  }
}

/** Parses `YYYY-MM-DD` into local calendar parts. */
function parseDate(date: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) }
}

/**
 * A local timestamp from calendar parts.
 *
 * `new Date(y, m, d, h, min)` resolves the UTC offset for that wall-clock
 * moment, which is what makes the schedule survive a daylight-saving change.
 * Where a time does not exist (the hour skipped on spring-forward) the platform
 * rolls forward, which is the behaviour a reminder wants.
 */
export function localTime(y: number, m: number, d: number, hour: number, minute: number): number {
  return new Date(y, m, d, hour, minute, 0, 0).getTime()
}

/** Midnight local on the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return localTime(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0)
}

/**
 * Noon local on a `YYYY-MM-DD`.
 *
 * Nothing-to-report entries and coverage buckets anchor here rather than at
 * midnight: midnight sits exactly on the boundary a daylight-saving shift moves,
 * and an entry that slips an hour there lands on the previous day. Noon has
 * twelve hours of slack in both directions.
 */
export function noonOn(date: string): number {
  const p = parseDate(date)
  if (!p) return startOfDay(Date.now()) + 12 * HOUR
  return localTime(p.y, p.m, p.d, 12, 0)
}

/** Adds days by calendar, so a DST boundary shifts the offset rather than the date. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms)
  return localTime(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes())
}

/** Days between two moments, counted as calendar days rather than elapsed time. */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((startOfDay(toMs) - startOfDay(fromMs)) / DAY)
}

/**
 * Every occurrence of `rule` in `[from, to]`, inclusive at both ends, ascending.
 *
 * Walks the calendar rather than projecting from an epoch, which keeps month
 * lengths and DST correct without any special-casing. The window is what bounds
 * the work, so an open-ended weekly rule costs the same as a one-off.
 */
export function occurrencesBetween(rule: ScheduleRule, from: number, to: number): number[] {
  if (to < from) return []

  if (rule.freq === 'once') {
    const at = parseLocalDateTime(rule.at)
    return at !== null && at >= from && at <= to ? [at] : []
  }

  const start = parseDate(rule.startDate)
  if (!start) return []
  const { hour, minute } = parseTime(rule.time)
  const interval = Math.max(1, Math.floor(rule.interval || 1))

  const endBound = rule.endDate ? endOfDayFor(rule.endDate) : Infinity
  const hardTo = Math.min(to, endBound)
  if (hardTo < from) return []

  const startMs = localTime(start.y, start.m, start.d, hour, minute)
  const out: number[] = []

  if (rule.freq === 'daily') {
    // Jump straight to the first candidate at or after the window, then step.
    const behind = Math.max(0, daysBetween(startMs, from))
    const steps = Math.ceil(behind / interval)
    let cursor = addDays(startMs, steps * interval)
    while (cursor <= hardTo) {
      if (cursor >= from && cursor >= startMs) out.push(cursor)
      cursor = addDays(cursor, interval)
    }
    return out
  }

  if (rule.freq === 'weekly') {
    // An empty byWeekday means "the day the rule started on".
    const days = normaliseWeekdays(rule.byWeekday, new Date(startMs).getDay())
    // Weeks are counted from the week containing startDate, so `interval: 2`
    // means every other week relative to the start, not to the epoch.
    const weekOfStart = startOfWeek(startMs)
    const firstWeek = Math.max(0, Math.floor(daysBetween(weekOfStart, startOfWeek(from)) / 7))
    // Step back one interval so an occurrence earlier in the current week is not missed.
    let week = Math.max(0, Math.floor(firstWeek / interval) * interval - interval)

    for (;;) {
      const weekStart = addDays(weekOfStart, week * 7)
      if (weekStart > hardTo) break
      for (const wd of days) {
        const at = withTime(addDays(weekStart, wd), hour, minute)
        if (at >= from && at <= hardTo && at >= startMs) out.push(at)
      }
      week += interval
    }
    out.sort((a, b) => a - b)
    return out
  }

  // monthly
  const dates = rule.byMonthDay?.length ? [...new Set(rule.byMonthDay)].sort((a, b) => a - b) : [start.d]
  const monthsBehind = monthsBetween(startMs, from)
  let month = Math.max(0, Math.floor(monthsBehind / interval) * interval - interval)

  for (;;) {
    const y = start.y
    const m = start.m + month
    const probe = localTime(y, m, 1, hour, minute)
    if (probe > hardTo) break
    const inMonth = daysInMonth(new Date(probe).getFullYear(), new Date(probe).getMonth())
    for (const dayOfMonth of dates) {
      // A rule for the 31st simply does not occur in a 30-day month. Clamping it
      // to the 30th would invent an occurrence the user never asked for.
      if (dayOfMonth < 1 || dayOfMonth > inMonth) continue
      const at = localTime(y, m, dayOfMonth, hour, minute)
      if (at >= from && at <= hardTo && at >= startMs) out.push(at)
    }
    month += interval
  }
  out.sort((a, b) => a - b)
  return out
}

/** The first occurrence strictly after `after`, or null if the rule is exhausted. */
export function nextOccurrence(rule: ScheduleRule, after: number): number | null {
  // Widen the search window until something turns up or the rule clearly ends.
  // Two years covers any interval a person will actually configure.
  for (const days of [1, 7, 40, 200, 800]) {
    const hits = occurrencesBetween(rule, after + 1, addDays(after, days))
    if (hits.length) return hits[0]
  }
  return null
}

/** The most recent occurrence at or before `at`, or null. */
export function lastOccurrence(rule: ScheduleRule, at: number): number | null {
  for (const days of [1, 7, 40, 200, 800]) {
    const hits = occurrencesBetween(rule, addDays(at, -days), at)
    if (hits.length) return hits[hits.length - 1]
  }
  return null
}

/** A one-line description of a rule, for the management screen. */
export function describeRule(rule: ScheduleRule): string {
  if (rule.freq === 'once') {
    const at = parseLocalDateTime(rule.at)
    return at === null ? 'Once (date not set)' : `Once, on ${formatDay(at)} at ${formatClock(at)}`
  }

  const { hour, minute } = parseTime(rule.time)
  const clock = `${pad(hour)}:${pad(minute)}`
  const every = rule.interval > 1 ? `every ${rule.interval} ` : 'every '

  let base: string
  if (rule.freq === 'daily') {
    base = rule.interval > 1 ? `${every}days` : 'Every day'
  } else if (rule.freq === 'weekly') {
    const start = parseDate(rule.startDate)
    const fallback = start ? new Date(localTime(start.y, start.m, start.d, 12, 0)).getDay() : 1
    const days = normaliseWeekdays(rule.byWeekday, fallback).map((d) => WEEKDAY_NAMES[d])
    base = `${rule.interval > 1 ? `${every}weeks on ` : 'Every '}${listSentence(days)}`
  } else {
    const dates = rule.byMonthDay?.length ? rule.byMonthDay : [parseDate(rule.startDate)?.d ?? 1]
    base = `${rule.interval > 1 ? `${every}months on the ` : 'Monthly on the '}${listSentence(dates.map(ordinal))}`
  }

  const ends = rule.endDate ? `, until ${rule.endDate}` : ''
  return `${base} at ${clock}${ends}`
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function listSentence(items: string[]): string {
  if (items.length === 0) return '—'
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const formatDay = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(ms)
const formatClock = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ms)

/** Parses `YYYY-MM-DDTHH:MM` as local wall clock. */
export function parseLocalDateTime(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  return localTime(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
}

function endOfDayFor(date: string): number {
  const p = parseDate(date)
  if (!p) return Infinity
  return localTime(p.y, p.m, p.d, 23, 59) + 59_999
}

function withTime(ms: number, hour: number, minute: number): number {
  const d = new Date(ms)
  return localTime(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute)
}

/** Sunday-anchored start of the week containing `ms`. */
function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms))
  return addDays(d.getTime(), -d.getDay())
}

function normaliseWeekdays(list: number[] | undefined, fallback: number): number[] {
  const days = (list ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  return days.length ? [...new Set(days)].sort((a, b) => a - b) : [fallback]
}

function monthsBetween(fromMs: number, toMs: number): number {
  const a = new Date(fromMs)
  const b = new Date(toMs)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}
