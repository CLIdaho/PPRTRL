import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { CaseIcon, LedgerIcon, SettingsIcon, TimelineIcon, BackIcon } from './icons'

const TABS = [
  { to: '/', label: 'Timeline', Icon: TimelineIcon, end: true },
  { to: '/cases', label: 'Cases', Icon: CaseIcon, end: false },
  { to: '/ledger', label: 'History', Icon: LedgerIcon, end: false },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon, end: false },
]

const ROOTS = new Set(TABS.map((t) => t.to))

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const atRoot = ROOTS.has(location.pathname)

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
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
