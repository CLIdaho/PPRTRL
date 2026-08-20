import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'

import { AppShell } from './components/AppShell'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Timeline } from './routes/Timeline'
import { Cases } from './routes/Cases'
import { CaseDetail } from './routes/CaseDetail'
import { EntryDetail } from './routes/EntryDetail'
import { EntryForm } from './routes/EntryForm'
import { Ledger } from './routes/Ledger'
import { CheckIn } from './routes/CheckIn'
import { Reminders } from './routes/Reminders'
import { Settings } from './routes/Settings'
import { Guide } from './routes/Guide'
import { NotFound } from './routes/NotFound'
import { ensureTrailStarted, recordMigration } from './db/ledger'
import './styles/app.css'

// Opening the database runs any pending schema upgrade. If that upgrade had to
// reconstruct a timestamp, the ledger says so — a silent rewrite of stored
// evidence is exactly what this app exists to make impossible.
void (async () => {
  await ensureTrailStarted()
  await recordMigration()
})()

// The offline copy is best-effort. A service worker that fails to register — an
// insecure origin, a browser with them disabled, a private window — must never
// stop the app itself from running.
void (async () => {
  try {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  } catch (error) {
    console.warn('Offline support unavailable:', error)
  }
})()

const stored = localStorage.getItem('papertrail:theme')
if (stored === 'light' || stored === 'dark') {
  document.documentElement.dataset.theme = stored
}

// Hash routing, so the app works when hosted from a subfolder or any static
// host without server-side rewrite rules.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Timeline />} />
            <Route path="cases" element={<Cases />} />
            <Route path="case/:caseId" element={<CaseDetail />} />
            <Route path="entry/new" element={<EntryForm />} />
            <Route path="entry/:entryId" element={<EntryDetail />} />
            <Route path="entry/:entryId/edit" element={<EntryForm />} />
            <Route path="check-in" element={<CheckIn />} />
            <Route path="reminders" element={<Reminders />} />
            <Route path="ledger" element={<Ledger />} />
            <Route path="guide" element={<Guide />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)

// The app is up, so retire the "didn't start" fallback in index.html.
document.getElementById('boot')?.remove()

// Clear the traces of a recovery attempt: the flag that stops it looping, and
// the cache-busting parameter it added to the URL.
try {
  sessionStorage.removeItem('papertrail:recovery-attempted')
} catch {
  // Storage can be blocked entirely; nothing here is worth failing a load over.
}
if (location.search.includes('reload=')) {
  history.replaceState(null, '', location.pathname + location.hash)
}
