import { normalizeSiteAddress } from '@website-check/scanner/api';
import { getReportText, getScan } from '../db/store.ts';
import { errorAnswer, refusal, scanBody, type Answer } from './answers.ts';
import { isCancelToken, isScanId } from './ids.ts';
import { visitorKeyOf } from './rate-limit.ts';
import { API_CSP, SITE_HEADERS } from './site-headers.ts';
import type { StartInput } from './start.ts';

/**
 * The API of the brief (sessions A5 part 2 and 5):
 *   POST /api/scans               {"url": "beispiel.de"} → 202 a new scan id, or 200 the scan of the same
 *                                 normalized address from the last 24 hours (`cached: true`)
 *   GET  /api/scans/{id}          status of the scan
 *   GET  /api/scans/{id}/report   the report JSON, exactly as stored
 *   POST /api/scans/{id}/cancel   {"token": "…"} → 204: "Prüfung abbrechen" of a scan in the queue (session B2 part 2)
 *
 * Since A5 part 5 (Fedor's answer (a), docs/decisions.md) the API Worker only accepts a start and passes it
 * on: it parses the small request body (at most 2 KB), normalizes the address (the address rules without
 * DNS: a refused address gets HTTP 400 here, before anything leaves the Worker), takes the visitor key of
 * the connection and hands the start to the queue object (`start.ts`: cache, day cap, DNS check, rate limit
 * and the D1 writes run there). The object's answer goes back to the visitor unparsed, with the API's
 * headers. Status and report are read here: one D1 read, and the place in the queue while a scan waits.
 * The Worker never parses a report. No response is indexed.
 */

export interface ApiDeps {
  db: D1Database;
  /** Hands the start to the queue object (`POST /start`); its answer goes back to the visitor unparsed. */
  start: (input: StartInput) => Promise<Response>;
  /** The place of a queued scan in the queue (0 running, 1 next); null when the queue does not know it. */
  position?: (id: string) => Promise<number | null>;
  /** Session B2 part 2: "Prüfung abbrechen" in the queue object; throws when the object did not answer. */
  cancel?: (id: string, token: string) => Promise<void>;
  /** Lab only: scans per hour per visitor (default 5, applied by the queue object). */
  ratePerHour?: number;
  /** Lab only: the queue runs the quick check. */
  force?: 'quick';
  /** Local `wrangler dev` only: exact fixture origins that skip the address rules (never set on Cloudflare). */
  exempt?: (url: URL) => boolean;
}

export const MAX_BODY_BYTES = 2048;

// Session B5 part 2: the security headers of the site on every answer of the API too (site-headers.ts), with a CSP and a
// Referrer-Policy of its own for JSON.
export const API_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'strict-transport-security': SITE_HEADERS['Strict-Transport-Security'],
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'permissions-policy': SITE_HEADERS['Permissions-Policy'],
  'x-frame-options': 'DENY',
  'content-security-policy': API_CSP,
};
const HEADERS = API_HEADERS;

function respond(a: Answer, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { ...HEADERS, ...(a.retryAfter !== undefined ? { 'retry-after': String(a.retryAfter) } : {}), ...extra } });
}

/** The statuses a start can answer with (A5 part 2 and 3); anything else from the object is its own failure. */
const START_STATUSES = new Set([200, 202, 400, 429, 503]);

/** Reads at most `MAX_BODY_BYTES`; null when the body is larger (the rest is not read). */
async function readSmallBody(request: Request): Promise<string | null> {
  const announced = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(announced) && announced > MAX_BODY_BYTES) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The small JSON body of a start or a cancel (at most `MAX_BODY_BYTES`), parsed in this one place. */
async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, response: respond(errorAnswer(415, 'unsupported-media-type')) };
  const text = await readSmallBody(request);
  if (text === null) return { ok: false, response: respond(errorAnswer(413, 'body-too-large')) };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: respond(errorAnswer(400, 'invalid-request')) };
  }
}

