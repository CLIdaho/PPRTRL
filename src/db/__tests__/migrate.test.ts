import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeTimestamps, isContemporaneous, recordingLag } from '../migrate.ts'

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0)
const HOUR = 3_600_000
const DAY = 86_400_000

/** A complete, current-schema row — the case the migration must not touch. */
function current(over: Record<string, unknown> = {}) {
  return {
    id: 'entry_1',
    caseId: null,
    title: 'Notice taped to door',
    notes: 'Third one this month.',
    occurredAt: NOW - 2 * HOUR,
    recordedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    tags: ['housing'],
    people: ['Landlord'],
    location: '12 Elm St',
    source: 'photo',
    kind: 'entry' as const,
    status: 'complete' as const,
    provenance: 'contemporaneous' as const,
    promptId: null,
    deletedAt: null,
    ...over,
  }
}

test('a complete row is left alone and is not flagged as migrated', () => {
  const input = current()
  const { row, migrated, repaired } = normalizeTimestamps(input, NOW)

  assert.equal(migrated, false)
  assert.deepEqual(repaired, [])
  assert.equal(row.occurredAt, input.occurredAt)
  assert.equal(row.recordedAt, input.recordedAt)
  assert.equal(row.timestampsMigrated, undefined)
})

test('a missing recordedAt falls back to occurredAt, not to now', () => {
  const { row, migrated } = normalizeTimestamps(
    current({ recordedAt: undefined }),
    NOW,
  )

  assert.equal(migrated, true)
  assert.equal(row.recordedAt, NOW - 2 * HOUR, 'should reuse occurredAt, not the clock')
  assert.equal(row.timestampsMigrated, true)
})

test('a missing occurredAt falls back to recordedAt', () => {
  const { row, migrated } = normalizeTimestamps(
    current({ occurredAt: undefined }),
    NOW,
  )

  assert.equal(migrated, true)
  assert.equal(row.occurredAt, NOW - HOUR)
  assert.equal(row.timestampsMigrated, true)
})

test('both timestamps missing falls back to updatedAt before guessing', () => {
  const { row } = normalizeTimestamps(
    current({ occurredAt: undefined, recordedAt: undefined, updatedAt: NOW - 5 * DAY }),
    NOW,
  )

  assert.equal(row.occurredAt, NOW - 5 * DAY)
  assert.equal(row.recordedAt, NOW - 5 * DAY)
})

test('with nothing at all to go on it uses the supplied clock, and says so', () => {
  const { row, migrated, repaired } = normalizeTimestamps(
    current({ occurredAt: undefined, recordedAt: undefined, updatedAt: undefined }),
    NOW,
  )

  assert.equal(migrated, true)
  assert.equal(row.occurredAt, NOW)
  assert.equal(row.recordedAt, NOW)
  assert.ok(repaired.includes('occurredAt'))
  assert.ok(repaired.includes('recordedAt'))
})

test('zero, NaN and negative timestamps are treated as absent', () => {
  for (const bad of [0, NaN, -1, Infinity]) {
    const { row, migrated } = normalizeTimestamps(
      current({ recordedAt: bad }),
      NOW,
    )
    assert.equal(migrated, true, `${bad} should count as missing`)
    assert.equal(row.recordedAt, NOW - 2 * HOUR)
  }
})

test('defaulting kind or status alone does not flag the row as migrated', () => {
  const { row, migrated, repaired } = normalizeTimestamps(
    current({ kind: undefined, status: undefined, provenance: undefined }),
    NOW,
  )

  assert.equal(migrated, false, 'a reconstructed timestamp is what the flag means')
  assert.equal(row.timestampsMigrated, undefined)
  assert.equal(row.kind, 'entry')
  assert.equal(row.status, 'complete')
  assert.ok(repaired.includes('kind'))
})

test('provenance is inferred as backfilled when the write came days later', () => {
  const { row } = normalizeTimestamps(
    current({ provenance: undefined, occurredAt: NOW - 30 * DAY, recordedAt: NOW }),
    NOW,
  )

  assert.equal(row.provenance, 'backfilled')
})

test('an explicitly stored provenance is never overwritten', () => {
  const { row } = normalizeTimestamps(
    current({ provenance: 'catch-up', occurredAt: NOW - 30 * DAY, recordedAt: NOW }),
    NOW,
  )

  assert.equal(row.provenance, 'catch-up')
})

test('a nothing-to-report row keeps its kind', () => {
  const { row } = normalizeTimestamps(current({ kind: 'nothing-to-report' }), NOW)
  assert.equal(row.kind, 'nothing-to-report')
})

test('junk field types are coerced rather than propagated', () => {
  const { row } = normalizeTimestamps(
    current({ tags: ['ok', 7, null], people: 'not-an-array', title: undefined, caseId: 42 }),
    NOW,
  )

  assert.deepEqual(row.tags, ['ok'])
  assert.deepEqual(row.people, [])
  assert.equal(row.title, 'Untitled entry')
  assert.equal(row.caseId, null)
})

test('a deleted entry keeps its deletedAt through migration', () => {
  const { row } = normalizeTimestamps(current({ deletedAt: NOW - DAY }), NOW)
  assert.equal(row.deletedAt, NOW - DAY)
})

test('migration is idempotent — running it twice changes nothing further', () => {
  const once = normalizeTimestamps(current({ recordedAt: undefined }), NOW)
  const twice = normalizeTimestamps(once.row, NOW + DAY)

  assert.equal(twice.migrated, false)
  assert.deepEqual(twice.row.recordedAt, once.row.recordedAt)
  assert.deepEqual(twice.row.occurredAt, once.row.occurredAt)
})

test('recordingLag and isContemporaneous agree on the one-hour boundary', () => {
  assert.equal(recordingLag({ occurredAt: NOW - HOUR, recordedAt: NOW }), HOUR)
  assert.equal(isContemporaneous({ occurredAt: NOW - HOUR, recordedAt: NOW }), true)
  assert.equal(isContemporaneous({ occurredAt: NOW - HOUR - 1, recordedAt: NOW }), false)
  // A future-dated event written now is equally "not at the time".
  assert.equal(isContemporaneous({ occurredAt: NOW + 5 * HOUR, recordedAt: NOW }), false)
})
