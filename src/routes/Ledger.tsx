import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { record, verifyChain, type ChainReport } from '../db/ledger'
import { verifyFiles, type IntegrityResult } from '../db/repo'
import { AlertIcon, ShieldIcon } from '../components/icons'
import { formatDateTime } from '../lib/format'
import { shortHash } from '../lib/hash'

const PAGE = 60

export function Ledger() {
  const [limit, setLimit] = useState(PAGE)
  const [chain, setChain] = useState<ChainReport | null>(null)
  const [files, setFiles] = useState<IntegrityResult[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState(0)

  const total = useLiveQuery(() => db.ledger.count(), [], 0)
  const entries = useLiveQuery(
    () => db.ledger.orderBy('seq').reverse().limit(limit).toArray(),
    [limit],
    [],
  )

  // A cheap chain check on open; the file re-hash is opt-in because it reads
  // every byte of every attachment.
  useEffect(() => {
    void verifyChain().then(setChain)
  }, [total])

  async function runFullCheck() {
    setChecking(true)
    setProgress(0)
    try {
      const chainReport = await verifyChain()
      const fileResults = await verifyFiles((done, count) => setProgress(count ? done / count : 1))
      setChain(chainReport)
      setFiles(fileResults)
      const altered = fileResults.filter((r) => r.status !== 'ok').length
      await record('verify.run', '-', 'Integrity check run', {
        chainIntact: chainReport.intact,
        chainLength: chainReport.length,
        filesChecked: fileResults.length,
        filesFailed: altered,
      })
    } finally {
      setChecking(false)
    }
  }

  const problems = files?.filter((r) => r.status !== 'ok') ?? []
  const allGood = chain?.intact && (files === null || problems.length === 0)

  return (
    <>
      <div className="page-head">
        <h1>Ledger</h1>
        <p className="sub">
          Every action, in order, each line sealed against the one before it.
        </p>
      </div>

      <div className={`banner ${allGood ? 'ok' : chain && !chain.intact ? 'bad' : ''}`}>
        {allGood ? <ShieldIcon /> : <AlertIcon />}
        <div>
          {chain === null ? (
            'Checking the chain…'
          ) : chain.intact ? (
            <>
              <strong>Chain intact.</strong> {chain.length} recorded action
              {chain.length === 1 ? '' : 's'}, unbroken from the first.
              {files && (
                problems.length === 0
                  ? ` All ${files.length} stored file${files.length === 1 ? '' : 's'} match their original hash.`
                  : ` ${problems.length} file${problems.length === 1 ? '' : 's'} failed the hash check.`
              )}
            </>
          ) : (
            <>
              <strong>The chain is broken.</strong> {chain.problems.length} problem
              {chain.problems.length === 1 ? '' : 's'} found — the log has been altered outside the app.
            </>
          )}
          <div className="tiny mono faint break" style={{ marginTop: 6 }}>
            head {chain ? shortHash(chain.headHash) : '…'}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="btn block" onClick={() => void runFullCheck()} disabled={checking}>
          {checking ? 'Re-hashing every file…' : 'Run a full integrity check'}
        </button>
        {checking && (
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>

      {chain && !chain.intact && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-label">Chain problems</div>
          {chain.problems.map((p, i) => (
            <div className="small" key={i} style={{ marginTop: i ? 6 : 0 }}>
              <span className="mono faint">#{p.seq}</span> {p.detail}
            </div>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-label">Files that failed</div>
          {problems.map((p) => (
            <div className="small" key={p.attachmentId} style={{ marginTop: 6 }}>
              <strong>{p.name}</strong> — {p.status === 'missing' ? 'the stored copy is gone' : 'contents no longer match the hash taken at intake'}
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-label">History</div>
        {entries.map((e) => (
          <div className="ledger-item" key={e.seq}>
            <span className="ledger-seq">{e.seq}</span>
            <div className="grow">
              <div className="small">{e.summary}</div>
              <div className="tiny faint">{formatDateTime(e.at)} · {e.action}</div>
              <div className="ledger-hash break">{shortHash(e.hash)}</div>
            </div>
          </div>
        ))}
        {total > entries.length && (
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => setLimit(limit + PAGE)}>
            Show older ({total - entries.length} more)
          </button>
        )}
      </div>

      <p className="tiny faint" style={{ marginTop: 14 }}>
        The ledger is append-only. Entries are never edited or removed, including when evidence is
        deleted — a gap in the record would defeat the purpose.
      </p>
    </>
  )
}
