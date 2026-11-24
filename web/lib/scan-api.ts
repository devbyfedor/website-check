import { REPORT_SCHEMA_VERSION, validateReport, type Report } from '@website-check/scanner/report';

// The API of the scan as the pages use it (session B2 part 2): start, status, report and "Prüfung abbrechen", all on
// our own host (`/api/...` of the API Worker). Every answer is checked before the page uses it: the status by its
// shape, the report with the scanner's own validator (docs/report-schema.md, "Strings of the scanned page").

const ID = /^[a-z2-7]{26}$/;
/** A request without an answer after this long counts as no answer (review of B2 part 2). */
const TIMEOUT_MS = 10_000;

/** A signal that aborts after `ms`; browsers without `AbortSignal.timeout` (Safari before 16) get a controller (review of B2 part 3). */
function timeout(ms: number): { signal?: AbortSignal } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms) };
  if (typeof AbortController !== 'function') return {};
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal };
}

/** Well formed for display; browsers without `toWellFormed` (before 2023) show the string as it is (a text node). */
const wellFormed = (s: string): string => (typeof s.toWellFormed === 'function' ? s.toWellFormed() : s);

export const isScanId = (value: string): boolean => ID.test(value);

export type ScanStatusName = 'queued' | 'running' | 'done' | 'error';

/** Why a scan ended without a report (session B2 part 3): its last visitor cancelled it, the day's cap, our error. */
export type ScanErrorReason = 'cancelled' | 'daily-limit' | 'other';

export interface ApiScan {
  id: string;
  status: ScanStatusName;
  /** The address the visitor entered, as the report writes it (`site.displayHost`); a string of the visitor. */
  displayHost: string | null;
  /** While the scan waits: its place (1 = next). */
  queuePosition: number | null;
  startedAt: string | null;
  /** Only in the answer to the start: the token for "Prüfung abbrechen". */
  cancelToken: string | null;
  /** Status `error` only: why the scan ended without a report; `other` for an unknown value. */
  errorReason: ScanErrorReason | null;
}

/**
 * Why the API refused a start (session B2 part 3), from its code: the address (`invalid`, `not-found`, `not-allowed`
 * with the rule), the visitor's limits (`rate`), the day's cap of the service (`busy`), or our own failure (`ours`,
 * also no answer at all). `retryAfter` is the `Retry-After` of the answer in seconds, else its `retryAfterSeconds`.
 */
export type Refusal =
  | { kind: 'invalid' }
  | { kind: 'not-found' }
  | { kind: 'not-allowed'; reason: AddressRule | null }
  | { kind: 'rate'; limit: 'hour' | 'day' | 'starts'; retryAfter: number | null }
  | { kind: 'busy'; retryAfter: number | null }
  | { kind: 'ours'; retryAfter: number | null };

/** The rules of an address the API names with `address-not-allowed` (`UrlRejection` of the scanner, without the ones it answers otherwise). */
export type AddressRule = 'scheme' | 'credentials' | 'port' | 'host-name' | 'address';
const ADDRESS_RULES: readonly AddressRule[] = ['scheme', 'credentials', 'port', 'host-name', 'address'];
const LIMITS = ['hour', 'day', 'starts'] as const;
/** A wait longer than two days is no answer we trust. */
const MAX_RETRY_SECONDS = 2 * 24 * 3600;

/** Seconds of a `Retry-After` header (a number of seconds; a date is not sent by our API), or of the body's field. */
function retryAfterOf(header: string | null, body: Record<string, unknown> | null): number | null {
  const fromHeader = header !== null && /^\d{1,7}$/.test(header.trim()) ? Number(header.trim()) : null;
  const fromBody = typeof body?.retryAfterSeconds === 'number' && Number.isInteger(body.retryAfterSeconds) ? body.retryAfterSeconds : null;
  const seconds = fromHeader ?? fromBody;
  return seconds !== null && seconds >= 0 && seconds <= MAX_RETRY_SECONDS ? seconds : null;
}

