import type { Attachment, Case, Entry, LedgerEntry } from '../db/types'
import { formatDateTime, isoLocal } from './format'
import { formatBytes, KIND_LABEL } from './files'
import { isContemporaneous, recordingLag } from '../db/migrate'
import { describeCoverage, type CoverageSummary } from './coverage'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))

const paragraphs = (text: string) =>
  text.trim()
    ? text.trim().split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : '<p class="muted">No account recorded.</p>'

/** An attachment plus the path it was written to inside the archive. */
export type ReportAttachment = Attachment & { exportPath: string }

export interface ReportInput {
  case: Case | null
  entries: Entry[]
  attachmentsByEntry: Map<string, ReportAttachment[]>
  ledger: LedgerEntry[]
  headHash: string
  generatedAt: number
  coverage: CoverageSummary | null
}

/** Plain-words gap between an event and its being written down. */
export function describeLag(ms: number): string {
  const abs = Math.abs(ms)
  const hours = Math.round(abs / 3_600_000)
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(abs / 86_400_000)
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`
  return `about ${Math.round(days / 30)} months`
}

/**
 * A self-contained HTML report. It opens in any browser with no network and no
 * Papertrail install, and prints to PDF cleanly — so the person you hand the
 * bundle to can read it without trusting or running this app.
 */
export function buildReport(input: ReportInput): string {
  const { entries, attachmentsByEntry, ledger, headHash, generatedAt, coverage } = input
  const title = input.case ? input.case.title : 'Papertrail — all entries'

  const realCount = entries.filter((e) => e.kind !== 'nothing-to-report').length
  const quietCount = entries.filter((e) => e.kind === 'nothing-to-report').length
  const backfilledCount = entries.filter((e) => !isContemporaneous(e)).length

  /*
   * Coverage is stated with its limits attached. A log covering 40% of days is
   * a perfectly honest document; one that quietly implies it covers everything
   * is not, and the difference is a paragraph of plain English.
   */
  const coverageHtml = coverage
    ? `<div class="coverage">
        <strong>Logging coverage.</strong> ${escapeHtml(describeCoverage(coverage))}
        <div class="cov-bar" role="img" aria-label="Coverage by day">
          ${coverage.days.map((d) => `<i class="cov ${d.state}" title="${escapeHtml(d.date)}: ${
            d.state === 'logged' ? 'entry logged'
              : d.state === 'nothing-to-report' ? 'nothing to report'
              : 'unaccounted for'
          }"></i>`).join('')}
        </div>
        <p class="cov-note">
          A day marked as nothing-to-report was actively confirmed quiet by the person keeping this
          log. A day marked unaccounted-for is one where no entry was made and no confirmation was
          given — it means nothing was recorded, not that nothing happened.
        </p>
      </div>`
    : ''

  const entryHtml = entries.map((entry, i) => {
    const files = attachmentsByEntry.get(entry.id) ?? []
    const meta: string[] = []
    if (entry.location) meta.push(`<dt>Where</dt><dd>${escapeHtml(entry.location)}</dd>`)
    if (entry.people.length) meta.push(`<dt>Who</dt><dd>${escapeHtml(entry.people.join(', '))}</dd>`)
    if (entry.source) meta.push(`<dt>Source</dt><dd>${escapeHtml(entry.source)}</dd>`)
    if (entry.tags.length) meta.push(`<dt>Tags</dt><dd>${escapeHtml(entry.tags.join(', '))}</dd>`)

    // Both timestamps, always, side by side and separately labelled. A reader
    // who cannot tell which is which cannot weigh the record.
    meta.push(`<dt>Event occurred</dt><dd>${escapeHtml(isoLocal(entry.occurredAt))}</dd>`)
    meta.push(`<dt>Written down</dt><dd>${escapeHtml(isoLocal(entry.recordedAt))}</dd>`)

    const lag = recordingLag(entry)
    const contemporaneous = isContemporaneous(entry)
    meta.push(
      `<dt>Gap</dt><dd>${
        contemporaneous
          ? 'Written at the time'
          : `${escapeHtml(describeLag(lag))} ${lag > 0 ? 'after the event' : 'before the event date'}`
      }</dd>`,
    )

    const fileRows = files.map((f) => `
      <tr>
        <td><a href="files/${escapeHtml(f.exportPath)}">${escapeHtml(f.name)}</a></td>
        <td>${escapeHtml(KIND_LABEL[f.kind])}</td>
        <td>${escapeHtml(formatBytes(f.size))}</td>
        <td class="hash">${escapeHtml(f.sha256)}</td>
      </tr>`).join('')

    // A backfilled entry is banner-marked rather than footnoted. The whole
    // point of keeping two timestamps is lost if the reader has to hunt for the
    // difference.
    const provenanceNote = entry.kind === 'nothing-to-report'
      ? `<p class="tag tag-quiet">Nothing-to-report record. The person keeping this log actively confirmed that nothing occurred on this date. This is a record, not the absence of one.</p>`
      : !contemporaneous
        ? `<p class="tag tag-later"><strong>Written up after the fact.</strong> This account was recorded ${escapeHtml(describeLag(lag))} after the date it describes. It is not a contemporaneous note.</p>`
        : ''

    const migratedNote = entry.timestampsMigrated
      ? `<p class="tag tag-later">One timestamp on this entry was missing from the stored record and was reconstructed from the other. Treat it as approximate.</p>`
      : ''

    return `
    <article class="entry${entry.kind === 'nothing-to-report' ? ' quiet' : ''}" id="entry-${i + 1}">
      <header>
        <span class="num">${i + 1}</span>
        <div>
          <h3>${escapeHtml(entry.title)}</h3>
          <time datetime="${escapeHtml(isoLocal(entry.occurredAt))}">${escapeHtml(formatDateTime(entry.occurredAt))}</time>
        </div>
      </header>
      ${provenanceNote}${migratedNote}
      <div class="account">${paragraphs(entry.notes)}</div>
      <dl>${meta.join('')}</dl>
      ${files.length ? `<table class="files">
        <thead><tr><th>File</th><th>Type</th><th>Size</th><th>SHA-256 at intake</th></tr></thead>
        <tbody>${fileRows}</tbody>
      </table>` : ''}
    </article>`
  }).join('')

  const ledgerRows = ledger.map((l) => `
    <tr>
      <td>${l.seq}</td>
      <td>${escapeHtml(isoLocal(l.at))}</td>
      <td>${escapeHtml(l.action)}</td>
      <td>${escapeHtml(l.summary)}</td>
      <td class="hash">${escapeHtml(l.hash)}</td>
    </tr>`).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px 96px; font: 16px/1.6 ui-serif, Georgia, "Times New Roman", serif;
         color: #16181d; background: #fff; }
  .sheet { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 30px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: #6b7280;
       margin: 48px 0 16px; font-family: ui-sans-serif, system-ui, sans-serif; }
  h3 { font-size: 19px; margin: 0 0 2px; }
  .lede { color: #4b5563; margin: 0 0 4px; }
  .muted { color: #6b7280; }
  .stamp { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; color: #4b5563;
           border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-top: 20px;
           background: #fafafa; word-break: break-all; }
  .entry { border-top: 1px solid #e5e7eb; padding: 22px 0; break-inside: avoid; }
  .entry header { display: flex; gap: 14px; align-items: baseline; }
  .num { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #9ca3af;
         border: 1px solid #e5e7eb; border-radius: 999px; min-width: 26px; height: 26px;
         display: inline-flex; align-items: center; justify-content: center; flex: none; }
  time { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: #6b7280; }
  .account p { margin: 12px 0; }
  dl { display: grid; grid-template-columns: 120px 1fr; gap: 4px 14px; margin: 14px 0 0;
       font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
  dt { color: #6b7280; }
  dd { margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px;
          font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  th { color: #6b7280; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
  .hash { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; color: #6b7280; word-break: break-all; }
  a { color: #1d4ed8; }
  .tag { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; border-radius: 8px;
         padding: 8px 11px; margin: 12px 0 0; }
  .tag-later { background: #fdf4e3; border: 1px solid #eccf95; color: #6b4c12; }
  .tag-quiet { background: #f3f4f6; border: 1px solid #e0e2e6; color: #4b5563; }
  .entry.quiet h3 { font-weight: 500; color: #4b5563; }
  .coverage { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13.5px; color: #374151;
              border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; margin-top: 18px;
              background: #fafafa; }
  .cov-bar { display: flex; flex-wrap: wrap; gap: 2px; margin: 12px 0 8px; }
  .cov { width: 11px; height: 11px; border-radius: 2px; display: inline-block;
         border: 1px solid #d7dae0; }
  .cov.logged { background: #4ec98a; border-color: #35a86c; }
  .cov.nothing-to-report { background: #d5d8dd; }
  .cov.unaccounted { background: transparent; border-style: dashed; }
  .cov-note { font-size: 12px; color: #6b7280; margin: 8px 0 0; }
  @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } }
</style>
</head>
<body>
<div class="sheet">
  <h1>${escapeHtml(title)}</h1>
  ${input.case?.summary ? `<p class="lede">${escapeHtml(input.case.summary)}</p>` : ''}
  <p class="muted" style="font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px">
    ${realCount} ${realCount === 1 ? 'entry' : 'entries'}${
      quietCount ? ` · ${quietCount} nothing-to-report day${quietCount === 1 ? '' : 's'}` : ''
    }${
      backfilledCount ? ` · ${backfilledCount} written up after the fact` : ''
    } · exported ${escapeHtml(formatDateTime(generatedAt))}
  </p>

  ${coverageHtml}

  <div class="stamp">
    <strong>Integrity stamp.</strong> Each file below is listed with the SHA-256 digest taken when it
    was first added. Re-hash any file in <code>files/</code> and compare to confirm it is unchanged.
    The action log is a hash chain: every line commits to the line before it.<br><br>
    Chain head at export: ${escapeHtml(headHash)}
  </div>

  <h2>Timeline</h2>
  ${entries.length ? entryHtml : '<p class="muted">No entries.</p>'}

  <h2>Action log</h2>
  <table>
    <thead><tr><th>#</th><th>When</th><th>Action</th><th>Summary</th><th>Entry hash</th></tr></thead>
    <tbody>${ledgerRows}</tbody>
  </table>
</div>
</body>
</html>`
}
