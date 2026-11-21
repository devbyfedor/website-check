import type { Capture, CaptureStrategy } from '@website-check/scanner';
import type { CaptureStats } from '../capture/common.ts';
import type { EnvironmentCheck } from '../capture/emulation.ts';

/**
 * Lab endpoint of session A2: measurement only, behind a token, no site and no storage.
 *
 * One browser session is opened, used for several tabs over several requests (one request per
 * page and strategy, so the Worker's CPU time can be read per page), and closed at the end.
 *
 *   GET  /lab/limits                          Browser Run limits and open sessions (no browser)
 *   POST /lab/session                         open a browser, returns its session id
 *   POST /lab/trace    {sessionId}            open the Cloudflare trace page: loc, colo, emulation check
 *   POST /lab/capture  {sessionId, url, strategy: "cdp-events" | "resource-timing"}
 *   POST /lab/close    {sessionId}            close the browser, returns its usage from history
 *
 * Every request needs `Authorization: Bearer <LAB_TOKEN>`. Without a configured token the
 * endpoint answers 503 to everything.
 */

export interface LabEnv {
  LAB_TOKEN?: string;
  /**
   * Dev switches for the local fixture site, passed only by `npm run lab:dev` (`wrangler dev --var`).
   * They are honoured only for requests to a loopback address, so they can never act on Cloudflare.
   */
  LAB_ALLOW_LOCAL?: string;
  LAB_TRACE_URL?: string;
}

export interface TraceResult {
  loc: string | null;
  colo: string | null;
  http: string | null;
  tls: string | null;
  environment: EnvironmentCheck | null;
  /** Setup steps the browser rejected (should be empty). */
  setupFailed?: string[];
}

export interface SessionUsage {
  sessionId: string;
  startTime: number | null;
  endTime: number | null;
  closeReasonText: string | null;
}

export interface LabDeps<E> {
  limits(env: E): Promise<unknown>;
  open(env: E): Promise<{ sessionId: string; browserVersion: string }>;
  /** `traceUrl` replaces the Cloudflare trace page only in local development. */
  trace(env: E, sessionId: string, traceUrl: string | null): Promise<TraceResult>;
  capture(env: E, sessionId: string, url: string, strategy: CaptureStrategy): Promise<{ capture: Capture; stats: CaptureStats }>;
  close(env: E, sessionId: string): Promise<SessionUsage | null>;
}

const STRATEGIES: readonly CaptureStrategy[] = ['cdp-events', 'resource-timing'];
const SESSION_ID = /^[A-Za-z0-9_-]{8,128}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}

/** Constant-time comparison of two strings (no early exit on the first difference). */
export function sameToken(given: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function authorized(request: Request, env: LabEnv): boolean {
  const token = env.LAB_TOKEN;
  if (token === undefined || token.length < 32) return false;
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match !== null && sameToken(match[1] ?? '', token);
}

/** Host names that must never be opened from the Cloudflare browser (lab-level check by name only; full SSRF protection comes in A5). */
const LOCAL_HOST = /^(?:localhost|.*\.localhost|.*\.local|.*\.internal|0\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

export function isScannableUrl(value: unknown, allowLocal = false): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username !== '' || url.password !== '') return false;
    return allowLocal || !LOCAL_HOST.test(url.hostname.replace(/\.$/, ''));
  } catch {
    return false;
  }
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sessionIdOf(input: Record<string, unknown> | null): string | null {
  const value = input?.['sessionId'];
  return typeof value === 'string' && SESSION_ID.test(value) ? value : null;
}

export function createLabHandler<E extends LabEnv>(deps: LabDeps<E>): (request: Request, env: E) => Promise<Response> {
  return async (request, env) => {
    if (env.LAB_TOKEN === undefined || env.LAB_TOKEN.length < 32) return json({ error: 'lab_disabled' }, 503);
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const { pathname, hostname } = new URL(request.url);
    const devMode = env.LAB_ALLOW_LOCAL === '1' && (hostname === '127.0.0.1' || hostname === 'localhost');
    const started = Date.now();
    try {
      if (pathname === '/lab/limits' && request.method === 'GET') return json(await deps.limits(env));
      if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (pathname === '/lab/session') return json({ ...(await deps.open(env)), workerWallMs: Date.now() - started });
      const input = await body(request);
      const sessionId = sessionIdOf(input);
      if (sessionId === null) return json({ error: 'bad_request', message: 'sessionId missing or invalid' }, 400);
      if (pathname === '/lab/trace') {
        const traceUrl = devMode && env.LAB_TRACE_URL !== undefined ? env.LAB_TRACE_URL : null;
        return json({ ...(await deps.trace(env, sessionId, traceUrl)), workerWallMs: Date.now() - started });
      }
      if (pathname === '/lab/close') return json({ usage: await deps.close(env, sessionId), workerWallMs: Date.now() - started });
      if (pathname === '/lab/capture') {
        const url = input?.['url'];
        const strategy = input?.['strategy'];
        if (!isScannableUrl(url, devMode)) return json({ error: 'bad_request', message: 'url must be a public http or https address' }, 400);
        if (typeof strategy !== 'string' || !STRATEGIES.includes(strategy as CaptureStrategy)) {
          return json({ error: 'bad_request', message: `strategy must be one of ${STRATEGIES.join(', ')}` }, 400);
        }
        const result = await deps.capture(env, sessionId, url, strategy as CaptureStrategy);
        return json({ ...result, workerWallMs: Date.now() - started });
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return json({ error: 'failed', message: message?.slice(0, 300) ?? 'unknown' }, 502);
    }
  };
}

/** Reads `key=value` lines of https://www.cloudflare.com/cdn-cgi/trace (only the keys we keep). */
export function parseTrace(text: string): Pick<TraceResult, 'loc' | 'colo' | 'http' | 'tls'> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return { loc: values.get('loc') ?? null, colo: values.get('colo') ?? null, http: values.get('http') ?? null, tls: values.get('tls') ?? null };
}
