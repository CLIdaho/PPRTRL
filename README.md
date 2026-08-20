# Papertrail

A local-first evidence log. You record what happened, attach whatever it came
with — photos, video, audio, PDFs, documents, anything digital — and Papertrail
keeps a tamper-evident record of it on your own device.

There is no account, no server, and no network request after the app is
installed. Nothing is uploaded, because there is nowhere to upload it to.

## What it does

**Records entries.** An entry is one thing that happened: a title, an account in
your own words, who was involved, where, and where the material came from.
Entries can be filed under a case or stand alone.

**Keeps two timestamps, and never confuses them.** `occurredAt` is when the
event happened — the user sets it and can correct it. `recordedAt` is when the
entry was created, set once from the clock and stripped from every update patch
at runtime, not merely forbidden by its type. Wherever an entry appears, both
are shown with the gap between them named in plain words, and an entry written
more than an hour after the event it describes is labelled as not
contemporaneous rather than left to look like a same-day note.

**Captures in one tap.** A button on every screen opens a single text field and
saves. Measured at about half a second from tap to stored. The entry lands as a
draft and the timeline offers it back for files, tags and a corrected time later.

**Schedules reminders as data.** Recurring and one-off anchors, plus one daily
check-in, stored as an RRULE-lite JSON rule rather than as code. The engine
evaluates them in local wall clock by moving calendar fields, so a 21:00
reminder stays at 21:00 across a daylight-saving change and a monthly rule for
the 31st skips short months instead of sliding to the 30th.

**Records quiet days as records.** A day confirmed as nothing-to-report is a real
entry with its own timestamps and ledger line. A day nobody checked is a gap.
The coverage view and the export keep the two apart, because collapsing them is
what lets a sparse log pass itself off as a complete one.

**Takes any file.** Every attachment is hashed with SHA-256 the moment it
arrives, before any editing is possible. That digest is stored once and never
recomputed on write, so it always reflects the file as received.

**Keeps a hash-chained ledger.** Every action — entry created, edited, deleted,
file added or removed, export run — is appended to a log where each line commits
to the hash of the line before it. A line cannot be reworded or removed after the
fact without breaking every hash that follows. Deleting an entry erases its files
but leaves the ledger line, so the record never has a silent gap.

**Proves it on demand.** The Ledger screen re-walks the chain and re-hashes every
stored file, and names anything that no longer matches.

**Exports something a third party can read.** A case exports as a ZIP containing
a printable HTML report, the original files, a machine-readable manifest, the
full hash chain, and plain instructions for checking the hashes with `shasum` or
`certutil`. The reader needs neither Papertrail nor trust in it. The report
states its own coverage — date range, days logged, days confirmed quiet, days
unaccounted for — and says outright that an unaccounted-for day means nothing
was recorded, not that nothing happened.

## How reminders are delivered

Ranked by how reliably they actually arrive, which is the order the setup screen
presents them in:

1. **Calendar export (`.ics`).** The OS fires it. Works with the app closed, the
   screen off, and battery saving on. This is the only channel that keeps time,
   so it is step one rather than a fallback. UIDs are stable per device, so
   re-importing after a schedule change replaces events instead of duplicating
   them.
2. **In-app catch-up.** Every prompt that came due while the app was shut is
   reconstructed from the rules on open, with the gap between when it was due
   and when the app noticed recorded as a fact. Nothing is ever lost, only seen
   late.
3. **Foreground checks.** Exact, but only while the app is open.
4. **Service worker + Periodic Background Sync.** Best-effort, and treated as
   such. Notification Triggers (`showTrigger`) would have solved this properly
   and never shipped. What remains is throttled by Chrome to roughly a
   twelve-hour minimum behind its own engagement heuristics, and Samsung's
   battery manager may suspend it outright. A one-time setup screen explains the
   three Android settings to change, and then the app still does not assume
   delivery worked.

The single-file build has no service worker at all, so it gets the calendar
export and the catch-up queue only.

## What it does not do

It shows that what you recorded has not changed since you recorded it, and in
what order things were written down. It does **not** prove that an event actually
happened, that an account is accurate, or when something occurred in the world.
It is not a notarisation and it is not legal advice.

It also has no backups. If you lose the device or clear its site data, the
records go with it — export a backup somewhere safe, and use
Settings → *Request persistent storage* so the browser does not evict the data.

## Viewing it

**Opening `index.html` by double-clicking it will not work, and shows a blank
page.** Browsers refuse to load a modern app's scripts over `file://`, so nothing
runs. There are two ways to actually see it.

**1. Serve it (the normal way).** Requires Node 20 or newer.

