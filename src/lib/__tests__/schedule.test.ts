import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  occurrencesBetween, nextOccurrence, lastOccurrence, describeRule,
  localDateKey, localTime, addDays, daysBetween, noonOn, parseTime, ordinal,
} from '../schedule.ts'
import type { ScheduleRule } from '../../db/types.ts'

/**
 * These run under whatever zone the machine has. TZ is pinned to a
 * DST-observing zone by the test script so the daylight-saving cases are real;
 * the assertions are written in terms of local wall clock either way.
 */

const at = (y: number, m: number, d: number, h = 0, min = 0) => localTime(y, m - 1, d, h, min)
const clock = (ms: number) => {
  const dt = new Date(ms)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}
const clocks = (list: number[]) => list.map(clock)

// ----------------------------------------------------------- one-off

test('a one-off fires exactly once, inside its window', () => {
  const rule: ScheduleRule = { freq: 'once', at: '2026-09-14T17:30' }

  assert.deepEqual(
    clocks(occurrencesBetween(rule, at(2026, 9, 1), at(2026, 9, 30))),
    ['2026-09-14 17:30'],
  )
  assert.deepEqual(occurrencesBetween(rule, at(2026, 9, 15), at(2026, 9, 30)), [])
  assert.deepEqual(occurrencesBetween(rule, at(2026, 1, 1), at(2026, 9, 13)), [])
})

test('a malformed one-off yields nothing rather than throwing', () => {
  const rule: ScheduleRule = { freq: 'once', at: 'not a date' }
  assert.deepEqual(occurrencesBetween(rule, 0, at(2030, 1, 1)), [])
})

// ----------------------------------------------------------- daily

test('daily fires once a day at the configured time', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '21:00',
    startDate: '2026-03-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 3, 1), at(2026, 3, 5, 23, 59))

  assert.deepEqual(clocks(hits), [
    '2026-03-01 21:00', '2026-03-02 21:00', '2026-03-03 21:00',
    '2026-03-04 21:00', '2026-03-05 21:00',
  ])
})

test('daily with interval 3 skips correctly and stays anchored to the start date', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 3, time: '08:00',
    startDate: '2026-01-01', endDate: null,
  }
  // Ask for a window that starts mid-cycle: the phase must come from startDate.
  const hits = occurrencesBetween(rule, at(2026, 1, 5), at(2026, 1, 14, 23, 59))

  assert.deepEqual(clocks(hits), [
    '2026-01-07 08:00', '2026-01-10 08:00', '2026-01-13 08:00',
  ])
})

test('nothing fires before the start date', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00',
    startDate: '2026-06-10', endDate: null,
  }
  assert.deepEqual(occurrencesBetween(rule, at(2026, 6, 1), at(2026, 6, 9, 23, 59)), [])
})

test('endDate is inclusive of the whole final day', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '23:30',
    startDate: '2026-06-01', endDate: '2026-06-03',
  }
  const hits = occurrencesBetween(rule, at(2026, 6, 1), at(2026, 6, 30))

  assert.deepEqual(clocks(hits), [
    '2026-06-01 23:30', '2026-06-02 23:30', '2026-06-03 23:30',
  ])
})

// ----------------------------------------------------------- DST

test('a daily 09:00 reminder stays at 09:00 across spring forward', () => {
  // US DST begins 2026-03-08. A ms-based schedule drifts to 10:00 here.
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00',
    startDate: '2026-03-06', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 3, 6), at(2026, 3, 10, 23, 59))

  for (const h of hits) {
    assert.equal(new Date(h).getHours(), 9, `${clock(h)} drifted off 09:00`)
  }
  assert.equal(hits.length, 5, 'no day may be skipped or doubled across the boundary')
  assert.deepEqual(clocks(hits).map((s) => s.slice(0, 10)), [
    '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  ])
})

