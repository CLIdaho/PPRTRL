import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildCoverage, describeCoverage } from '../coverage.ts'
import { localTime, noonOn } from '../schedule.ts'
import type { Entry } from '../../db/types.ts'

const NOW = localTime(2026, 7, 20, 15, 0) // 20 Aug 2026, local

function entry(over: Partial<Entry> & { occurredAt: number }): Entry {
  return {
    id: `e_${over.occurredAt}_${over.kind ?? 'entry'}`,
    caseId: null, title: 't', notes: '', recordedAt: over.occurredAt,
    updatedAt: over.occurredAt, tags: [], people: [], location: '', source: '',
    kind: 'entry', status: 'complete', provenance: 'contemporaneous',
    promptId: null, deletedAt: null,
    ...over,
  }
}

test('a day with an entry is logged, an empty day is unaccounted for', () => {
  const c = buildCoverage([entry({ occurredAt: noonOn('2026-08-19') })], 3, NOW)

  assert.deepEqual(c.days.map((d) => d.date), ['2026-08-18', '2026-08-19', '2026-08-20'])
  assert.deepEqual(c.days.map((d) => d.state), ['unaccounted', 'logged', 'unaccounted'])
  assert.equal(c.logged, 1)
  assert.equal(c.unaccounted, 2)
})

test('nothing-to-report is its own state, never conflated with a gap', () => {
  const c = buildCoverage(
    [entry({ occurredAt: noonOn('2026-08-19'), kind: 'nothing-to-report' })],
    3, NOW,
  )

  assert.equal(c.days[1].state, 'nothing-to-report')
  assert.equal(c.nothingToReport, 1)
  assert.equal(c.logged, 0, 'a quiet day is not a logged day')
  assert.equal(c.unaccounted, 2, 'and it is not a gap either')
})

test('a real entry outranks a nothing-to-report on the same day', () => {
  const c = buildCoverage([
    entry({ occurredAt: noonOn('2026-08-19'), kind: 'nothing-to-report' }),
    entry({ occurredAt: noonOn('2026-08-19') + 3_600_000, kind: 'entry' }),
  ], 3, NOW)

  assert.equal(c.days[1].state, 'logged')
})

test('deleted entries do not count as coverage', () => {
  const c = buildCoverage(
    [entry({ occurredAt: noonOn('2026-08-19'), deletedAt: NOW })],
    3, NOW,
  )
  assert.equal(c.days[1].state, 'unaccounted')
})

test('coverage share and the longest gap are computed over the window', () => {
  const entries = ['2026-08-14', '2026-08-15', '2026-08-20'].map((d) =>
    entry({ occurredAt: noonOn(d) }))
  const c = buildCoverage(entries, 10, NOW) // 2026-08-11 .. 2026-08-20

  assert.equal(c.totalDays, 10)
  assert.equal(c.logged, 3)
  assert.equal(c.unaccounted, 7)
  assert.equal(c.coverage, 0.3)
  // 16,17,18,19 is the longest run; 11,12,13 is three.
  assert.equal(c.longestGapDays, 4)
})

test('a fully covered window reports no gap', () => {
  const entries = ['2026-08-18', '2026-08-19', '2026-08-20'].map((d) =>
    entry({ occurredAt: noonOn(d) }))
  const c = buildCoverage(entries, 3, NOW)

  assert.equal(c.coverage, 1)
  assert.equal(c.longestGapDays, 0)
  assert.equal(c.unaccounted, 0)
})

test('a day whose only entries were backfilled is flagged as such', () => {
  const c = buildCoverage([
    entry({ occurredAt: noonOn('2026-08-19'), recordedAt: NOW, provenance: 'backfilled' }),
  ], 3, NOW)

  assert.equal(c.days[1].state, 'logged')
  assert.equal(c.days[1].backfilledOnly, true, 'the export must not call this contemporaneous')
})

test('a day with one contemporaneous entry is not flagged as backfilled', () => {
  const c = buildCoverage([
    entry({ occurredAt: noonOn('2026-08-19'), provenance: 'backfilled' }),
    entry({ occurredAt: noonOn('2026-08-19'), provenance: 'contemporaneous', id: 'x' }),
  ], 3, NOW)

  assert.equal(c.days[1].backfilledOnly, false)
})

test('the window walks calendar days across a DST boundary without duplicating a date', () => {
  const dstNow = localTime(2026, 2, 10, 15, 0) // 10 Mar 2026, just after spring forward
  const c = buildCoverage([], 6, dstNow)

  assert.deepEqual(c.days.map((d) => d.date), [
    '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10',
  ])
  assert.equal(new Set(c.days.map((d) => d.date)).size, 6, 'no repeated dates')
})

test('the same holds across fall back', () => {
  const dstNow = localTime(2026, 10, 3, 15, 0) // 3 Nov 2026
  const c = buildCoverage([], 6, dstNow)

  assert.deepEqual(c.days.map((d) => d.date), [
    '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03',
  ])
})

test('entries outside the window are ignored', () => {
  const c = buildCoverage([entry({ occurredAt: noonOn('2020-01-01') })], 3, NOW)
  assert.equal(c.logged, 0)
  assert.equal(c.unaccounted, 3)
})

test('an empty log yields a well-formed summary rather than NaN', () => {
  const c = buildCoverage([], 7, NOW)
  assert.equal(c.coverage, 0)
  assert.equal(c.totalDays, 7)
  assert.equal(c.longestGapDays, 7)
  assert.ok(describeCoverage(c).includes('7 unaccounted for'))
})

test('describeCoverage states the range and does not overstate', () => {
  const c = buildCoverage([
    entry({ occurredAt: noonOn('2026-08-19') }),
    entry({ occurredAt: noonOn('2026-08-20'), kind: 'nothing-to-report' }),
  ], 4, NOW)

  const text = describeCoverage(c)
  assert.ok(text.includes('2026-08-17 to 2026-08-20'))
  assert.ok(text.includes('1 with entries'))
  assert.ok(text.includes('1 confirmed as nothing to report'))
  assert.ok(text.includes('2 unaccounted for'))
  assert.ok(text.includes('50%'))
})
