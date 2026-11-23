import type { UrlRejection } from '@website-check/scanner/api';
import type { ScanRow } from '../db/store.ts';

/**
 * Answers of the API as plain data (session A5 part 5), shared by the API Worker (status, report, refusals
 * of the address rules) and by the start of a scan in the queue object (`start.ts`). The API Worker turns
 * them into responses with its security headers (`router.ts`).
 */

export interface Answer {
  status: number;
  body: Record<string, unknown>;
  /** Seconds for the `Retry-After` header. */
  retryAfter?: number;
}

export function answer(status: number, body: Record<string, unknown>, retryAfter?: number): Answer {
  return retryAfter === undefined ? { status, body } : { status, body, retryAfter };
}

export function errorAnswer(status: number, code: string, extra: Record<string, unknown> = {}, retryAfter?: number): Answer {
  return answer(status, { error: code, ...extra }, retryAfter);
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

export function scanBody(scan: ScanRow, cached: boolean, queuePosition: number | null = null): Record<string, unknown> {
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

/** 400 codes for refused addresses; `reason` is the rule, never the address. */
export function refusal(rejection: UrlRejection | null): Answer {
  if (rejection === 'dns-error') return errorAnswer(503, 'dns-unavailable', {}, 30);
  if (rejection === 'unresolved') return errorAnswer(400, 'address-not-found');
  if (rejection === null || rejection === 'invalid-url') return errorAnswer(400, 'invalid-address');
  return errorAnswer(400, 'address-not-allowed', { reason: rejection });
}
