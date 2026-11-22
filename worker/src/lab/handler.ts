import { precheckUrl, type Capture, type CaptureStrategy } from '@website-check/scanner';
import type { CaptureStats } from '../capture/common.ts';
import type { EnvironmentCheck } from '../capture/emulation.ts';
import { cpuWork, isValidSteps, MAX_CPU_STEPS } from './cpu.ts';

/**
 * Lab endpoint of session A2: measurement only, behind a token, no site and no storage.
 *
 * Since A2 part 2 the Worker only checks the token (`createLabGate`) and passes the job on to one
 * Durable Object in the EU jurisdiction, which runs the routes below (`createLabRoutes`): it opens
 * one browser session, uses it for several tabs over several requests (one request per page and
 * strategy, so the CPU time can be read per page), and closes it at the end.
 *
 *   GET  /lab/limits                          Browser Run limits and open sessions (no browser)
 *   POST /lab/cpu      {steps}                CPU load without a browser (experiment of part 2)
 *   POST /lab/session                         open a browser, returns its session id
 *   POST /lab/trace    {sessionId}            open the Cloudflare trace page: loc, colo, emulation check
 *   POST /lab/capture  {sessionId, url, strategy: "cdp-events" | "resource-timing"}
 *                                             since A3 strategy (a) also runs axe-core and the http redirect check
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
  /**
   * Session A5: exact origins of the local fixture site (comma-separated, for example
   * http://127.0.0.1:8790) that skip the SSRF host, port and address rules in dev mode. Every
   * other address, loopback included, is checked as on Cloudflare.
   */
  LAB_DEV_ORIGINS?: string;
}

export interface TraceResult {
  loc: string | null;
  colo: string | null;
  http: string | null;
  tls: string | null;
  environment: EnvironmentCheck | null;
  /** Setup steps the browser rejected (should be empty). */
  setupFailed?: string[];
  /**
   * Where the Durable Object itself runs (A2 part 2): the jurisdiction of its id, and `loc` and
   * `colo` of a request to the same trace page made by the object, not by the browser.
   */
  object?: { jurisdiction: string | null; loc: string | null; colo: string | null };
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
  /** `devOrigins`: in local wrangler dev, the fixture origins that the SSRF guard lets through (empty on Cloudflare). */
  capture(env: E, sessionId: string, url: string, strategy: CaptureStrategy, options: { devOrigins: readonly string[] }): Promise<{ capture: Capture; stats: CaptureStats }>;
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

/** The dev origins, honoured only in dev mode (dev switch and a loopback request address). */
export function devOriginsOf(env: LabEnv, devMode: boolean): string[] {
  if (!devMode || env.LAB_DEV_ORIGINS === undefined) return [];
  return env.LAB_DEV_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => /^https?:\/\/[^/]+$/.test(origin));
}

/** Exempts exactly the given origins (scheme, host and port), nothing else. */
export function exemptOrigins(origins: readonly string[]): ((url: URL) => boolean) | undefined {
  return origins.length === 0 ? undefined : (url) => origins.includes(url.origin);
}

/**
 * The job's address before it goes to the Durable Object: everything the SSRF guard can decide
 * without DNS (session A5). The Durable Object checks it again with DNS before the browser opens it.
 */
export function isScannableUrl(value: unknown, devOrigins: readonly string[] = []): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  const verdict = precheckUrl(value, exemptOrigins(devOrigins));
  return verdict === null || verdict.allowed;
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

type Handler<E> = (request: Request, env: E) => Promise<Response>;

/**
 * The Worker's part (A2 part 2): it checks the token and passes the job on to the Durable Object,
 * nothing else. The forwarded request keeps the URL (path, `label` for `wrangler tail`, host name
 * for the dev switches) and the small JSON body as text; the authorization header stays in the
 * Worker. The answer of the Durable Object goes back unchanged, so the Worker never parses a capture.
 */
export const MAX_JOB_BODY = 4_096;

export function createLabGate<E extends LabEnv>(forward: Handler<E>): Handler<E> {
  return async (request, env) => {
    if (env.LAB_TOKEN === undefined || env.LAB_TOKEN.length < 32) return json({ error: 'lab_disabled' }, 503);
    if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const text = hasBody ? await request.text() : '';
    if (text.length > MAX_JOB_BODY) return json({ error: 'bad_request', message: 'body too large' }, 413);
    const job = new Request(request.url, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      ...(hasBody ? { body: text } : {}),
    });
    try {
      return await forward(job, env);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return json({ error: 'forward_failed', message: message?.slice(0, 300) ?? 'unknown' }, 502);
    }
  };
}

/**
 * The Durable Object's part: the lab routes. Reached only through the gate (a Durable Object has
 * no public address), so it does not check the token again.
 */
export function createLabRoutes<E extends LabEnv>(deps: LabDeps<E>): Handler<E> {
  return async (request, env) => {
    const { pathname, hostname } = new URL(request.url);
    const devMode = env.LAB_ALLOW_LOCAL === '1' && (hostname === '127.0.0.1' || hostname === 'localhost');
    const started = Date.now();
    try {
      if (pathname === '/lab/limits' && request.method === 'GET') return json(await deps.limits(env));
      if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (pathname === '/lab/session') return json({ ...(await deps.open(env)), doWallMs: Date.now() - started });
      const input = await body(request);
      if (pathname === '/lab/cpu') {
        const steps = input?.['steps'];
        if (!isValidSteps(steps)) return json({ error: 'bad_request', message: `steps must be an integer from 1 to ${MAX_CPU_STEPS}` }, 400);
        return json({ steps, checksum: cpuWork(steps), doWallMs: Date.now() - started });
      }
      const sessionId = sessionIdOf(input);
      if (sessionId === null) return json({ error: 'bad_request', message: 'sessionId missing or invalid' }, 400);
      if (pathname === '/lab/trace') {
        const traceUrl = devMode && env.LAB_TRACE_URL !== undefined ? env.LAB_TRACE_URL : null;
        return json({ ...(await deps.trace(env, sessionId, traceUrl)), doWallMs: Date.now() - started });
      }
      if (pathname === '/lab/close') return json({ usage: await deps.close(env, sessionId), doWallMs: Date.now() - started });
      if (pathname === '/lab/capture') {
        const url = input?.['url'];
        const strategy = input?.['strategy'];
        const devOrigins = devOriginsOf(env, devMode);
        if (!isScannableUrl(url, devOrigins)) return json({ error: 'bad_request', message: 'url must be a public http or https address' }, 400);
        if (typeof strategy !== 'string' || !STRATEGIES.includes(strategy as CaptureStrategy)) {
          return json({ error: 'bad_request', message: `strategy must be one of ${STRATEGIES.join(', ')}` }, 400);
        }
        const result = await deps.capture(env, sessionId, url, strategy as CaptureStrategy, { devOrigins });
        return json({ ...result, doWallMs: Date.now() - started });
      }
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return json({ error: 'failed', message: message?.slice(0, 300) ?? 'unknown' }, 502);
    }
  };
}

/** Gate and routes in one process, as on Cloudflare but without the Durable Object (tests). */
export function createLabHandler<E extends LabEnv>(deps: LabDeps<E>): Handler<E> {
  return createLabGate(createLabRoutes(deps));
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
