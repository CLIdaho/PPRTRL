import { useEffect, useState } from 'react'

/** The Chrome-family event that lets a page trigger its own install flow. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED = 'papertrail:install-dismissed'

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates the standard and reports it on navigator instead.
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function useInstallState() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the event so the app can offer install at a sensible moment
      // rather than whenever the browser decides to ask.
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setEvent(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  return {
    installed,
    /** Chrome, Edge, Android: a real one-tap install. */
    canPromptDirectly: event !== null,
    /** iOS has no install API — the user has to be told where the button is. */
    needsManualSteps: !installed && event === null && isIos(),
    async install() {
      if (!event) return false
      await event.prompt()
      const { outcome } = await event.userChoice
      if (outcome === 'accepted') setInstalled(true)
      return outcome === 'accepted'
    },
  }
}

interface Props {
  /** Timeline shows a dismissible nudge; Settings shows it permanently. */
  dismissible?: boolean
}

export function InstallPrompt({ dismissible = false }: Props) {
  const { installed, canPromptDirectly, needsManualSteps, install } = useInstallState()
  const [hidden, setHidden] = useState(() => dismissible && localStorage.getItem(DISMISSED) === '1')

  if (installed) {
    return dismissible ? null : (
      <div className="banner ok">
        <span aria-hidden="true">✓</span>
        <div>Papertrail is installed on this device and works without internet.</div>
      </div>
    )
  }

  if (hidden || (!canPromptDirectly && !needsManualSteps)) return null

  return (
    <div className="install-card">
      <div className="grow">
        <strong>Add Papertrail to your home screen</strong>
        <p className="small muted" style={{ marginTop: 3 }}>
          It opens like a normal app, works with no internet, and your records are less likely to be
          cleared by the browser.
        </p>
        {needsManualSteps && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Tap the <strong>Share</strong> button at the bottom of Safari, then choose{' '}
            <strong>Add to Home Screen</strong>.
          </p>
        )}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        {canPromptDirectly && (
          <button className="btn primary" onClick={() => void install()}>
            Install
          </button>
        )}
        {dismissible && (
          <button
            className="btn ghost"
            onClick={() => {
              localStorage.setItem(DISMISSED, '1')
              setHidden(true)
            }}
          >
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
