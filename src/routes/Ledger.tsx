import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { record, verifyChain, type ChainReport } from '../db/ledger'
import { verifyFiles, type IntegrityResult } from '../db/repo'
import { Explain } from '../components/Explain'
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
        <h1>History</h1>
        <p className="sub">
          A sealed log of everything that has happened here, in order.
        </p>
      </div>

      <Explain question="What is this screen and why should I care?" defaultOpen>
        <p>
          Every action you take — recording an entry, editing it, attaching a file, deleting
          something, running an export — gets written down here as a numbered line. Lines are only
          ever added. Nothing here can be edited or removed, including by you.
        </p>
        <p>
          Each line also carries a fingerprint of the line before it, so they are joined in a chain.
          If anyone tampered with your records outside the app, the chain would break and the banner
          below would say so.
        </p>
        <p>
          <strong>In short:</strong> this is what lets you say “here is my record, and here is proof
          I haven’t quietly changed it since.”
        </p>
      </Explain>

      <div style={{ height: 12 }} />

      <div className={`banner ${allGood ? 'ok' : chain && !chain.intact ? 'bad' : ''}`}>
        {allGood ? <ShieldIcon /> : <AlertIcon />}
        <div>
          {chain === null ? (
            'Checking…'
          ) : chain.intact ? (
            <>
              <strong>Everything checks out.</strong> {chain.length} recorded action
              {chain.length === 1 ? '' : 's'}, with no gaps and no signs of tampering.
              {files && (
                problems.length === 0
                  ? ` All ${files.length} stored file${files.length === 1 ? ' is' : 's are'} exactly as you saved ${files.length === 1 ? 'it' : 'them'}.`
                  : ` But ${problems.length} file${problems.length === 1 ? '' : 's'} did not match — see below.`
              )}
            </>
          ) : (
            <>
              <strong>Something has been tampered with.</strong> {chain.problems.length} problem
              {chain.problems.length === 1 ? '' : 's'} found. This log was changed by something other
              than Papertrail. Export a backup and treat these records with caution.
            </>
          )}
          <div className="tiny mono faint break" style={{ marginTop: 6 }} title="The fingerprint of the most recent line in the log.">
            latest seal {chain ? shortHash(chain.headHash) : '…'}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <p className="tiny faint" style={{ marginBottom: 8 }}>
          Re-reads every file you have stored and compares it against the fingerprint taken when you
          first added it. Safe to run any time; it only reads.
        </p>
        <button className="btn block" onClick={() => void runFullCheck()} disabled={checking}>
          {checking ? 'Checking every file…' : 'Check every file for tampering'}
        </button>
        {checking && (
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>

      {chain && !chain.intact && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-label">What is wrong</div>
          {chain.problems.map((p, i) => (
            <div className="small" key={i} style={{ marginTop: i ? 6 : 0 }}>
              <span className="mono faint">#{p.seq}</span> {p.detail}
            </div>
          ))}
        </div>
      )}

      {problems.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="section-label">Files that no longer match</div>
          {problems.map((p) => (
            <div className="small" key={p.attachmentId} style={{ marginTop: 6 }}>
              <strong>{p.name}</strong> — {p.status === 'missing' ? 'the stored copy has gone missing' : 'this file is not the one you originally saved'}
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-label">Everything that has happened</div>
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
        Lines are only ever added here, never changed or removed — including when you delete
        evidence. A record with silent gaps would be far easier to doubt.
      </p>
    </>
  )
}
