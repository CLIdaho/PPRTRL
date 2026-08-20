import { db, getSetting, putSetting } from './db'
import { record } from './ledger'
import { newId } from '../lib/id'
import type { Anchor, Prompt, ScheduleRule, SweepSettings } from './types'
import {
  DAY, describeRule, localDateKey, localTime, noonOn, occurrencesBetween, parseTime, startOfDay,
} from '../lib/schedule'

const SWEEP_KEY = 'sweep'

export const DEFAULT_SWEEP: SweepSettings = {
  enabled: false,
  time: '21:00',
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  lookbackDays: 30,
  batterySetupSeen: false,
  lastSeenAt: 0,
  lastSweptAt: 0,
}

export async function getSweep(): Promise<SweepSettings> {
  // Merged over the defaults so a settings row written by an older build never
  // leaves a field undefined at a call site that assumes it.
  return { ...DEFAULT_SWEEP, ...(await getSetting<Partial<SweepSettings>>(SWEEP_KEY, {})) }
}

export async function saveSweep(patch: Partial<SweepSettings>): Promise<SweepSettings> {
  const before = await getSweep()
  const after = { ...before, ...patch }
  await putSetting(SWEEP_KEY, after)

  // Housekeeping fields change on every app open; only a real configuration
  // change is worth a permanent line in the record.
  const meaningful = (['enabled', 'time', 'weekdays', 'lookbackDays'] as const).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
  if (meaningful.length) {
    await record('sweep.configure', '-', after.enabled
      ? `Daily check-in set for ${after.time}`
      : 'Daily check-in turned off', { fields: meaningful, time: after.time, enabled: after.enabled })
  }
  return after
}

/** The daily sweep expressed as an ordinary rule, so one engine drives everything. */
export function sweepRule(sweep: SweepSettings): ScheduleRule | null {
  if (!sweep.enabled) return null
  return {
    freq: 'weekly',
    interval: 1,
    byWeekday: sweep.weekdays.length ? sweep.weekdays : [0, 1, 2, 3, 4, 5, 6],
    time: sweep.time,
    // Backdated so the rule can be evaluated over any past window the coverage
    // view asks about, rather than only from the moment it was switched on.
    startDate: '2000-01-01',
    endDate: null,
  }
}

// ------------------------------------------------------------------ anchors

export async function listAnchors(): Promise<Anchor[]> {
  return (await db.anchors.toArray()).sort((a, b) => a.label.localeCompare(b.label))
}

export async function createAnchor(input: {
  label: string
  note?: string
  rule: ScheduleRule
  promptAfterMinutes?: number
  caseId?: string | null
}): Promise<Anchor> {
  const now = Date.now()
  const anchor: Anchor = {
    id: newId('anchor'),
    label: input.label.trim() || 'Untitled anchor',
    note: input.note?.trim() ?? '',
    rule: input.rule,
    promptAfterMinutes: Math.max(0, Math.round(input.promptAfterMinutes ?? 0)),
    enabled: true,
    caseId: input.caseId ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await db.anchors.put(anchor)
  await record('anchor.create', anchor.id, `Reminder added: ${anchor.label}`, {
    rule: describeRule(anchor.rule),
    promptAfterMinutes: anchor.promptAfterMinutes,
  })
  return anchor
}

export async function updateAnchor(
  id: string,
  patch: Partial<Omit<Anchor, 'id' | 'createdAt'>>,
): Promise<void> {
  const before = await db.anchors.get(id)
  if (!before) return
  const after: Anchor = { ...before, ...patch, updatedAt: Date.now() }
  await db.anchors.put(after)

  const changed = (Object.keys(patch) as (keyof Anchor)[]).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )
  if (!changed.length) return

  const toggled = changed.includes('enabled')
  await record(
    'anchor.update',
    id,
    toggled
      ? `Reminder ${after.enabled ? 'resumed' : 'paused'}: ${after.label}`
      : `Reminder edited: ${after.label}`,
    { fields: changed, rule: describeRule(after.rule) },
  )
}

/**
 * Removes an anchor and any prompt of its that nobody answered.
 *
 * Answered prompts stay: they point at real entries, and severing that link
 * would leave an entry claiming to answer a prompt that no longer exists.
 */
export async function deleteAnchor(id: string): Promise<void> {
  const anchor = await db.anchors.get(id)
  if (!anchor) return
  const orphaned = await db.prompts.where('anchorId').equals(id).toArray()
  const removable = orphaned.filter((p) => p.state === 'pending')

  await db.transaction('rw', db.anchors, db.prompts, async () => {
    await db.prompts.bulkDelete(removable.map((p) => p.id))
    await db.anchors.delete(id)
  })
  await record('anchor.delete', id, `Reminder deleted: ${anchor.label}`, {
    rule: describeRule(anchor.rule),
    pendingPromptsRemoved: removable.length,
  })
}