test('a daily 09:00 reminder stays at 09:00 across fall back', () => {
  // US DST ends 2026-11-01.
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00',
    startDate: '2026-10-30', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 10, 30), at(2026, 11, 3, 23, 59))

  for (const h of hits) assert.equal(new Date(h).getHours(), 9, `${clock(h)} drifted`)
  assert.equal(hits.length, 5)
})

test('a reminder set inside the skipped spring-forward hour still fires that day', () => {
  // 02:30 does not exist on 2026-03-08 in US zones; it must roll, not vanish.
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '02:30',
    startDate: '2026-03-07', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 3, 7), at(2026, 3, 9, 23, 59))

  assert.equal(hits.length, 3, 'the nonexistent hour must not swallow a day')
  assert.deepEqual(clocks(hits).map((s) => s.slice(0, 10)), ['2026-03-07', '2026-03-08', '2026-03-09'])
})

test('addDays crosses a DST boundary without shifting the clock', () => {
  const before = at(2026, 3, 7, 9, 0)
  const after = addDays(before, 1)
  assert.equal(new Date(after).getHours(), 9)
  assert.equal(new Date(after).getDate(), 8)
})

test('daysBetween counts calendar days across a DST boundary', () => {
  assert.equal(daysBetween(at(2026, 3, 7, 9, 0), at(2026, 3, 9, 9, 0)), 2)
  assert.equal(daysBetween(at(2026, 11, 1, 9, 0), at(2026, 11, 2, 9, 0)), 1)
  // A 23-hour day and a 25-hour day are both still one day.
  assert.equal(daysBetween(at(2026, 3, 8, 0, 30), at(2026, 3, 9, 0, 30)), 1)
})

// ----------------------------------------------------------- weekly

test('weekly on a single day fires on that weekday only', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, byWeekday: [2], time: '17:00',
    startDate: '2026-04-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 4, 1), at(2026, 4, 30))

  for (const h of hits) assert.equal(new Date(h).getDay(), 2, `${clock(h)} is not a Tuesday`)
  assert.deepEqual(clocks(hits), [
    '2026-04-07 17:00', '2026-04-14 17:00', '2026-04-21 17:00', '2026-04-28 17:00',
  ])
})

test('weekly on several days returns them in chronological order', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, byWeekday: [5, 1, 3], time: '12:00',
    startDate: '2026-05-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 5, 3), at(2026, 5, 16, 23, 59))

  assert.deepEqual(clocks(hits), [
    '2026-05-04 12:00', '2026-05-06 12:00', '2026-05-08 12:00',
    '2026-05-11 12:00', '2026-05-13 12:00', '2026-05-15 12:00',
  ])
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i] > hits[i - 1], 'must be ascending')
})

test('fortnightly is anchored to the start week, not to the epoch', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 2, byWeekday: [1], time: '10:00',
    startDate: '2026-06-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 6, 1), at(2026, 7, 15))

  assert.deepEqual(clocks(hits), [
    '2026-06-01 10:00', '2026-06-15 10:00', '2026-06-29 10:00', '2026-07-13 10:00',
  ])
})

test('a fortnightly window opening mid-cycle keeps the right phase', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 2, byWeekday: [1], time: '10:00',
    startDate: '2026-06-01', endDate: null,
  }
  // Opening the window inside an "off" week must not shift the phase.
  const hits = occurrencesBetween(rule, at(2026, 6, 20), at(2026, 7, 20))
  assert.deepEqual(clocks(hits), ['2026-06-29 10:00', '2026-07-13 10:00'])
})

test('weekly with no byWeekday uses the start date weekday', () => {
  // 2026-04-01 is a Wednesday.
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, time: '09:00',
    startDate: '2026-04-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 4, 1), at(2026, 4, 22, 23, 59))
  for (const h of hits) assert.equal(new Date(h).getDay(), 3)
  assert.equal(hits.length, 4)
})

