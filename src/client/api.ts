import { ROUTE_DISCOVER, ROUTE_STATE, type DiscoverView, type StateView } from '../shared/protocol.ts'

/**
 * Fetch helpers for the two Host routes.
 *
 * Both routes answer `200` even on failure and put the outcome in the body, so
 * `ok`/`error` are checked here rather than relying on the HTTP status. The
 * browser carries the session cookie; nothing else has to be sent.
 */

/** One failed call: `HTTP <status>` for a transport failure, the body's message otherwise. */
async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const payload: unknown = await response.json()
  if (payload !== null && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
    const message = (payload as { error?: unknown }).error
    throw new Error(typeof message === 'string' ? message : 'request failed')
  }
  return payload as T
}

/** Read the Host state (never scans the filesystem). */
export function fetchState(signal?: AbortSignal): Promise<StateView> {
  return post<StateView>(ROUTE_STATE, {}, signal)
}

/**
 * Run one discovery sweep.
 * @param saved - the path currently in the form, kept selectable even unsaved.
 */
export function fetchCandidates(saved: string | undefined, signal?: AbortSignal): Promise<DiscoverView> {
  return post<DiscoverView>(ROUTE_DISCOVER, saved === undefined || saved === '' ? {} : { bashPath: saved }, signal)
}