```bash
npm install
npm run dev        # development server
npm run build      # production build into dist/
npm run preview    # serve the production build, then open the URL it prints
npm test           # unit tests
```

If you are hosting it, publish the **`dist/` folder**, not the repository root.
The `index.html` at the root is a build template that points at TypeScript
source; serving it directly is exactly what produces a blank page. Because the
app uses hash routing, any static host works with no rewrite rules.

**2. Host it on GitHub Pages.** A workflow in `.github/workflows/deploy.yml`
builds the app and publishes it on every push. Pages must be set to
**Settings → Pages → Source → “GitHub Actions”** — this repository already is.

Do not set Pages to serve a branch root — that serves the build template and
produces the blank page described above. The published URL
(`https://<user>.github.io/<repo>/`) can be sent to anyone; the app is
installable from it, works offline afterwards, and still stores everything only
in that person's own browser.

**3. Build one portable file.**

```bash
npm run build:single    # writes dist-single/papertrail.html
```

That single file — about 350 KB, with the styles and scripts folded in and no
external requests — *can* be opened by double-clicking, mailed to someone, or
carried on a USB stick. It is the whole app, and it stores records normally.

Installing the served app to a phone home screen or desktop makes it available
offline and usually grants persistent storage.

If the app ever fails to start, it says so and explains why rather than showing
a blank page.

## How it is built

React, TypeScript, and Vite, with data in IndexedDB through Dexie. There is no
backend and no state outside the browser.

Two pieces are written from scratch on purpose, because they carry the app's
central claim and should not depend on a build-time library:

- `src/lib/zip.ts` — a store-method ZIP writer, and `src/lib/unzip.ts` its
  reader. Exports are mostly already-compressed media, so deflate would buy
  little.
- `src/db/ledger.ts` — the hash chain, over a canonical JSON encoding with keys
  sorted at every level. The encoding is deliberately simple enough to
  reimplement: the chain in any export can be re-walked in a few lines of
  Python or any other language, which is what makes the proof portable.
- `src/lib/ics.ts` — an RFC 5545 writer. Same reasoning: it carries the promise
  that a reminder actually fires. Times are floating local (no `TZID`, no
  `VTIMEZONE`), because a 21:00 check-in should be at 21:00 wherever the phone
  is, and a UTC instant would mean shipping a timezone database to say something
  the user did not ask for. Line folding counts octets and refuses to split a
  UTF-8 sequence — people name things in their own language.
- `src/lib/schedule.ts` — recurrence. See the note on tests below.

## Tests

```bash
npm test
```

Runs on Node's built-in `node:test`, which strips TypeScript directly — no test
framework, no runner config, no dependency. `scripts/test-resolve.mjs` is a
fifteen-line ESM resolve hook that lets Node follow the extensionless imports
the app uses, so the modules under test stay byte-identical to the ones that
ship rather than being rewritten to suit the harness. Tests are excluded from
the app's TypeScript project and never reach the bundle.

Coverage is aimed at the two places most likely to break silently:

- **Recurrence** — both daylight-saving transitions, the hour that does not
  exist on spring-forward, month-end dates in short months, leap-year February,
  and interval phase anchored to the start date rather than the epoch. `TZ` is
  pinned to a DST-observing zone so those cases are real on any machine,
  including a CI runner defaulting to UTC.
- **The timestamp migration** — that a complete row is left untouched and
  unflagged, that a missing value falls back to the other timestamp rather than
  to the clock, that the flag means "this was reconstructed" rather than
  "version 2 has seen this", and that running it twice changes nothing further.

```
src/
  db/       schema, the ledger, the timestamp migration, the reminder store,
            and the repository layer where every mutation writes a ledger line
  lib/      hashing, zip/unzip, export bundle and report, recurrence,
            calendar export, coverage, delivery, formatting
  routes/   timeline, cases, entry form and detail, check-in, reminders,
            history, guide, settings
  components/
  sw.ts     the service worker: precache, notifications, background sync
```

The PWA icons are generated by `node scripts/make-icons.mjs` rather than
committed as opaque binaries nobody can regenerate.

## A note on language

The interface avoids jargon on purpose. Users of an app like this are usually
having a bad time already and should not also have to learn what a hash is to
trust what they are looking at. Internally the log is a hash chain; on screen it
is "History", hashes are "fingerprints", and every screen carries a plain-language
explainer that answers the question a first-time user would actually ask. The
`/guide` route holds the longer version.

## A note on trust

Evidence usually arrives from someone you are in a dispute with, so files are
treated as hostile input: HTML and SVG are never rendered inline (a `blob:` URL
inherits this app's origin, and script in an evidence file would reach your
records), and the preview frame is fully sandboxed.
