/**
 * The delivery layer, and an honest account of what each channel can promise.
 *
 * Ranked by how reliably a reminder actually reaches the user:
 *
 *   1. Calendar (.ics). The OS fires it. Works with the app closed, the phone
 *      asleep, and battery optimisation at its most aggressive. This is the only
 *      channel that keeps time.
 *   2. In-app catch-up. Rebuilt from the rules on every open, so nothing is ever
 *      permanently lost — only seen late.
 *   3. Foreground timer. Exact, but only while the app is actually open.
 *   4. Service worker + Periodic Background Sync. Best-effort. Chrome enforces a
 *      minimum interval near twelve hours and applies engagement heuristics;
 *      Samsung's battery manager may suspend it entirely. Notification Triggers
 *      (showTrigger) would have solved this properly and never shipped.
 *
 * Nothing here pretends otherwise, and the setup UI says the same.
 */

export const PERIODIC_TAG = 'papertrail-reminders'

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

export function notificationSupport(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as PermissionState
}

/**
 * Asks for notification permission.
 *
 * Called from a button on the setup screen, never on load: a permission prompt
 * fired at a stranger before they know what the app is gets denied, and a denial
 * is permanent until the user digs through browser settings to undo it.
 */
export async function requestNotificationPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission as PermissionState
  try {
    return (await Notification.requestPermission()) as PermissionState
  } catch {
    return 'denied'
  }
}

interface PeriodicSyncManager {
  register: (tag: string, options?: { minInterval: number }) => Promise<void>
  getTags: () => Promise<string[]>
  unregister: (tag: string) => Promise<void>
}

function periodicSync(reg: ServiceWorkerRegistration): PeriodicSyncManager | null {
  return (reg as ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager }).periodicSync ?? null
}

export interface BackgroundState {
  /** The browser exposes the API at all. */
  supported: boolean
  /** A registration exists. Says nothing about whether it will ever fire. */
  registered: boolean
  reason: string
}

/**
 * Registers for periodic background sync, best-effort.
 *
 * Chrome additionally requires the `periodic-background-sync` permission, which
 * it grants silently based on engagement rather than by asking — so a successful
 * registration here still does not mean a wake-up will happen.
 */
export async function enableBackgroundChecks(): Promise<BackgroundState> {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, registered: false, reason: 'This browser has no service worker support.' }
  }

  let reg: ServiceWorkerRegistration | undefined
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    return { supported: false, registered: false, reason: 'The offline worker is not running.' }
  }

  const sync = periodicSync(reg)
  if (!sync) {
    return {
      supported: false,
      registered: false,
      reason: 'This browser cannot wake the app in the background. Use the calendar file instead.',
    }
  }

  try {
    const permissions = navigator.permissions as Permissions & {
      query: (d: { name: string }) => Promise<PermissionStatus>
    }
    const status = await permissions.query({ name: 'periodic-background-sync' }).catch(() => null)
    if (status && status.state === 'denied') {
      return { supported: true, registered: false, reason: 'Background wake-ups are blocked for this site.' }
    }

    // Twelve hours is Chrome's practical floor; asking for less is silently
    // rounded up rather than honoured.
    await sync.register(PERIODIC_TAG, { minInterval: 12 * 60 * 60 * 1000 })
    return {
      supported: true,
      registered: true,
      reason: 'Registered. The browser decides when this actually runs, so treat it as a bonus.',
    }
  } catch (error) {
    return {
      supported: true,
      registered: false,
      reason: error instanceof Error ? error.message : 'Registration was refused.',
    }
  }
}

export async function backgroundStatus(): Promise<BackgroundState> {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, registered: false, reason: 'No service worker support.' }
  }
  try {
    const reg = await navigator.serviceWorker.ready
    const sync = periodicSync(reg)
    if (!sync) return { supported: false, registered: false, reason: 'Not available in this browser.' }
    const tags = await sync.getTags()
    return {
      supported: true,
      registered: tags.includes(PERIODIC_TAG),
      reason: tags.includes(PERIODIC_TAG) ? 'Registered, subject to the browser.' : 'Not registered.',
    }
  } catch {
    return { supported: false, registered: false, reason: 'Could not be checked.' }
  }
}

/** Shows a notification now, through the worker where there is one. */
export async function showNow(title: string, body: string, url = './#/check-in'): Promise<boolean> {
  if (notificationSupport() !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg) {
      await reg.showNotification(title, {
        body, icon: 'icon-192.png', badge: 'icon-192.png',
        tag: 'papertrail-reminder', data: { url },
      })
      return true
    }
    new Notification(title, { body, icon: 'icon-192.png' })
    return true
  } catch {
    return false
  }
}

/** Nudges the worker to look for due prompts, for when the app is backgrounded. */
export async function pokeWorker(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready
    reg?.active?.postMessage({ type: 'papertrail:check-prompts' })
  } catch {
    // The worker is optional; the catch-up queue covers this case anyway.
  }
}

/**
 * Re-checks for due prompts while the app is open. Returns a cancel function.
 *
 * A `setTimeout` aimed at the exact prompt time would be wrong twice over: it
 * drifts, and it does not survive the tab being frozen or the device sleeping —
 * which is most of the interval on a phone. Polling against the clock instead
 * means a device that wakes an hour late still notices on its next tick, and the
 * visibility listener catches the common case of the user simply coming back.
 */
export function scheduleForegroundCheck(onDue: () => void, everyMs = 60_000): () => void {
  const timer = setInterval(onDue, everyMs)

  const onVisible = () => {
    if (document.visibilityState === 'visible') onDue()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Whether the app is running from the home screen rather than a browser tab. */
export function isInstalled(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

/** Rough platform detection, only for showing the right setup instructions. */
export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent)
}

export function isSamsungInternet(): boolean {
  return /samsungbrowser/i.test(navigator.userAgent)
}