// ------------------------------------------------------------------ prompts

/**
 * Turns every rule into concrete prompt rows for the window that has passed
 * since the app was last open, and reports what is still unanswered.
 *
 * Prompts are materialised rather than derived on the fly so that a prompt which
 * fired while the app was closed is a fact on the record — with the gap between
 * when it was due and when the app noticed — rather than something recomputed,
 * and silently forgotten, at read time. This is the catch-up mechanism, and it
 * is the only delivery path that does not depend on the platform cooperating.
 */
export async function materialisePrompts(now = Date.now()): Promise<Prompt[]> {
  const sweep = await getSweep()
  const anchors = (await db.anchors.toArray()).filter((a) => a.enabled)

  // Never walk further back than the coverage view shows: a device left closed
  // for a year should not wake up to three hundred prompts.
  const horizon = Math.max(startOfDay(now) - sweep.lookbackDays * DAY, startOfDay(now) - 90 * DAY)
  const from = sweep.lastSweptAt > 0 ? Math.max(sweep.lastSweptAt, horizon) : horizon

  const wanted: Omit<Prompt, 'id' | 'noticedAt' | 'state' | 'entryId' | 'resolvedAt'>[] = []

  for (const anchor of anchors) {
    const offset = anchor.promptAfterMinutes * 60_000
    // Widen the search by the offset so an event just before the window whose
    // prompt lands inside it is still caught.
    for (const at of occurrencesBetween(anchor.rule, from - offset, now - offset)) {
      const dueAt = at + offset
      if (dueAt > now) continue
      wanted.push({
        anchorId: anchor.id,
        kind: 'anchor',
        label: anchor.label,
        dueAt,
        forDate: localDateKey(at),
      })
    }
  }

  const rule = sweepRule(sweep)
  if (rule) {
    for (const at of occurrencesBetween(rule, from, now)) {
      wanted.push({ anchorId: null, kind: 'sweep', label: 'Daily check-in', dueAt: at, forDate: localDateKey(at) })
    }
  }

  const existing = await db.prompts.toArray()
  const seen = new Set(existing.map(keyOf))
  const fresh: Prompt[] = []

  for (const w of wanted) {
    const key = `${w.anchorId ?? 'sweep'}|${w.forDate}|${w.dueAt}`
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push({
      ...w,
      id: newId('prompt'),
      // The gap between dueAt and noticedAt is the honest record of how late
      // delivery was — or that it never happened and the user opened the app.
      noticedAt: now,
      state: 'pending',
      entryId: null,
      resolvedAt: null,
    })
  }

  if (fresh.length) {
    await db.prompts.bulkPut(fresh)
    const late = fresh.filter((p) => p.noticedAt - p.dueAt > 30 * 60_000)
    if (late.length) {
      await record('prompt.missed', '-', `${late.length} reminder${late.length === 1 ? '' : 's'} missed and picked up on next open`, {
        prompts: late.map((p) => ({
          label: p.label, dueAt: p.dueAt, noticedAt: p.noticedAt, lateByMinutes: Math.round((p.noticedAt - p.dueAt) / 60_000),
        })),
      })
    }
  }

  await saveSweep({ lastSweptAt: now, lastSeenAt: now })
  return pendingPrompts()
}

const keyOf = (p: Prompt) => `${p.anchorId ?? 'sweep'}|${p.forDate}|${p.dueAt}`

export async function pendingPrompts(): Promise<Prompt[]> {
  return (await db.prompts.where('state').equals('pending').toArray()).sort((a, b) => a.dueAt - b.dueAt)
}

/** Links a prompt to the entry that answered it. */
export async function answerPrompt(promptId: string, entryId: string): Promise<void> {
  const prompt = await db.prompts.get(promptId)
  if (!prompt) return
  await db.prompts.put({ ...prompt, state: 'answered', entryId, resolvedAt: Date.now() })
}

export async function dismissPrompt(promptId: string): Promise<void> {
  const prompt = await db.prompts.get(promptId)
  if (!prompt) return
  await db.prompts.put({ ...prompt, state: 'dismissed', resolvedAt: Date.now() })
  await record('prompt.dismiss', promptId, `Reminder dismissed without a record: ${prompt.label}`, {
    dueAt: prompt.dueAt,
    forDate: prompt.forDate,
  })
}

/**
 * The moment a catch-up entry should be dated to.
 *
 * A prompt answered days late describes the day it was for, not today — so
 * occurredAt follows the prompt while recordedAt stays honest about now. That
 * split is the entire reason the two fields exist.
 */
export function occurredAtForPrompt(prompt: Prompt): number {
  const sameDay = localDateKey(prompt.dueAt) === prompt.forDate
  if (sameDay) return prompt.dueAt
  const { hour, minute } = parseTime('12:00')
  const d = new Date(noonOn(prompt.forDate))
  return localTime(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute)
}
