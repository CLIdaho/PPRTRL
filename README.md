# Papertrail

A local-first evidence log. You record what happened, attach whatever it came
with — photos, video, audio, PDFs, documents, anything digital — and Papertrail
keeps a tamper-evident record of it on your own device.

There is no account, no server, and no network request after the app is
installed. Nothing is uploaded, because there is nowhere to upload it to.

## What it does

**Records entries.** An entry is one thing that happened: a title, an account in
your own words, when it happened (distinct from when you wrote it down), who was
involved, where, and where the material came from. Entries can be filed under a
case or stand alone.

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
`certutil`. The reader needs neither Papertrail nor trust in it.

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
```

If you are hosting it, publish the **`dist/` folder**, not the repository root.
The `index.html` at the root is a build template that points at TypeScript
source; serving it directly is exactly what produces a blank page. Because the
app uses hash routing, any static host works with no rewrite rules.

**2. Host it on GitHub Pages.** A workflow in `.github/workflows/deploy.yml`
builds the app and publishes it on every push. It needs one setting turned on,
once: **Settings → Pages → Source → “GitHub Actions”**.

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

```
src/
  db/       schema, the ledger, and the repository layer where every
            mutation writes a ledger line
  lib/      hashing, zip/unzip, export bundle and report, formatting
  routes/   timeline, cases, entry form and detail, history, guide, settings
  components/
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
