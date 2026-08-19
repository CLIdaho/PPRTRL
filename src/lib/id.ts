/** Collision-resistant ids that sort roughly by creation time. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, '0')
  const rand = crypto.getRandomValues(new Uint8Array(8))
  let tail = ''
  for (const b of rand) tail += b.toString(36).padStart(2, '0')
  return `${prefix}_${time}${tail}`
}
