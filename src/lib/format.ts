const dateTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const dateOnly = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const dayHeading = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

export const formatDateTime = (ms: number) => dateTime.format(ms)
export const formatDate = (ms: number) => dateOnly.format(ms)
export const formatDayHeading = (ms: number) => dayHeading.format(ms)

/** ISO-8601 with the local offset kept, so an export says when *here* it was. */
export function isoLocal(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  )
}

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  const abs = Math.abs(diff)
  const min = 60_000
  if (abs < min) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [min, 'minute'], [60 * min, 'hour'], [24 * 60 * min, 'day'],
    [7 * 24 * 60 * min, 'week'], [30 * 24 * 60 * min, 'month'], [365 * 24 * 60 * min, 'year'],
  ]
  let chosen = steps[0]
  for (const step of steps) if (abs >= step[0]) chosen = step
  return rtf.format(-Math.round(diff / chosen[0]), chosen[1])
}

/** `datetime-local` input value for a timestamp, in local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): number {
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? Date.now() : ms
}

export function parseList(value: string): string[] {
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))]
}
