import { db } from './db'
import type { LedgerAction, LedgerEntry } from './types'
import { canonicalJson, sha256Text } from '../lib/hash'

/** The hash a chain starts from, before anything has been recorded. */
export const GENESIS = '0'.repeat(64)

function preimage(e: Omit<LedgerEntry, 'hash'>): string {
  return canonicalJson({
    seq: e.seq,
    at: e.at,
    action: e.action,
    subject: e.subject,
    summary: e.summary,
    details: e.details,
    prevHash: e.prevHash,
  })
}

export async function hashOf(e: Omit<LedgerEntry, 'hash'>): Promise<string> {
  return sha256Text(preimage(e))
}

/**
 * Appends one entry to the hash chain. Runs inside a transaction so two
 * concurrent writes can never claim the same `prevHash` and fork the chain.
 */
export async function record(
  action: LedgerAction,
  subject: string,
  summary: string,
  details: Record<string, unknown> = {},
): Promise<LedgerEntry> {
  return db.transaction('rw', db.ledger, async () => {
    const last = await db.ledger.orderBy('seq').last()
    const draft = {
      seq: (last?.seq ?? 0) + 1,
      at: Date.now(),
      action,
      subject,
      summary,
      details,
      prevHash: last?.hash ?? GENESIS,
    }
    const entry: LedgerEntry = { ...draft, hash: await hashOf(draft) }
    // Dexie assigns `seq` itself on an auto-increment key; write it explicitly so
    // the value we hashed is the value stored.
    await db.ledger.put(entry)
    return entry
  })
}

export interface ChainProblem {
  seq: number
  reason: 'broken-link' | 'bad-hash' | 'missing-seq'
  detail: string
}

export interface ChainReport {
  length: number
  intact: boolean
  problems: ChainProblem[]
  headHash: string
}

/** Recomputes every hash in the chain and re-checks every link. */
export async function verifyChain(): Promise<ChainReport> {
  const all = await db.ledger.orderBy('seq').toArray()
  const problems: ChainProblem[] = []
  let prevHash = GENESIS
  let expectedSeq = 1

  for (const e of all) {
    if (e.seq !== expectedSeq) {
      problems.push({
        seq: e.seq,
        reason: 'missing-seq',
        detail: `expected entry #${expectedSeq}, found #${e.seq} — ${e.seq - expectedSeq} entr${
          e.seq - expectedSeq === 1 ? 'y is' : 'ies are'
        } missing`,
      })
      expectedSeq = e.seq
    }
    if (e.prevHash !== prevHash) {
      problems.push({
        seq: e.seq,
        reason: 'broken-link',
        detail: 'does not follow the entry before it',
      })
    }
    const { hash, ...rest } = e
    if ((await hashOf(rest)) !== hash) {
      problems.push({ seq: e.seq, reason: 'bad-hash', detail: 'contents changed after recording' })
    }
    prevHash = e.hash
    expectedSeq++
  }

  return { length: all.length, intact: problems.length === 0, problems, headHash: prevHash }
}

/** Writes the opening entry the first time the app is used. */
export async function ensureTrailStarted(): Promise<void> {
  const count = await db.ledger.count()
  if (count === 0) {
    await record('trail.start', '-', 'Papertrail opened for the first time on this device')
  }
}
