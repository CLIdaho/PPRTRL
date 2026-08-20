import type { Entry } from '../db/types'
import { DAY, localDateKey, startOfDay } from './schedule'

export type DayState = 'logged' | 'nothing-to-report' | 'unaccounted' | 'future'

export interface CoverageDay {
  /** Local date, `YYYY-MM-DD`. */
  date: string
  state: DayState
  /** Entries whose occurredAt falls on this day. */
  entries: Entry[]
  /** True when every entry for this day was written up later. */
  backfilledOnly: boolean
}

export interface CoverageSummary {
  days: CoverageDay[]
  firstDate: string
  lastDate: string
  totalDays: number
  logged: number
  nothingToReport: number
  unaccounted: number
  /** Share of days with any record at all, 0-1. */
  coverage: number
  /** The longest unbroken stretch of unaccounted-for days. */
  longestGapDays: number
}

/**
 * Buckets the last `lookbackDays` days by what the record says about each one.
 *
 * The distinction that matters: a day with a nothing-to-report entry was
 * actively confirmed quiet, and a day with neither was never looked at. They
 * look identical in a naive timeline, and conflating them is what lets a sparse
 * log pass itself off as a complete one.
 */
export function buildCoverage(
  entries: Entry[],
  lookbackDays: number,
  now = Date.now(),
): CoverageSummary {
  const live = entries.filter((e) => e.deletedAt === null)
  const byDate = new Map<string, Entry[]>()
  for (const entry of live) {
    const key = localDateKey(entry.occurredAt)
    const bucket = byDate.get(key)
    if (bucket) bucket.push(entry)
    else byDate.set(key, [entry])
  }

  const days: CoverageDay[] = []
  const today = startOfDay(now)
  const span = Math.max(1, Math.floor(lookbackDays))

  for (let i = span - 1; i >= 0; i--) {
    // Step by calendar day rather than by milliseconds so a DST boundary inside
    // the window does not duplicate or skip a date.
    const at = startOfDay(today - i * DAY + (i > 0 ? 12 * 3_600_000 : 0))
    const date = localDateKey(at)
    const dayEntries = (byDate.get(date) ?? []).sort((a, b) => a.occurredAt - b.occurredAt)

    const real = dayEntries.filter((e) => e.kind === 'entry')
    const ntr = dayEntries.filter((e) => e.kind === 'nothing-to-report')

    let state: DayState
    if (real.length) state = 'logged'
    else if (ntr.length) state = 'nothing-to-report'
    else state = 'unaccounted'

    days.push({
      date,
      state,
      entries: dayEntries,
      backfilledOnly: dayEntries.length > 0 && dayEntries.every((e) => e.provenance !== 'contemporaneous'),
    })
  }

  const logged = days.filter((d) => d.state === 'logged').length
  const nothingToReport = days.filter((d) => d.state === 'nothing-to-report').length
  const unaccounted = days.filter((d) => d.state === 'unaccounted').length

  let longestGap = 0
  let run = 0
  for (const d of days) {
    if (d.state === 'unaccounted') {
      run++
      if (run > longestGap) longestGap = run
    } else {
      run = 0
    }
  }

  return {
    days,
    firstDate: days[0]?.date ?? '',
    lastDate: days[days.length - 1]?.date ?? '',
    totalDays: days.length,
    logged,
    nothingToReport,
    unaccounted,
    coverage: days.length ? (logged + nothingToReport) / days.length : 0,
    longestGapDays: longestGap,
  }
}

/** A sentence for the export, stating coverage without overstating it. */
export function describeCoverage(summary: CoverageSummary): string {
  if (summary.totalDays === 0) return 'No period covered.'
  const pct = Math.round(summary.coverage * 100)
  const parts = [
    `${summary.firstDate} to ${summary.lastDate} (${summary.totalDays} days)`,
    `${summary.logged} with entries`,
    `${summary.nothingToReport} confirmed as nothing to report`,
    `${summary.unaccounted} unaccounted for`,
  ]
  const gap = summary.longestGapDays > 1
    ? ` The longest unbroken gap is ${summary.longestGapDays} days.`
    : ''
  return `${parts.join('; ')}. ${pct}% of days carry a record.${gap}`
}