/** The refusal of a start from the status, the `Retry-After` header and the body of the answer. */
export function refusalOf(status: number, retryAfterHeader: string | null, body: unknown): Refusal {
  const b = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const code = typeof b?.error === 'string' ? b.error : null;
  const retryAfter = retryAfterOf(retryAfterHeader, b);
  if (status === 400 && code === 'invalid-address') return { kind: 'invalid' };
  if (status === 400 && code === 'address-not-found') return { kind: 'not-found' };
  if (status === 400 && code === 'address-not-allowed') {
    const reason = ADDRESS_RULES.find((r) => r === b?.reason) ?? null;
    return { kind: 'not-allowed', reason };
  }
  if (status === 429 && code === 'rate-limited') return { kind: 'rate', limit: LIMITS.find((l) => l === b?.limit) ?? 'hour', retryAfter };
  if (status === 503 && code === 'daily-limit') return { kind: 'busy', retryAfter };
  return { kind: 'ours', retryAfter };
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; status: number };

const STATUSES: readonly ScanStatusName[] = ['queued', 'running', 'done', 'error'];

/** The body of a scan in an answer of the API, checked field by field; null for anything else. */
export function parseScan(value: unknown): ApiScan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !ID.test(v.id)) return null;
  if (typeof v.status !== 'string' || !STATUSES.includes(v.status as ScanStatusName)) return null;
  const host = typeof v.displayHost === 'string' && v.displayHost.length > 0 && v.displayHost.length <= 253 ? wellFormed(v.displayHost) : null;
  const position = typeof v.queuePosition === 'number' && Number.isInteger(v.queuePosition) && v.queuePosition >= 0 && v.queuePosition <= 100_000 ? v.queuePosition : null;
  const startedAt = typeof v.startedAt === 'string' && !Number.isNaN(Date.parse(v.startedAt)) ? v.startedAt : null;
  const token = typeof v.cancelToken === 'string' && ID.test(v.cancelToken) ? v.cancelToken : null;
  const status = v.status as ScanStatusName;
  const errorReason: ScanErrorReason | null = status !== 'error' ? null : v.errorReason === 'cancelled' || v.errorReason === 'daily-limit' ? v.errorReason : 'other';
  return { id: v.id, status, displayHost: host, queuePosition: position, startedAt, cancelToken: token, errorReason };
}

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** `POST /api/scans`: 202 a new scan, 200 a scan from the cache; anything else is a refusal (session B2 part 3). */
export async function startScan(url: string): Promise<{ ok: true; value: ApiScan } | { ok: false; refusal: Refusal }> {
  let response: Response;
  try {
    response = await fetch('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }), ...timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, refusal: { kind: 'ours', retryAfter: null } };
  }
  if (response.status !== 200 && response.status !== 202) return { ok: false, refusal: refusalOf(response.status, response.headers.get('retry-after'), await json(response)) };
  const scan = parseScan(await json(response));
  return scan === null ? { ok: false, refusal: { kind: 'ours', retryAfter: null } } : { ok: true, value: scan };
}

/** `GET /api/scans/{id}`. Status 0: no answer, or an answer of the wrong shape. */
export async function fetchStatus(id: string): Promise<ApiResult<ApiScan>> {
  let response: Response;
  try {
    response = await fetch(`/api/scans/${id}`, { cache: 'no-store', ...timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.status !== 200) return { ok: false, status: response.status };
  const scan = parseScan(await json(response));
  return scan === null || scan.id !== id ? { ok: false, status: 0 } : { ok: true, value: scan };
}

/** `GET /api/scans/{id}/report`, shown only when its version is known and it passes the validator of the schema. */
export async function fetchReport(id: string): Promise<ApiResult<Report>> {
  let response: Response;
  try {
    response = await fetch(`/api/scans/${id}/report`, { cache: 'no-store', ...timeout(TIMEOUT_MS) });
  } catch {
    return { ok: false, status: 0 };
  }
  if (response.status !== 200) return { ok: false, status: response.status };
  const report = await json(response);
  if (typeof report !== 'object' || report === null || (report as { schemaVersion?: unknown }).schemaVersion !== REPORT_SCHEMA_VERSION) return { ok: false, status: 0 };
  try {
    if (validateReport(report).length > 0 || (report as Report).id !== id) return { ok: false, status: 0 };
  } catch {
    return { ok: false, status: 0 };
  }
  return { ok: true, value: report as Report };
}

/**
 * `POST /api/scans/{id}/cancel`: "Prüfung abbrechen" (Fedor's answer 2). `keepalive`, so the call is sent even while
 * the page goes on to the home page; the answer says nothing about what the queue did.
 */
export async function cancelScan(id: string, token: string): Promise<void> {
  try {
    await fetch(`/api/scans/${id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true });
  } catch {
    // The visitor goes to the home page anyway; a scan that stays in the queue runs and its report stays in the cache.
  }
}
