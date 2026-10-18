import type { Context } from '@deepseek-ai/cordis'

import { writeDiagnostic } from './diag.ts'
import { scanBashCandidates } from './discover.ts'
import type { ConfigSnapshot } from './config.ts'
import {
  ROUTE_DISCOVER,
  ROUTE_STATE,
  type CapabilityView,
  type CandidateView,
  type DiscoverView,
  type ReplaceReport,
  type StateView,
} from './shared/protocol.ts'

/**
 * The two exact `/api` routes the settings row reads.
 *
 * Writes deliberately do **not** go through here: the browser half edits this
 * plugin's own entry Config through the first-party `configForms` service, so a
 * save lands in the profile patch layer exactly like a first-party setting and
 * the loader reloads the fiber. These routes are a read/scan surface only.
 *
 * Both are `POST` because the client sends a JSON body (`{}` or the saved path)
 * and because the carrier authenticates every `/api` request anyway — there is
 * nothing cacheable to gain from `GET`.
 */

/** Services the routes need, read lazily so a headless composition still loads. */
interface RouteDeps {
  /** Current config snapshot (volatile fields resolve to the live value). */
  readonly readSnapshot: () => ConfigSnapshot
  /** Whether the replacement chain is available on this deployment. */
  readonly capability: () => CapabilityView
  /** Whether the Host settings service is visible (i.e. the form is writable). */
  readonly settingsAvailable: () => boolean
  /** Most recent per-session replacement attempt, if any. */
  readonly lastReplace: () => ReplaceReport | undefined
}

/** Minimal shape of `connection.fetch` as this plugin uses it. */
interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered' | 'stream'
  readonly fetch: (request: Request) => Promise<Response>
}

interface ConnectionLike {
  readonly fetch: { register(route: FetchRoute): () => void }
}

/** JSON response helper: always `200`, the body carries the outcome. */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Read a request body as JSON, tolerating an empty body. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** `Error`-ish values to a one-line message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Project an internal candidate onto the wire shape. */
function toView(candidate: { path: string; source: string }): CandidateView {
  return { path: candidate.path, source: candidate.source as CandidateView['source'], valid: true }
}

/**
 * Build the two route handlers.
 *
 * Extracted from {@link registerRoutes} so the selftest can drive them without
 * a live cordis app: they are pure functions of the deps plus the request body.
 */
export function createHandlers(deps: RouteDeps): {
  state: () => StateView
  discover: (body: Record<string, unknown>) => Promise<DiscoverView>
} {
  const state = (): StateView => {
    const snapshot = deps.readSnapshot()
    const lastReplace = deps.lastReplace()
    return {
      platform: process.platform,
      settingsAvailable: deps.settingsAvailable(),
      dialect: snapshot.dialect,
      bashPath: snapshot.bashPath,
      bashCandidates: snapshot.bashCandidates,
      capability: deps.capability(),
      ...(lastReplace === undefined ? {} : { lastReplace }),
    }
  }

  const discover = async (body: Record<string, unknown>): Promise<DiscoverView> => {
    const snapshot = deps.readSnapshot()
    // The client may pass the path currently in the form (which is not yet
    // saved); it takes priority over the persisted value so "自动发现" keeps a
    // half-typed path selectable.
    const inFlight = typeof body.bashPath === 'string' ? body.bashPath : ''
    const saved = inFlight.length > 0 ? inFlight : snapshot.bashPath
    const candidates = await scanBashCandidates({
      bashPath: saved,
      bashCandidates: snapshot.bashCandidates,
      autoDiscover: true,
      timeoutMs: snapshot.discoverTimeoutMs,
    })
    return { candidates: candidates.map(toView) }
  }

  return { state, discover }
}

/**
 * Register both routes against the Host `connection` service.
 *
 * `connection` is optional: in a headless composition there is no HTTP carrier,
 * so the row is simply absent and the plugin keeps working through the profile
 * patch alone. Registration is therefore behind `ctx.inject`.
 */
export function registerRoutes(ctx: Context, deps: RouteDeps): void {
  const handlers = createHandlers(deps)

  /** Mount both routes onto one resolved connection context. */
  const attach = (scoped: Context): void => {
    // `get` is the stable accessor: the service is also exposed as a property,
    // but only while the injection scope is the one that resolved it.
    const resolved = scoped.get('connection') as ConnectionLike | undefined
    const connection = resolved ?? (scoped as unknown as { connection?: ConnectionLike }).connection
    if (connection === undefined || connection === null || typeof connection.fetch?.register !== 'function') {
      writeDiagnostic('routes: ctx.connection.fetch is not visible; settings row will report no state')
      return
    }

    const route = (path: string, handler: (body: Record<string, unknown>) => unknown): FetchRoute => ({
      path,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        try {
          const body = await readBody(request)
          return jsonResponse(await handler(body), 200)
        } catch (error) {
          // A route must never 500: the client turns a non-ok response into a
          // bare `HTTP <status>` and loses the reason.
          writeDiagnostic(`route ${path} failed: ${messageOf(error)}`)
          return jsonResponse({ ok: false, error: messageOf(error) }, 200)
        }
      },
    })

    for (const path of [ROUTE_STATE, ROUTE_DISCOVER]) {
      const spec = path === ROUTE_STATE ? route(path, () => handlers.state()) : route(path, (body) => handlers.discover(body))
      const dispose = connection.fetch.register(spec)
      // Routes live exactly as long as the connection service does.
      scoped.effect(() => dispose, `terminal-tool: fetch route ${path}`)
    }
    writeDiagnostic('routes: registered /state and /discover')
  }

  try {
    ctx.inject(['connection'], (scoped: Context) => {
      attach(scoped)
    })
  } catch (error) {
    writeDiagnostic(`routes: cannot inject connection: ${messageOf(error)}`)
  }
}
