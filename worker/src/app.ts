import { createDohResolver, createUrlGuard } from '@website-check/scanner';
import { cleanupRateLimit } from './api/rate-limit.ts';
import { createApi, type DispatchResult } from './api/router.ts';
import { endStuckScans } from './db/store.ts';

/**
 * The Worker of Website-Check DE without the Durable Object class (session A5 part 3), so unit tests can
 * load it in Node: the API with D1, the hand-over of new scans to the queue object, and the hourly cleanup.
 * `index.ts` adds the Durable Object export. Not deployed before stage C.
 *
 * The Worker stays small (10 ms CPU per request on the free plan): it parses only the small request body
 * and the small answers of the queue object, never a capture or a report.
 */

export interface Env {
  DB: D1Database;
  /** Key of the visitor hash of the rate limit, set by Fedor as a Worker secret (locally in `.dev.vars`). */
  RATE_LIMIT_SECRET?: string;
  /** The queue (`ScanQueueObject`), reached in the EU jurisdiction. Missing in unit tests: scans then stay queued. */
  SCAN_QUEUE?: DurableObjectNamespace;
  /** Local `wrangler dev` only: "1" uses the plain namespace (workerd has no jurisdictions) for loopback requests. */
  DEV_MODE?: string;
  /** Local `wrangler dev` only, with DEV_MODE: exact origins of the fixture site that the address rules let through. */
  DEV_ORIGINS?: string;
}

/** The dev exemption: only with the dev switch, only for a request to a loopback address, only exact origins. */
export function devExempt(env: Env, request: Request): ((url: URL) => boolean) | undefined {
  const { hostname } = new URL(request.url);
  if (env.DEV_MODE !== '1' || (hostname !== '127.0.0.1' && hostname !== 'localhost')) return undefined;
  const origins = (env.DEV_ORIGINS ?? '').split(',').map((o) => o.trim()).filter((o) => /^https?:\/\/[^/]+$/.test(o));
  return origins.length === 0 ? undefined : (url) => origins.includes(url.origin);
}

const QUEUE_ORIGIN = 'https://queue.internal';
const QUEUE_NAME = 'queue';

/** The one queue object, in the EU jurisdiction; only in local `wrangler dev` (dev switch and a loopback address) the plain namespace. */
export function queueStub(namespace: DurableObjectNamespace, request: Request, devMode: boolean): DurableObjectStub {
  const { hostname } = new URL(request.url);
  const local = devMode && (hostname === '127.0.0.1' || hostname === 'localhost');
  const scoped = local ? namespace : namespace.jurisdiction('eu');
  return scoped.get(scoped.idFromName(QUEUE_NAME));
}

export interface QueueClient {
  dispatch(scan: { id: string; url: string; createdAt: number }): Promise<DispatchResult>;
  position(id: string): Promise<number | null>;
}

export function queueClient(stub: { fetch(input: string, init?: RequestInit): Promise<Response> }, options: { force?: 'quick' } = {}): QueueClient {
  return {
    async dispatch(scan) {
      const response = await stub.fetch(`${QUEUE_ORIGIN}/enqueue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scan, ...(options.force !== undefined ? { force: options.force } : {}) }),
      });
      if (!response.ok) throw new Error(`queue answered ${response.status}`);
      const body = (await response.json()) as DispatchResult;
      if (body.accepted === true && typeof body.position === 'number') return body;
      if (body.accepted === false && body.reason === 'daily-limit') return body;
      throw new Error('queue answer not understood');
    },
    async position(id) {
      const response = await stub.fetch(`${QUEUE_ORIGIN}/position?id=${encodeURIComponent(id)}`);
      if (!response.ok) return null;
      const body = (await response.json()) as { position?: unknown };
      return typeof body.position === 'number' ? body.position : null;
    },
  };
}

export async function handleRequest(request: Request, env: Env, options: { ratePerHour?: number; force?: 'quick' } = {}): Promise<Response> {
  // The dev switch belongs to local `wrangler dev` only: on any other host the Worker refuses to work with it,
  // so the queue object's dev settings (exempt fixture origins, a fixture trace page) can never act on Cloudflare.
  const { hostname } = new URL(request.url);
  if (env.DEV_MODE === '1' && hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  // One guard per request: a scan start resolves the visitor's address once (two DNS-over-HTTPS subrequests).
  const exempt = devExempt(env, request);
  const guard = createUrlGuard({ resolve: createDohResolver(), ...(exempt !== undefined ? { exempt } : {}) });
  const queue = env.SCAN_QUEUE === undefined ? null : queueClient(queueStub(env.SCAN_QUEUE, request, env.DEV_MODE === '1'), options.force !== undefined ? { force: options.force } : {});
  const api = createApi({
    db: env.DB,
    check: (url) => guard.check(url),
    secret: env.RATE_LIMIT_SECRET,
    ...(queue !== null ? { dispatch: (scan) => queue.dispatch(scan), position: (id) => queue.position(id) } : {}),
    ...(options.ratePerHour !== undefined ? { ratePerHour: options.ratePerHour } : {}),
    ...(exempt !== undefined ? { exempt } : {}),
  });
  return api(request);
}

export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  await cleanupRateLimit(env.DB, controller.scheduledTime);
  // Backstop of the queue's own recovery: a scan that waits or runs for half an hour will not finish.
  await endStuckScans(env.DB, controller.scheduledTime);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
  scheduled,
} satisfies ExportedHandler<Env>;
