import { normalizeSiteAddress, type UrlVerdict } from '@website-check/scanner/api';
import { createScan, findCachedScan, markError } from '../db/store.ts';
import { answer, errorAnswer, refusal, scanBody, type Answer } from './answers.ts';
import { cryptoRandomBytes, newScanId } from './ids.ts';
import { hashVisitor, MIN_SECRET_LENGTH, RATE_LIMIT, RATE_LIMIT_DAY, releaseSlot, saltOfDay, takeSlot } from './rate-limit.ts';

/**
 * The start of a scan (session A5 part 5, Fedor's answer (a), docs/decisions.md): runs in the queue object
 * (`ScanQueueObject` of the scan Worker), not in the API Worker. The API Worker only parses the request,
 * normalizes the address, takes the visitor key from the connection and hands this over (`POST /start` of
 * the object); the object has 30 s CPU per request, the API Worker 10 ms. Everything with round trips runs
 * here: the 24-hour cache in D1, the queue's day cap, the SSRF guard with DNS over HTTPS, the rate limit
 * (salt of the day, visitor hash with `RATE_LIMIT_SECRET`, slot), the new scan in D1 and the hand-over to
 * the queue. The order and the answers are those of A5 part 2 and 3.
 */

export interface StartInput {
  /** The normalized address (`normalizeSiteAddress` in the API Worker). */
  url: string;
  /** The visitor key of the connection (`visitorKeyOf`): an IPv4 address or an IPv6 /56, never stored; hashed here. */
  visitor: string;
  /** Lab only: scans per hour per visitor (the API's default is 5); the daily limit is 24 times this (the API's default is 15). */
  ratePerHour?: number;
  /** Lab only: run the quick check even when browser time is left. */
  force?: 'quick';
}

export type DispatchResult = { accepted: true; position: number } | { accepted: false; reason: 'daily-limit'; retryAfterSeconds: number };

export interface StartDeps {
  db: D1Database;
  /** The SSRF guard with name resolution (`createUrlGuard` with `createDohResolver`). */
  check: (url: string) => Promise<UrlVerdict>;
  /** Key of the visitor hash (secret `RATE_LIMIT_SECRET` of the scan Worker, at least 32 characters). Without it no scan starts. */
  secret: string | undefined;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
  /** Hands the new scan to the queue. Without it the scan stays queued (tests); `undefined` counts as accepted. */
  dispatch?: (scan: { id: string; url: string; createdAt: number }) => Promise<DispatchResult | void>;
  /**
   * Until when the queue refuses new scans (its day cap), so further starts are answered without writing to
   * D1 (review of A5 part 3). The queue object keeps one for all starts.
   */
  dailyGate: { until: number };
  /** Local `wrangler dev` only: exact fixture origins that skip the address rules (never set on Cloudflare). */
  exempt?: (url: URL) => boolean;
}

const MAX_URL = 2100;
const MAX_VISITOR = 64;
const MAX_LAB_RATE = 100;

/** The hand-over from the API Worker, checked: null for anything but the shape `queueClient.start` sends. */
export function parseStartInput(value: unknown, exempt?: (url: URL) => boolean): StartInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== 'string' || v.url.length > MAX_URL || typeof v.visitor !== 'string' || v.visitor === '' || v.visitor.length > MAX_VISITOR) return null;
  // Normalizing a normalized address changes nothing: anything else did not come from the API Worker.
  const again = normalizeSiteAddress(v.url, exempt);
  if (!again.ok || again.url !== v.url) return null;
  const input: StartInput = { url: v.url, visitor: v.visitor };
  if (v.ratePerHour !== undefined) {
    if (typeof v.ratePerHour !== 'number' || !Number.isInteger(v.ratePerHour) || v.ratePerHour < 1 || v.ratePerHour > MAX_LAB_RATE) return null;
    input.ratePerHour = v.ratePerHour;
  }
  if (v.force !== undefined) {
    if (v.force !== 'quick') return null;
    input.force = 'quick';
  }
  return input;
}

