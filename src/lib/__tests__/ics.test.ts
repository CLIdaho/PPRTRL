import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCalendar, foldLine, escapeText, toRRule, icsLocal, icsUtc } from '../ics.ts'
import type { Anchor, ScheduleRule, SweepSettings } from '../../db/types.ts'

const NOW = new Date(2026, 7, 20, 15, 0, 0).getTime()

const sweep = (over: Partial<SweepSettings> = {}): SweepSettings => ({
  enabled: false, time: '21:00', weekdays: [0, 1, 2, 3, 4, 5, 6], lookbackDays: 30,
  batterySetupSeen: false, lastSeenAt: 0, lastSweptAt: 0, ...over,
})

const anchor = (over: Partial<Anchor> = {}): Anchor => ({
  id: 'anchor_1', label: 'Weekly handoff', note: '',
  rule: { freq: 'weekly', interval: 1, byWeekday: [2], time: '17:00', startDate: '2026-08-04', endDate: null },
  promptAfterMinutes: 0, enabled: true, caseId: null, createdAt: NOW, updatedAt: NOW, ...over,
})

const lines = (ics: string) => ics.split('\r\n')

// ----------------------------------------------------------- structure

test('the calendar is well-formed and CRLF-terminated', () => {
  const ics = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'), 'the final line must be terminated too')
  assert.ok(ics.includes('VERSION:2.0'))
  assert.ok(ics.includes('PRODID:-//Papertrail//'))
  // Every line break is CRLF, never a bare LF.
  assert.equal(/(?<!\r)\n/.test(ics), false)
})

test('BEGIN and END tags are balanced', () => {
  const ics = buildCalendar({
    anchors: [anchor(), anchor({ id: 'a2', label: 'Call' })],
    sweep: sweep({ enabled: true }), deviceId: 'dev1', now: NOW,
  })
  const count = (tag: string) => lines(ics).filter((l) => l === tag).length

  assert.equal(count('BEGIN:VEVENT'), 3)
  assert.equal(count('END:VEVENT'), 3)
  assert.equal(count('BEGIN:VALARM'), 3)
  assert.equal(count('END:VALARM'), 3)
})

test('every event carries the properties a calendar needs to import it', () => {
  const ics = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })

  for (const prop of ['UID:', 'DTSTAMP:', 'DTSTART:', 'SUMMARY:', 'DURATION:']) {
    assert.ok(lines(ics).some((l) => l.startsWith(prop)), `missing ${prop}`)
  }
})

test('a disabled anchor produces no event', () => {
  const ics = buildCalendar({
    anchors: [anchor({ enabled: false })], sweep: sweep(), deviceId: 'dev1', now: NOW,
  })
  assert.equal(lines(ics).filter((l) => l === 'BEGIN:VEVENT').length, 0)
})

test('an empty calendar is still a valid file', () => {
  const ics = buildCalendar({ anchors: [], sweep: sweep(), deviceId: 'dev1', now: NOW })
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
})

// ----------------------------------------------------------- UIDs

test('UIDs are stable across exports, so re-importing updates rather than duplicates', () => {
  const first = buildCalendar({ anchors: [anchor()], sweep: sweep({ enabled: true }), deviceId: 'dev1', now: NOW })
  const later = buildCalendar({
    anchors: [anchor({ label: 'Renamed handoff' })],
    sweep: sweep({ enabled: true, time: '20:00' }),
    deviceId: 'dev1', now: NOW + 9 * 86_400_000,
  })

  const uids = (ics: string) => lines(ics).filter((l) => l.startsWith('UID:')).sort()
  assert.deepEqual(uids(first), uids(later), 'a schedule change must not mint new UIDs')
})

test('UIDs differ between devices so two phones do not collide', () => {
  const a = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })
  const b = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev2', now: NOW })

  assert.notDeepEqual(
    lines(a).filter((l) => l.startsWith('UID:')),
    lines(b).filter((l) => l.startsWith('UID:')),
  )
})

// ----------------------------------------------------------- RRULE

test('RRULE maps each frequency correctly', () => {
  assert.equal(
    toRRule({ freq: 'daily', interval: 1, time: '09:00', startDate: '2026-01-01', endDate: null }),
    'FREQ=DAILY',
  )
  assert.equal(
    toRRule({ freq: 'daily', interval: 3, time: '09:00', startDate: '2026-01-01', endDate: null }),
    'FREQ=DAILY;INTERVAL=3',
  )
  assert.equal(
    toRRule({ freq: 'weekly', interval: 1, byWeekday: [1, 3, 5], time: '09:00', startDate: '2026-01-01', endDate: null }),
    'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  )
  assert.equal(
    toRRule({ freq: 'weekly', interval: 2, byWeekday: [0, 6], time: '09:00', startDate: '2026-01-01', endDate: null }),
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA',
  )
  assert.equal(
    toRRule({ freq: 'monthly', interval: 1, byMonthDay: [15, 1], time: '09:00', startDate: '2026-01-01', endDate: null }),
    'FREQ=MONTHLY;BYMONTHDAY=1,15',
  )
})

test('a one-off has no RRULE', () => {
  assert.equal(toRRule({ freq: 'once', at: '2026-09-14T17:30' }), null)

  const ics = buildCalendar({
    anchors: [anchor({ rule: { freq: 'once', at: '2026-09-14T17:30' } })],
    sweep: sweep(), deviceId: 'dev1', now: NOW,
  })
  assert.equal(lines(ics).some((l) => l.startsWith('RRULE:')), false)
  assert.ok(ics.includes('DTSTART:20260914T173000'))
})

test('an end date becomes a floating UNTIL, matching the floating DTSTART', () => {
  const rrule = toRRule({
    freq: 'weekly', interval: 1, byWeekday: [2], time: '17:00',
    startDate: '2026-01-01', endDate: '2026-12-31',
  })
  assert.ok(rrule!.includes('UNTIL=20261231T235900'))
  assert.equal(rrule!.includes('Z'), false, 'a Z here would contradict the floating DTSTART')
})

// ----------------------------------------------------------- time

test('DTSTART is floating local time, with no Z and no TZID', () => {
  const ics = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })
  const dtstart = lines(ics).find((l) => l.startsWith('DTSTART'))!

  assert.equal(dtstart, 'DTSTART:20260804T170000')
  assert.equal(dtstart.includes('TZID'), false)
  assert.equal(dtstart.endsWith('Z'), false)
})

