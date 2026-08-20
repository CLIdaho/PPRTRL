/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
  registration: ServiceWorkerRegistration & {
    periodicSync?: { getTags: () => Promise<string[]> }
  }
}

/**
 * Papertrail's service worker.
 *
 * Two jobs, and it is worth being precise about how well it does each:
 *
 *   1. Offline. It precaches the app shell, which is the whole app — there is no
 *      network content to cache because there is no server. This part is
 *      reliable.
 *
 *   2. Reminders. This is best-effort and cannot be made otherwise. Notification
 *      Triggers (showTrigger) never shipped, so there is no way to ask the
 *      browser to fire a notification at a wall-clock time. What is left is
 *      Periodic Background Sync, which Chrome throttles to a minimum interval of
 *      roughly twelve hours and gates behind its own engagement heuristics, and
 *      which Samsung's battery manager may suspend outright. A prompt may
 *      therefore arrive late, or not at all.
 *
 *      The app is built on that assumption rather than against it: the calendar
 *      export fires on time through the OS, and the in-app catch-up queue
 *      reconstructs every missed prompt from the rules on next open. This worker
 *      is the third channel, not the first.
 */

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

const PERIODIC_TAG = 'papertrail-reminders'
const DB_NAME = 'papertrail'

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * Reads pending prompts straight from IndexedDB.
 *
 * The worker cannot import Dexie's app-side helpers without dragging the whole
 * bundle in, so it opens the same database with raw IDB and reads only. It never
 * writes: a background wake-up must not be able to mutate evidence, and keeping
 * the worker read-only means a bug here can lose a notification but can never
 * corrupt the record.
 */
function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: IDBDatabase | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    try {
      const request = indexedDB.open(DB_NAME)
      request.onsuccess = () => done(request.result)
      request.onerror = () => done(null)
      // Never run a schema upgrade from the worker: the app owns migrations.
      request.onupgradeneeded = () => {
        try {
          request.transaction?.abort()
        } catch {
          // Aborting is best-effort; the guard below still refuses to proceed.
        }
        done(null)
      }
      request.onblocked = () => done(null)
      setTimeout(() => done(null), 3000)
    } catch {
      done(null)
    }
  })
}

interface DuePrompt {
  label: string
  dueAt: number
}

async function readDuePrompts(now: number): Promise<DuePrompt[]> {
  const db = await openDb()
  if (!db) return []
  if (!db.objectStoreNames.contains('prompts')) {
    db.close()
    return []
  }

  return new Promise((resolve) => {
    const out: DuePrompt[] = []
    try {
      const tx = db.transaction('prompts', 'readonly')
      const store = tx.objectStore('prompts')
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const row = cursor.value as { state?: string; label?: string; dueAt?: number }
        if (row?.state === 'pending' && typeof row.dueAt === 'number' && row.dueAt <= now) {
          out.push({ label: String(row.label ?? 'Papertrail reminder'), dueAt: row.dueAt })
        }
        cursor.continue()
      }
      tx.oncomplete = () => {
        db.close()
        resolve(out.sort((a, b) => a.dueAt - b.dueAt))
      }
      tx.onerror = () => {
        db.close()
        resolve([])
      }
    } catch {
      db.close()
      resolve([])
    }
  })
}

/** True when a window is already showing — no point interrupting someone using it. */
async function appIsVisible(): Promise<boolean> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return clients.some((c) => (c as WindowClient).visibilityState === 'visible')
}

async function notifyDue(): Promise<void> {
  if (await appIsVisible()) return

  const now = Date.now()
  const due = await readDuePrompts(now)
  if (due.length === 0) return

  const first = due[0]
  const title = due.length === 1 ? first.label : `${due.length} Papertrail reminders`
  const body = due.length === 1
    ? 'Did anything happen? Open Papertrail to record it, or mark the day as nothing to report.'
    : due.slice(0, 3).map((p) => p.label).join('\n')

  await self.registration.showNotification(title, {
    body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    // A stable tag replaces any earlier unread reminder rather than stacking a
    // pile of them on the lock screen after a few missed days.
    tag: 'papertrail-reminder',
    requireInteraction: false,
    data: { url: './#/check-in' },
  })
}

self.addEventListener('periodicsync', (event) => {
  const e = event as ExtendableEvent & { tag?: string }
  if (e.tag !== PERIODIC_TAG) return
  e.waitUntil(notifyDue())
})

// A plain one-off sync, which some engines deliver where periodicsync is
// unavailable. Same handler; still best-effort.
self.addEventListener('sync', (event) => {
  const e = event as ExtendableEvent & { tag?: string }
  if (e.tag !== PERIODIC_TAG) return
  e.waitUntil(notifyDue())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data?.url as string) ?? './#/check-in'

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if ('focus' in client) {
        await (client as WindowClient).focus()
        // Steer the already-open window rather than opening a second one.
        client.postMessage({ type: 'papertrail:navigate', to: '/check-in' })
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})

// Lets the page ask the worker to check now — used when the app is backgrounded
// rather than closed, where periodicsync would not fire at all.
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined
  if (data?.type === 'papertrail:check-prompts') {
    event.waitUntil?.(notifyDue())
  }
  if (data?.type === 'papertrail:skip-waiting') {
    void self.skipWaiting()
  }
})