test('weekly survives a DST boundary without dropping or doubling a week', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, byWeekday: [0], time: '20:00',
    startDate: '2026-02-15', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 2, 15), at(2026, 3, 29, 23, 59))

  for (const h of hits) {
    assert.equal(new Date(h).getHours(), 20, `${clock(h)} drifted`)
    assert.equal(new Date(h).getDay(), 0)
  }
  assert.equal(hits.length, 7)
})

// ----------------------------------------------------------- monthly

test('monthly fires on the configured date each month', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, byMonthDay: [15], time: '09:00',
    startDate: '2026-01-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 4, 30))

  assert.deepEqual(clocks(hits), [
    '2026-01-15 09:00', '2026-02-15 09:00', '2026-03-15 09:00', '2026-04-15 09:00',
  ])
})

test('monthly on the 31st simply does not occur in short months', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, byMonthDay: [31], time: '09:00',
    startDate: '2026-01-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 7, 31, 23, 59))

  // No clamping to the 28th/30th: that would invent an occurrence.
  assert.deepEqual(clocks(hits), [
    '2026-01-31 09:00', '2026-03-31 09:00', '2026-05-31 09:00', '2026-07-31 09:00',
  ])
})

test('monthly on the 29th appears in a leap February and not a common one', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, byMonthDay: [29], time: '09:00',
    startDate: '2027-01-01', endDate: null,
  }
  const common = occurrencesBetween(rule, at(2027, 2, 1), at(2027, 2, 28, 23, 59))
  assert.deepEqual(common, [], '2027 is not a leap year')

  const leap = occurrencesBetween(rule, at(2028, 2, 1), at(2028, 2, 29, 23, 59))
  assert.deepEqual(clocks(leap), ['2028-02-29 09:00'])
})

test('monthly on several dates is ordered within each month', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, byMonthDay: [15, 1], time: '08:00',
    startDate: '2026-01-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 2, 28, 23, 59))

  assert.deepEqual(clocks(hits), [
    '2026-01-01 08:00', '2026-01-15 08:00', '2026-02-01 08:00', '2026-02-15 08:00',
  ])
})

test('quarterly (interval 3) is anchored to the start month', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 3, byMonthDay: [5], time: '09:00',
    startDate: '2026-02-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 12, 31))

  assert.deepEqual(clocks(hits), [
    '2026-02-05 09:00', '2026-05-05 09:00', '2026-08-05 09:00', '2026-11-05 09:00',
  ])
})

test('monthly rolls across a year boundary', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, byMonthDay: [10], time: '09:00',
    startDate: '2026-11-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 11, 1), at(2027, 2, 28))

  assert.deepEqual(clocks(hits), [
    '2026-11-10 09:00', '2026-12-10 09:00', '2027-01-10 09:00', '2027-02-10 09:00',
  ])
})

test('monthly with no byMonthDay uses the start date day', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 1, time: '09:00',
    startDate: '2026-01-07', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 3, 31))
  assert.deepEqual(clocks(hits), ['2026-01-07 09:00', '2026-02-07 09:00', '2026-03-07 09:00'])
})

// ----------------------------------------------------------- windows

test('an inverted window returns nothing rather than looping', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00', startDate: '2026-01-01', endDate: null,
  }
  assert.deepEqual(occurrencesBetween(rule, at(2026, 5, 5), at(2026, 5, 1)), [])
})

test('window bounds are inclusive at both ends', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00', startDate: '2026-01-01', endDate: null,
  }
  const exact = occurrencesBetween(rule, at(2026, 5, 5, 9, 0), at(2026, 5, 5, 9, 0))
  assert.deepEqual(clocks(exact), ['2026-05-05 09:00'])
})

test('a zero or negative interval is treated as 1 rather than hanging', () => {
  for (const interval of [0, -3, NaN]) {
    const rule: ScheduleRule = {
      freq: 'daily', interval, time: '09:00', startDate: '2026-01-01', endDate: null,
    }
    const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 1, 4, 23, 59))
    assert.equal(hits.length, 4, `interval ${interval} should behave as 1`)
  }
})