test('DTSTAMP is absolute UTC, as the spec requires', () => {
  const ics = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })
  const dtstamp = lines(ics).find((l) => l.startsWith('DTSTAMP:'))!

  assert.match(dtstamp, /^DTSTAMP:\d{8}T\d{6}Z$/)
})

test('promptAfterMinutes moves the event past the thing it asks about', () => {
  const ics = buildCalendar({
    anchors: [anchor({ promptAfterMinutes: 120 })], sweep: sweep(), deviceId: 'dev1', now: NOW,
  })
  assert.ok(ics.includes('DTSTART:20260804T190000'), 'a 17:00 event + 2h should start 19:00')
  assert.ok(ics.includes('SUMMARY:Log: Weekly handoff'))
})

test('icsLocal and icsUtc format to the right shapes', () => {
  assert.match(icsLocal(NOW), /^\d{8}T\d{6}$/)
  assert.match(icsUtc(NOW), /^\d{8}T\d{6}Z$/)
})

// ----------------------------------------------------------- sweep

test('an every-day sweep uses FREQ=DAILY at the configured time', () => {
  const ics = buildCalendar({
    anchors: [], sweep: sweep({ enabled: true, time: '21:30' }), deviceId: 'dev1', now: NOW,
  })
  assert.ok(ics.includes('RRULE:FREQ=DAILY'))
  assert.ok(ics.includes('DTSTART:20260820T213000'))
  assert.ok(ics.includes('SUMMARY:Papertrail check-in'))
})

test('a weekday-only sweep uses BYDAY', () => {
  const ics = buildCalendar({
    anchors: [], sweep: sweep({ enabled: true, weekdays: [1, 2, 3, 4, 5] }), deviceId: 'dev1', now: NOW,
  })
  assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'))
})

test('a disabled sweep produces no check-in event', () => {
  const ics = buildCalendar({ anchors: [], sweep: sweep({ enabled: false }), deviceId: 'dev1', now: NOW })
  assert.equal(ics.includes('Papertrail check-in'), false)
})

// ----------------------------------------------------------- escaping and folding

test('reserved characters are escaped in text values', () => {
  assert.equal(escapeText('a,b'), 'a\\,b')
  assert.equal(escapeText('a;b'), 'a\;b')
  assert.equal(escapeText('a\\b'), 'a\\\\b')
  assert.equal(escapeText('line1\nline2'), 'line1\\nline2')
  assert.equal(escapeText('line1\r\nline2'), 'line1\\nline2')
})

test('a label full of reserved characters survives into the file intact', () => {
  const ics = buildCalendar({
    anchors: [anchor({ label: 'Handoff; with, commas\\and a\nnewline' })],
    sweep: sweep(), deviceId: 'dev1', now: NOW,
  })
  assert.ok(ics.includes('SUMMARY:Handoff\; with\\, commas\\\\and a\\nnewline'))
  // The escaped newline must not have become a real line break.
  assert.equal(lines(ics).some((l) => l === 'newline'), false)
})

test('long lines fold at 75 octets with a leading space on continuations', () => {
  const long = 'X'.repeat(200)
  const folded = foldLine(long)
  const parts = folded.split('\r\n')

  assert.ok(parts.length > 1, 'should have folded')
  assert.ok(new TextEncoder().encode(parts[0]).length <= 75)
  for (const part of parts.slice(1)) {
    assert.ok(part.startsWith(' '), 'continuation lines must start with a space')
    assert.ok(new TextEncoder().encode(part).length <= 75)
  }
  // Unfolding — strip the leading space each continuation added — must
  // reproduce the original exactly.
  const unfolded = parts[0] + parts.slice(1).map((p) => p.slice(1)).join('')
  assert.equal(unfolded, long)
})

test('a short line is left alone', () => {
  assert.equal(foldLine('SUMMARY:Short'), 'SUMMARY:Short')
})

test('folding never splits a multi-byte character', () => {
  // Emoji are 4 UTF-8 octets each; 30 of them overrun the 75-octet limit.
  const line = `SUMMARY:${'\u{1F5C2}'.repeat(30)}`
  const folded = foldLine(line)

  assert.equal(folded.includes('�'), false, 'no replacement characters')
  const rebuilt = folded.split('\r\n ').join('')
  assert.equal(rebuilt, line, 'unfolding must reproduce the original')
})

test('non-ASCII labels fold by octet, not by character count', () => {
  const ics = buildCalendar({
    anchors: [anchor({ label: 'Übergabe mit sehr langem Namen ' + 'ä'.repeat(60) })],
    sweep: sweep(), deviceId: 'dev1', now: NOW,
  })
  for (const line of lines(ics)) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line over 75 octets: ${line.slice(0, 40)}`)
  }
})

// ----------------------------------------------------------- alarms

test('the alarm fires at the event itself', () => {
  const ics = buildCalendar({ anchors: [anchor()], sweep: sweep(), deviceId: 'dev1', now: NOW })
  assert.ok(ics.includes('TRIGGER:PT0S'))
  assert.ok(ics.includes('ACTION:DISPLAY'))
})
