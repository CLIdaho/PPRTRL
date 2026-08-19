import { useLiveQuery } from 'dexie-react-hooks'

/**
 * `useLiveQuery` returns `undefined` both while a query is in flight and when it
 * resolves to nothing, which makes "still loading" indistinguishable from "this
 * record is gone". Boxing the result separates the two.
 */
export function useRecord<T>(
  query: () => Promise<T | undefined>,
  deps: unknown[],
): { loading: true; value: undefined } | { loading: false; value: T | undefined } {
  const box = useLiveQuery(async () => ({ value: await query() }), deps, undefined)
  if (box === undefined) return { loading: true, value: undefined }
  return { loading: false, value: box.value }
}
