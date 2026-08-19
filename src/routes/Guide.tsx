import { Link } from 'react-router-dom'
import { Explain, Term } from '../components/Explain'
import { ShieldIcon } from '../components/icons'

/**
 * The long-form answer to "what is this and why does it work that way", kept on
 * its own screen so the working parts of the app can stay uncluttered.
 */
export function Guide() {
  return (
    <>
      <div className="page-head">
        <h1>How Papertrail works</h1>
        <p className="sub">The whole idea, in plain language. Two minutes.</p>
      </div>

      <div className="stack">
        <div className="card">
          <div className="section-label">The short version</div>
          <p className="small muted">
            You write down things as they happen and attach whatever came with them — photos,
            screenshots, video, voice memos, PDFs, letters. Papertrail stores it all on your phone or
            computer and keeps a sealed record showing that nothing has been changed since you saved
            it. Later, you can hand someone a single file containing the whole story, and they can
            check it themselves.
          </p>
        </div>

        <div className="card">
          <div className="section-label">What each screen is for</div>
          <div className="step">
            <span className="step-num">1</span>
            <div>
              <h4>Timeline</h4>
              <p>Everything you have recorded, newest first. This is your home screen. Search it, or
                tap a tag to narrow it down.</p>
            </div>
          </div>
          <div className="step">
            <span className="step-num">2</span>
            <div>
              <h4>Cases</h4>
              <p>A folder for one situation — a dispute with a landlord, a problem at work, one
                person. Filing entries under a case lets you export just that story later. You do not
                have to use cases; entries can stand on their own.</p>
            </div>
          </div>
          <div className="step">
            <span className="step-num">3</span>
            <div>
              <h4>History</h4>
              <p>A sealed log of every single thing that has happened in the app. It is what turns a
                pile of files into something a sceptical person can trust.</p>
            </div>
          </div>
          <div className="step">
            <span className="step-num">4</span>
            <div>
              <h4>Settings</h4>
              <p>Backups, exports, and the switch that stops your browser deleting your records.
                Worth visiting once, early.</p>
            </div>
          </div>
        </div>

        <div className="card stack">
          <div className="section-label">The words this app uses</div>
          <Explain question="What is a “hash”?" defaultOpen>
            <p>
              A hash is a short fingerprint of a file, worked out from its contents. The same file
              always produces the same fingerprint. Change even one pixel or one letter and the
              fingerprint comes out completely different.
            </p>
            <p>
              Papertrail takes that fingerprint the moment you attach a file, before you can edit it.
              So later, anyone can re-take the fingerprint and compare. Same fingerprint means the
              file is exactly what you saved.
            </p>
          </Explain>

          <Explain question="What is the “chain”, and what does “sealed” mean?">
            <p>
              Every action you take gets written as a line in the History log. Each line includes the
              fingerprint of the line before it — like a paper trail where every page is signed
              across the seam onto the last one.
            </p>
            <p>
              That means nobody can quietly reword or delete a line in the middle. Doing so would
              break the seam, and every line after it stops matching. Papertrail checks all of them
              and tells you if anything is off.
            </p>
          </Explain>

          <Explain question="Why does deleting an entry leave a line behind?">
            <p>
              When you delete an entry, its files really are erased and cannot be recovered. But the
              History log keeps one line saying that an entry existed and was deleted, and when.
            </p>
            <p>
              That is deliberate. A record with silent gaps is worth much less — someone can always
              suggest you quietly removed the inconvenient parts. A record that openly says
              “something was deleted here, on this date, for this reason” is far stronger.
            </p>
          </Explain>

          <Explain question="What actually happens when I export?">
            <p>
              You get one ZIP file. Inside it: a readable report you can print or send, the original
              files exactly as you saved them, the full History log, and a plain-English page
              explaining how to check the fingerprints.
            </p>
            <p>
              The person you give it to does not need Papertrail, an account, or any trust in this
              app. They can verify it with tools already on their computer.
            </p>
          </Explain>
        </div>

        <div className="card stack">
          <div className="section-label">Being straight with you</div>
          <div className="banner">
            <ShieldIcon />
            <div>
              <Term word="What this proves:">
                that what you recorded has not been altered since you recorded it, and the order in
                which you wrote things down.
              </Term>
              <Term word="What it does not prove:">
                that an event really happened, that your account is accurate, or when something
                occurred in the real world. A timestamp is only as good as the device clock behind it.
              </Term>
              <Term word="What it is not:">
                legal advice, and not a substitute for a lawyer, an official notarisation, or
                reporting something to the people whose job it is to act on it.
              </Term>
            </div>
          </div>
        </div>

        <div className="card stack">
          <div className="section-label">Please read this one</div>
          <p className="small muted">
            Papertrail has no account and no server, which is what keeps it private — but it also
            means <strong>nobody is backing this up for you</strong>. If you lose the device, or your
            browser clears its storage, the records are gone.
          </p>
          <ul className="plain-list">
            <li>Open Settings and turn on persistent storage.</li>
            <li>Download a backup now and then, and keep it somewhere else.</li>
            <li>If something really matters, export it and email the ZIP to yourself too.</li>
          </ul>
          <Link className="btn primary block" to="/settings">Go to Settings</Link>
        </div>

        <Link className="btn block" to="/">Back to the timeline</Link>
      </div>
    </>
  )
}