function dailyLimit(retryAfterSeconds: number): Answer {
  return errorAnswer(503, 'daily-limit', { retryAfterSeconds }, retryAfterSeconds);
}

export async function startScan(input: StartInput, deps: StartDeps): Promise<Answer> {
  const now = (deps.now ?? Date.now)();
  const randomBytes = deps.randomBytes ?? cryptoRandomBytes;
  const address = normalizeSiteAddress(input.url, deps.exempt);
  if (!address.ok) return refusal(address.rejection);

  const cached = await findCachedScan(deps.db, address.url, now);
  if (cached !== null) return answer(200, scanBody(cached, true));
  // The queue refused new scans for today: answer without any D1 write (a cached report above is still served).
  if (deps.dailyGate.until > now) return dailyLimit(Math.max(1, Math.ceil((deps.dailyGate.until - now) / 1000)));

  const verdict = await deps.check(address.url);
  if (!verdict.allowed) return refusal(verdict.rejection);

  // Fail closed: without the secret the hashes could be reversed from the database alone.
  if (deps.secret === undefined || deps.secret.length < MIN_SECRET_LENGTH) return errorAnswer(503, 'not-configured');
  // The name check can take time: the salt, the slot and the new scan use the time after it, not the first reading.
  const at = (deps.now ?? Date.now)();
  const { day, salt } = await saltOfDay(deps.db, at, randomBytes);
  const visitor = await hashVisitor(deps.secret, salt, input.visitor);
  // The lab's hourly rate gives a daily limit of 24 times as much; without it the limits are those of the brief.
  const perHour = input.ratePerHour ?? RATE_LIMIT.scans;
  const perDay = input.ratePerHour !== undefined ? input.ratePerHour * 24 : RATE_LIMIT_DAY.scans;
  const slot = await takeSlot(deps.db, visitor, at, newScanId(randomBytes).slice(0, 8), day, perHour, perDay);
  if (!slot.allowed) return errorAnswer(429, 'rate-limited', { retryAfterSeconds: slot.retryAfterSeconds, limit: slot.limit }, slot.retryAfterSeconds);

  let result: Awaited<ReturnType<typeof createScan>>;
  try {
    result = await createScan(deps.db, { id: newScanId(randomBytes), url: address.url, host: address.host, now: at });
  } catch {
    await releaseSlot(deps.db, visitor, slot).catch(() => undefined);
    return errorAnswer(503, 'unavailable', {}, 30);
  }
  if (!result.created) {
    // Another visitor started the same address at the same moment: this one gets that scan and its slot is given back.
    await releaseSlot(deps.db, visitor, slot);
    return answer(200, scanBody(result.scan, true));
  }
  let position: number | null = null;
  if (deps.dispatch !== undefined) {
    let dispatched: DispatchResult | void;
    try {
      dispatched = await deps.dispatch({ id: result.scan.id, url: address.url, createdAt: result.scan.createdAt });
    } catch {
      await markError(deps.db, result.scan.id, 'dispatch failed', (deps.now ?? Date.now)());
      return errorAnswer(503, 'queue-unavailable', {}, 60);
    }
    if (dispatched !== undefined && !dispatched.accepted) {
      // The day's cap of the queue: no scan today. The gate remembers it, so further starts write nothing,
      // and the visitor's slot is kept, so the hourly limit still bounds retries (review of A5 part 3).
      deps.dailyGate.until = Math.max(deps.dailyGate.until, at + dispatched.retryAfterSeconds * 1000);
      await markError(deps.db, result.scan.id, 'daily-limit', (deps.now ?? Date.now)());
      return dailyLimit(dispatched.retryAfterSeconds);
    }
    position = dispatched?.position ?? null;
  }
  return answer(202, scanBody(result.scan, false, position));
}

/** The answer as the queue object sends it back to the API Worker: the JSON body, the status and `Retry-After`. */
export function answerResponse(a: Answer): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (a.retryAfter !== undefined) headers['retry-after'] = String(a.retryAfter);
  return new Response(JSON.stringify(a.body), { status: a.status, headers });
}
