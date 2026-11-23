import { normalizeSiteAddress, type UrlRejection, type UrlVerdict } from '@website-check/scanner/api';
import { createScan, findCachedScan, getReportText, getScan, markError, type ScanRow } from '../db/store.ts';
import { cryptoRandomBytes, isScanId, newScanId } from './ids.ts';
import { hashVisitor, MIN_SECRET_LENGTH, RATE_LIMIT, releaseSlot, saltOfDay, takeSlot, visitorKeyOf } from './rate-limit.ts';

/**
 * The API of the brief (session A5 part 2):
 *   POST /api/scans               {"url": "beispiel.de"} → 202 a new scan id, or 200 the scan of the same
 *                                 normalized address from the last 24 hours (`cached: true`)
 *   GET  /api/scans/{id}          status of the scan
 *   GET  /api/scans/{id}/report   the report JSON, exactly as stored
 *
 * An address the SSRF rules refuse gets HTTP 400 before anything is queued or counted: first the rules
 * without DNS, then the name is resolved (DNS over HTTPS in the Worker) and every address must be public.
 * The Durable Object checks again before the browser opens it (part 3).
 *
 * The Worker does little work per request (10 ms CPU on the free plan): it parses only the small request
 * body (at most 2 KB) and never the report, which it returns as the stored text. No response is indexed.
 */

export interface ApiDeps {
  db: D1Database;
  /** The SSRF guard with name resolution (`createUrlGuard` with `createDohResolver` in the Worker). */
  check: (url: string) => Promise<UrlVerdict>;
  /** Key of the visitor hash (Worker secret `RATE_LIMIT_SECRET`, at least 32 characters). Without it no scan starts. */
  secret: string | undefined;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
  /**
   * Hands a new scan to the queue (the Durable Object, session A5 part 3). Without it scans stay queued.
   * `undefined` counts as accepted (tests); a refusal of the day's cap answers 503 "daily-limit".
   */
  dispatch?: (scan: { id: string; url: string; createdAt: number }) => Promise<DispatchResult | void>;
  /** The place of a queued scan in the queue (0 running, 1 next); null when the queue does not know it. */
  position?: (id: string) => Promise<number | null>;
  /** Scans per hour per visitor (default `RATE_LIMIT.scans`, 5; the lab Worker may raise it). */
  ratePerHour?: number;
  /** Local `wrangler dev` only: exact fixture origins that skip the address rules (never set on Cloudflare). */
  exempt?: (url: URL) => boolean;
  /**
   * Remembers in this isolate until when the queue refuses new scans (its day cap), so further starts are
   * answered without writing to D1 (review of A5 part 3). Default: one object per isolate.
   */
  dailyGate?: { until: number };
}

/** The isolate's memory of the queue's day cap (Workers reuse an isolate for many requests). */
export const DAILY_GATE: { until: number } = { until: 0 };

export type DispatchResult = { accepted: true; position: number } | { accepted: false; reason: 'daily-limit'; retryAfterSeconds: number };

export const MAX_BODY_BYTES = 2048;

const HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function error(status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json(status, { error: code, ...extra }, headers);
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

function scanBody(scan: ScanRow, cached: boolean, queuePosition: number | null = null): Record<string, unknown> {
  return {
    id: scan.id,
    status: scan.status,
    state: scan.state,
    cached,
    // Only while the scan waits: its place in the queue (1 = next), shown by the scan screen (B2).
    queuePosition: scan.status === 'queued' ? queuePosition : null,
    createdAt: iso(scan.createdAt),
    startedAt: iso(scan.startedAt),
    finishedAt: iso(scan.finishedAt),
    country: scan.country,
    statusUrl: `/api/scans/${scan.id}`,
    reportUrl: `/api/scans/${scan.id}/report`,
  };
}

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

/** 400 codes for refused addresses; `reason` is the rule, never the address. */
function refusal(rejection: UrlRejection | null): Response {
  if (rejection === 'dns-error') return error(503, 'dns-unavailable', {}, { 'retry-after': '30' });
  if (rejection === 'unresolved') return error(400, 'address-not-found');
  if (rejection === null || rejection === 'invalid-url') return error(400, 'invalid-address');
  return error(400, 'address-not-allowed', { reason: rejection });
}

type Deps = Required<Omit<ApiDeps, 'dispatch' | 'position' | 'ratePerHour' | 'exempt'>> & Pick<ApiDeps, 'dispatch' | 'position' | 'ratePerHour' | 'exempt'>;

function dailyLimit(retryAfterSeconds: number): Response {
  return error(503, 'daily-limit', { retryAfterSeconds }, { 'retry-after': String(retryAfterSeconds) });
}

async function startScan(request: Request, deps: Deps): Promise<Response> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) return error(415, 'unsupported-media-type');
  const text = await readSmallBody(request);
  if (text === null) return error(413, 'body-too-large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return error(400, 'invalid-request');
  }
  const input = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { url?: unknown }).url : undefined;
  if (typeof input !== 'string') return error(400, 'invalid-request');

  const address = normalizeSiteAddress(input, deps.exempt);
  if (!address.ok) return refusal(address.rejection);
  const now = deps.now();

  const cached = await findCachedScan(deps.db, address.url, now);
  if (cached !== null) return json(200, scanBody(cached, true));
  // The queue refused new scans for today: answer without any D1 write (a cached report above is still served).
  if (deps.dailyGate.until > now) return dailyLimit(Math.max(1, Math.ceil((deps.dailyGate.until - now) / 1000)));

  const verdict = await deps.check(address.url);
  if (!verdict.allowed) return refusal(verdict.rejection);

  // Fail closed: without the secret the hashes could be reversed from the database alone.
  if (deps.secret === undefined || deps.secret.length < MIN_SECRET_LENGTH) return error(503, 'not-configured');
  const salt = await saltOfDay(deps.db, now, deps.randomBytes);
  const visitor = await hashVisitor(deps.secret, salt, visitorKeyOf(request.headers.get('cf-connecting-ip')));
  const slot = await takeSlot(deps.db, visitor, now, newScanId(deps.randomBytes).slice(0, 8), deps.ratePerHour ?? RATE_LIMIT.scans);
  if (!slot.allowed) return error(429, 'rate-limited', { retryAfterSeconds: slot.retryAfterSeconds }, { 'retry-after': String(slot.retryAfterSeconds) });

  let result: Awaited<ReturnType<typeof createScan>>;
  try {
    result = await createScan(deps.db, { id: newScanId(deps.randomBytes), url: address.url, host: address.host, now });
  } catch {
    await releaseSlot(deps.db, visitor, slot).catch(() => undefined);
    return error(503, 'unavailable', {}, { 'retry-after': '30' });
  }
  if (!result.created) {
    // Another visitor started the same address at the same moment: this one gets that scan and keeps its slot.
    await releaseSlot(deps.db, visitor, slot);
    return json(200, scanBody(result.scan, true));
  }
  let position: number | null = null;
  if (deps.dispatch !== undefined) {
    let dispatched: DispatchResult | void;
    try {
      dispatched = await deps.dispatch({ id: result.scan.id, url: address.url, createdAt: result.scan.createdAt });
    } catch {
      await markError(deps.db, result.scan.id, 'dispatch failed', deps.now());
      return error(503, 'queue-unavailable', {}, { 'retry-after': '60' });
    }
    if (dispatched !== undefined && !dispatched.accepted) {
      // The day's cap of the queue: no scan today. This isolate remembers it, so further starts write nothing,
      // and the visitor's slot is kept, so the hourly limit still bounds retries (review of A5 part 3).
      deps.dailyGate.until = Math.max(deps.dailyGate.until, now + dispatched.retryAfterSeconds * 1000);
      await markError(deps.db, result.scan.id, 'daily-limit', deps.now());
      return dailyLimit(dispatched.retryAfterSeconds);
    }
    position = dispatched?.position ?? null;
  }
  return json(202, scanBody(result.scan, false, position));
}

export function createApi(input: ApiDeps): (request: Request) => Promise<Response> {
  const deps = { now: () => Date.now(), randomBytes: cryptoRandomBytes, dailyGate: DAILY_GATE, ...input };
  return async (request) => {
    const path = new URL(request.url).pathname;
    if (path === '/api/scans') {
      if (request.method !== 'POST') return error(405, 'method-not-allowed', {}, { allow: 'POST' });
      return startScan(request, deps);
    }
    const match = /^\/api\/scans\/([^/]+)(\/report)?$/.exec(path);
    if (match !== null) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return error(405, 'method-not-allowed', {}, { allow: 'GET, HEAD' });
      const id = match[1] ?? '';
      if (!isScanId(id)) return error(404, 'not-found');
      if (match[2] === undefined) {
        const scan = await getScan(deps.db, id);
        if (scan === null) return error(404, 'not-found');
        const position = scan.status === 'queued' && deps.position !== undefined ? await deps.position(id).catch(() => null) : null;
        return json(200, scanBody(scan, false, position));
      }
      const stored = await getReportText(deps.db, id);
      if (stored === null) return error(404, 'not-found');
      if (stored.status !== 'done' || stored.report === null) return error(409, 'not-ready', { status: stored.status });
      // The stored text as it is: the Worker never parses a report.
      return new Response(request.method === 'HEAD' ? null : stored.report, { status: 200, headers: HEADERS });
    }
    return error(404, 'not-found');
  };
}