/** One field of a JSON object body; undefined for anything else. */
function fieldOf(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

async function startScan(request: Request, deps: ApiDeps): Promise<Response> {
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const input = fieldOf(read.body, 'url');
  if (typeof input !== 'string') return respond(errorAnswer(400, 'invalid-request'));

  const address = normalizeSiteAddress(input, deps.exempt);
  if (!address.ok) return respond(refusal(address.rejection));

  const handOver: StartInput = {
    url: address.url,
    visitor: visitorKeyOf(request.headers.get('cf-connecting-ip')),
    ...(deps.ratePerHour !== undefined ? { ratePerHour: deps.ratePerHour } : {}),
    ...(deps.force !== undefined ? { force: deps.force } : {}),
  };
  let answer: Response;
  try {
    answer = await deps.start(handOver);
  } catch {
    return respond(errorAnswer(503, 'queue-unavailable', {}, 60));
  }
  if (!START_STATUSES.has(answer.status)) {
    await answer.body?.cancel().catch(() => undefined);
    return respond(errorAnswer(503, 'queue-unavailable', {}, 60));
  }
  const retryAfter = answer.headers.get('retry-after');
  return new Response(answer.body, { status: answer.status, headers: { ...HEADERS, ...(retryAfter !== null && /^\d{1,7}$/.test(retryAfter) ? { 'retry-after': retryAfter } : {}) } });
}

/**
 * Session B2 part 2 (Fedor's answer 2): `POST /api/scans/{id}/cancel` with `{"token": "…"}`, the cancel token the
 * visitor got with the start. The queue object removes the visitor's token and the scan when nobody else waits for
 * it and it has not started. The answer is 204 whatever the queue did, so the call tells nobody whether other
 * visitors wait for the same address or whether a token was right.
 */
async function cancelScan(request: Request, id: string, deps: ApiDeps): Promise<Response> {
  const read = await readJsonBody(request);
  if (!read.ok) return read.response;
  const token = fieldOf(read.body, 'token');
  if (typeof token !== 'string' || !isCancelToken(token)) return respond(errorAnswer(400, 'invalid-request'));
  if (deps.cancel === undefined) return respond(errorAnswer(503, 'queue-unavailable', {}, 60));
  try {
    await deps.cancel(id, token);
  } catch {
    return respond(errorAnswer(503, 'queue-unavailable', {}, 60));
  }
  const { 'content-type': _type, ...headers } = HEADERS;
  return new Response(null, { status: 204, headers });
}

export function createApi(deps: ApiDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/scans') {
      if (request.method !== 'POST') return respond(errorAnswer(405, 'method-not-allowed'), { allow: 'POST' });
      return startScan(request, deps);
    }
    const cancel = /^\/api\/scans\/([^/]+)\/cancel$/.exec(path);
    if (cancel !== null) {
      if (request.method !== 'POST') return respond(errorAnswer(405, 'method-not-allowed'), { allow: 'POST' });
      const id = cancel[1] ?? '';
      if (!isScanId(id)) return respond(errorAnswer(404, 'not-found'));
      return cancelScan(request, id, deps);
    }
    const match = /^\/api\/scans\/([^/]+)(\/report)?$/.exec(path);
    if (match !== null) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return respond(errorAnswer(405, 'method-not-allowed'), { allow: 'GET, HEAD' });
      const id = match[1] ?? '';
      if (!isScanId(id)) return respond(errorAnswer(404, 'not-found'));
      if (match[2] === undefined) {
        const scan = await getScan(deps.db, id);
        if (scan === null) return respond(errorAnswer(404, 'not-found'));
        const position = scan.status === 'queued' && deps.position !== undefined ? await deps.position(id).catch(() => null) : null;
        return respond({ status: 200, body: scanBody(scan, false, position) });
      }
      const stored = await getReportText(deps.db, id);
      if (stored === null) return respond(errorAnswer(404, 'not-found'));
      if (stored.status !== 'done' || stored.report === null) return respond(errorAnswer(409, 'not-ready', { status: stored.status }));
      // The stored text as it is: the Worker never parses a report.
      return new Response(request.method === 'HEAD' ? null : stored.report, { status: 200, headers: HEADERS });
    }
    return respond(errorAnswer(404, 'not-found'));
  };
}
