import { cleanupRateLimit } from './api/rate-limit.ts';
import { API_HEADERS, createApi } from './api/router.ts';
import type { StartInput } from './api/start.ts';
import { endStuckScans } from './db/store.ts';

/**
 * The API Worker of Website-Check DE (sessions A5 part 3 to 5): the API with D1, the hand-over of new
 * scans to the queue object, and the hourly cleanup. Not deployed before stage C.
 *
 * The Worker stays small (10 ms CPU per request on the free plan). Since A5 part 5 (Fedor's answer (a),
 * docs/decisions.md) it only accepts a start and passes it on: it parses the small request body,
 * normalizes the address and hands the start to the queue object, which runs the cache lookup, the DNS
 * check, the rate limit and the D1 writes; the object's answer goes back unparsed. Status and report are
 * one D1 read each. Since A5 part 4 it imports only `@website-check/scanner/api` (address rules,
 * normalized address); the queue object with the browser, axe-core and the rules data lives in the scan
 * Worker (`scan-worker.ts`). A unit test checks that nothing else reaches this Worker's import graph
 * (`worker/test/api-bundle.test.ts`). The secret `RATE_LIMIT_SECRET` belongs to the scan Worker.
 */

export interface Env {
  DB: D1Database;
  /** The queue (`ScanQueueObject` of the scan Worker, binding with `script_name`), reached in the EU jurisdiction. Missing in unit tests: a start then answers 503. */
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
  /** The whole start in the queue object (`POST /start`); its answer unparsed. */
  start(input: StartInput): Promise<Response>;
  position(id: string): Promise<number | null>;
  /** Session B2 part 2: "Prüfung abbrechen" (`POST /cancel`); throws when the object did not answer. */
  cancel(id: string, token: string): Promise<void>;
}

export function queueClient(stub: { fetch(input: string, init?: RequestInit): Promise<Response> }): QueueClient {
  return {
    start(input) {
      return stub.fetch(`${QUEUE_ORIGIN}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    },
    async cancel(id, token) {
      const response = await stub.fetch(`${QUEUE_ORIGIN}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, token }) });
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new Error(`cancel: HTTP ${response.status}`);
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
    return new Response(JSON.stringify({ error: 'misconfigured' }), { status: 503, headers: API_HEADERS });
  }
  const exempt = devExempt(env, request);
  const queue = env.SCAN_QUEUE === undefined ? null : queueClient(queueStub(env.SCAN_QUEUE, request, env.DEV_MODE === '1'));
  const api = createApi({
    db: env.DB,
    start: queue !== null ? (input) => queue.start(input) : () => Promise.reject(new Error('no queue binding')),
    ...(queue !== null ? { position: (id: string) => queue.position(id), cancel: (id: string, token: string) => queue.cancel(id, token) } : {}),
    ...(options.ratePerHour !== undefined ? { ratePerHour: options.ratePerHour } : {}),
    ...(options.force !== undefined ? { force: options.force } : {}),
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
