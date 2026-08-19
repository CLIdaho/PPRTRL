import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'

import { AppShell } from './components/AppShell'
import { Timeline } from './routes/Timeline'
import { Cases } from './routes/Cases'
import { CaseDetail } from './routes/CaseDetail'
import { EntryDetail } from './routes/EntryDetail'
import { EntryForm } from './routes/EntryForm'
import { Ledger } from './routes/Ledger'
import { Settings } from './routes/Settings'
import { NotFound } from './routes/NotFound'
import { ensureTrailStarted } from './db/ledger'
import './styles/app.css'

void ensureTrailStarted()

// Keeps the offline copy current without prompting; there is no server-side
// state to reconcile, so taking the newest build is always right.
registerSW({ immediate: true })

const stored = localStorage.getItem('papertrail:theme')
if (stored === 'light' || stored === 'dark') {
  document.documentElement.dataset.theme = stored
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Hash routing so the app also works opened straight from the file system. */}
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Timeline />} />
          <Route path="cases" element={<Cases />} />
          <Route path="case/:caseId" element={<CaseDetail />} />
          <Route path="entry/new" element={<EntryForm />} />
          <Route path="entry/:entryId" element={<EntryDetail />} />
          <Route path="entry/:entryId/edit" element={<EntryForm />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
)
