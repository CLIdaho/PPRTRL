import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '../db/db'
import { materialisePrompts } from '../db/reminders'
import { pokeWorker, scheduleForegroundCheck } from '../lib/notify'
import { QuickCaptureButton, QuickCaptureSheet } from './QuickCapture'
import { BellIcon, CaseIcon, LedgerIcon, SettingsIcon, TimelineIcon, BackIcon } from './icons'

const TABS = [
  { to: '/', label: 'Timeline', Icon: TimelineIcon, end: true },
  { to: '/cases', label: 'Cases', Icon: CaseIcon, end: false },
  { to: '/check-in', label: 'Check-in', Icon: BellIcon, end: false },
  { to: '/ledger', label: 'History', Icon: LedgerIcon, end: false },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon, end: false },
]

const ROOTS = new Set(TABS.map((t) => t.to))

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const atRoot = ROOTS.has(location.pathname)
  const [capturing, setCapturing] = useState(false)

  const pending = useLiveQuery(() => db.prompts.where('state').equals('pending').count(), [], 0)

  // The catch-up pass, and the reason a missed notification is never a lost
  // prompt: every reminder that came due while the app was shut is reconstructed
  // from the rules here, on open and on every return to the foreground.
  useEffect(() => {
    void materialisePrompts()
    return scheduleForegroundCheck(() => {
      void materialisePrompts()
      void pokeWorker()
    })
  }, [])

  // The service worker asks the app to navigate when a notification is tapped,
  // rather than opening a second window on top of the one already running.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; to?: string } | undefined
      if (data?.type === 'papertrail:navigate' && typeof data.to === 'string') navigate(data.to)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [navigate])

  return (
    <div className="shell">
      <header className="topbar">
        {atRoot ? (
          <span className="brand">
            <svg width="22" height="22" viewBox="0 0 512 512" aria-hidden="true">
              <rect width="512" height="512" rx="112" fill="var(--accent)" />
              <rect x="126" y="148" width="226" height="290" rx="22" fill="var(--accent-ink)" opacity="0.28" />
              <g fill="var(--accent-ink)">
                <rect x="158" y="192" width="162" height="16" rx="8" />
                <rect x="158" y="238" width="162" height="16" rx="8" />
                <rect x="158" y="284" width="162" height="16" rx="8" />
                <rect x="158" y="330" width="100" height="16" rx="8" />
              </g>
              <circle cx="352" cy="352" r="52" fill="var(--accent-ink)" />
            </svg>
            Papertrail
          </span>
        ) : (
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Go back">
            <BackIcon />
          </button>
        )}
        <div className="spacer" />
        <Link
          to="/guide"
          className="tiny"
          style={{ color: 'var(--text-faint)', textDecoration: 'none' }}
          title="Papertrail has no server and makes no network requests. Tap to learn how it works."
        >
          On this device only · Help
        </Link>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="tab-icon">
              <Icon />
              {to === '/check-in' && pending > 0 && (
                <span className="tab-badge" aria-label={`${pending} waiting`}>
                  {pending > 9 ? '9+' : pending}
                </span>
              )}
            </span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Always reachable, on every screen, so writing something down is never
          more than one tap away from wherever the user happens to be. */}
      <QuickCaptureButton onOpen={() => setCapturing(true)} />
      {capturing && <QuickCaptureSheet onClose={() => setCapturing(false)} />}
    </div>
  )
}