test('a long open-ended window stays bounded by the window, not the rule', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00', startDate: '2020-01-01', endDate: null,
  }
  const hits = occurrencesBetween(rule, at(2026, 1, 1), at(2026, 1, 31, 23, 59))
  assert.equal(hits.length, 31)
})

// ----------------------------------------------------------- next / last

test('nextOccurrence finds the following fire time', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, byWeekday: [1], time: '09:00',
    startDate: '2026-01-01', endDate: null,
  }
  const next = nextOccurrence(rule, at(2026, 4, 7, 12, 0))
  assert.equal(clock(next!), '2026-04-13 09:00')
})

test('nextOccurrence skips over an occurrence exactly at the cursor', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00', startDate: '2026-01-01', endDate: null,
  }
  const next = nextOccurrence(rule, at(2026, 4, 7, 9, 0))
  assert.equal(clock(next!), '2026-04-08 09:00')
})

test('nextOccurrence returns null past an end date', () => {
  const rule: ScheduleRule = {
    freq: 'daily', interval: 1, time: '09:00',
    startDate: '2026-01-01', endDate: '2026-01-10',
  }
  assert.equal(nextOccurrence(rule, at(2026, 1, 11)), null)
})

test('nextOccurrence finds a far-off quarterly date', () => {
  const rule: ScheduleRule = {
    freq: 'monthly', interval: 6, byMonthDay: [1], time: '09:00',
    startDate: '2026-01-01', endDate: null,
  }
  const next = nextOccurrence(rule, at(2026, 1, 2))
  assert.equal(clock(next!), '2026-07-01 09:00')
})

test('lastOccurrence finds the most recent past fire time', () => {
  const rule: ScheduleRule = {
    freq: 'weekly', interval: 1, byWeekday: [1], time: '09:00',
    startDate: '2026-01-01', endDate: null,
  }
  assert.equal(clock(lastOccurrence(rule, at(2026, 4, 8, 12, 0))!), '2026-04-06 09:00')
})

// ----------------------------------------------------------- helpers

test('localDateKey formats the local calendar date', () => {
  assert.equal(localDateKey(at(2026, 7, 4, 23, 30)), '2026-07-04')
  assert.equal(localDateKey(at(2026, 12, 31, 0, 1)), '2026-12-31')
})

test('noonOn lands at midday, which no DST shift can push off-day', () => {
  const n = noonOn('2026-03-08')
  assert.equal(localDateKey(n), '2026-03-08')
  assert.equal(new Date(n).getHours(), 12)
})

test('parseTime tolerates junk instead of throwing', () => {
  assert.deepEqual(parseTime('07:05'), { hour: 7, minute: 5 })
  assert.deepEqual(parseTime('9:30'), { hour: 9, minute: 30 })
  assert.deepEqual(parseTime('nonsense'), { hour: 9, minute: 0 })
  assert.deepEqual(parseTime('99:99'), { hour: 23, minute: 59 })
})

test('ordinal handles the teens', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st'])
})

test('describeRule reads as a sentence for each frequency', () => {
  assert.equal(
    describeRule({ freq: 'daily', interval: 1, time: '21:00', startDate: '2026-01-01', endDate: null }),
    'Every day at 21:00',
  )
  assert.equal(
    describeRule({ freq: 'weekly', interval: 1, byWeekday: [1, 4], time: '17:00', startDate: '2026-01-01', endDate: null }),
    'Every Monday and Thursday at 17:00',
  )
  assert.equal(
    describeRule({ freq: 'weekly', interval: 2, byWeekday: [2], time: '08:30', startDate: '2026-01-01', endDate: null }),
    'every 2 weeks on Tuesday at 08:30',
  )
  assert.equal(
    describeRule({ freq: 'monthly', interval: 1, byMonthDay: [1, 15], time: '09:00', startDate: '2026-01-01', endDate: null }),
    'Monthly on the 1st and 15th at 09:00',
  )
  assert.ok(describeRule({ freq: 'once', at: '2026-09-14T17:30' }).startsWith('Once, on'))
})
