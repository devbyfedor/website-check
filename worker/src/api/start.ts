import { normalizeSiteAddress, type UrlVerdict } from '@website-check/scanner/api';
import { createScan, findCachedScan, markError } from '../db/store.ts';
import { answer, errorAnswer, refusal, scanBody, type Answer } from './answers.ts';
import { cryptoRandomBytes, newScanId } from './ids.ts';
import { checkStart, MIN_SECRET_LENGTH, RATE_LIMIT, RATE_LIMIT_DAY, rateVisitor, recordStart, releaseSlot, saltOfDay, START_LIMIT, takeSlot, utcDay, type LoadedState, type StartLimits } from './rate-limit.ts';

/**
 * The start of a scan (session A5 part 5, Fedor's answer (a), docs/decisions.md): runs in the queue object
 * (`ScanQueueObject` of the scan Worker), not in the API Worker. The API Worker only parses the request,
 * normalizes the address, takes the visitor key from the connection and hands this over (`POST /start` of
 * the object); the object has 30 s CPU per request, the API Worker 10 ms. Everything with round trips runs
 * here: the 24-hour cache in D1, the queue's day cap, the SSRF guard with DNS over HTTPS, the rate limit
 * (salt of the day, visitor hash with `RATE_LIMIT_SECRET`, slot), the new scan in D1 and the hand-over to
 * the queue. The order and the answers are those of A5 part 2 and 3, with two changes of session fix-a5:
 * - the queue's day cap is read from the object's own storage first (finding 46): after the cap a start reads
 *   and writes nothing in D1, also when the address has a cached report (otherwise the refusal of a miss and
 *   the answer of a hit would tell which sites other visitors checked, without any cost);
 * - every start that passes the day cap counts against the visitor's start budget before the cache lookup,
 *   whether it is answered from the cache, refused or a new scan (finding 89).
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

/** `token`: the cancel token of the visitor who started the scan (session B2 part 2), kept by the queue with the job. */
export type DispatchResult = { accepted: true; position: number; token?: string } | { accepted: false; reason: 'daily-limit'; retryAfterSeconds: number };

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
  /**
   * The queue's day cap as stored in the object (finding 46: the gate above lives in memory and is lost when
   * the object is evicted): seconds until 00:00 UTC when no scan is accepted today any more, otherwise null.
   */
  dayCap?: (now: number) => Promise<number | null>;
  /** Local `wrangler dev` only: exact fixture origins that skip the address rules (never set on Cloudflare). */
  exempt?: (url: URL) => boolean;
  /**
   * Session B2 part 2: the visitor joins a scan that waits or runs (an answer from the cache): a cancel token of
   * their own, or null when the queue does not know the scan any more (it finished, or was cancelled a moment ago).
   */
  join?: (id: string) => Promise<string | null>;
}

const inProgress = (scan: { status: string }): boolean => scan.status === 'queued' || scan.status === 'running';

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
  const clock = deps.now ?? Date.now;
  const now = clock();
  const randomBytes = deps.randomBytes ?? cryptoRandomBytes;
  const address = normalizeSiteAddress(input.url, deps.exempt);
  if (!address.ok) return refusal(address.rejection);

  // The queue refused new scans for today: answer before any D1 read or write (findings 46 and 89).
  if (deps.dailyGate.until > now) return dailyLimit(Math.max(1, Math.ceil((deps.dailyGate.until - now) / 1000)));
  const capped = deps.dayCap === undefined ? null : await deps.dayCap(now);
  if (capped !== null) {
    deps.dailyGate.until = Math.max(deps.dailyGate.until, now + capped * 1000);
    return dailyLimit(capped);
  }

  // Fail closed: without the secret the hashes could be reversed from the database alone, and no start can be counted.
  if (deps.secret === undefined || deps.secret.length < MIN_SECRET_LENGTH) return errorAnswer(503, 'not-configured');
  const secret = deps.secret;
  // The lab's hourly rate gives a daily limit of 24 times as much; without it the limits are those of the brief.
  const perHour = input.ratePerHour ?? RATE_LIMIT.scans;
  const perDay = input.ratePerHour !== undefined ? input.ratePerHour * 24 : RATE_LIMIT_DAY.scans;
  const starts: StartLimits = input.ratePerHour !== undefined ? { perHour: perHour * 4, perDay: perDay * 4 } : { perHour: START_LIMIT.hour, perDay: START_LIMIT.day };

  // The start budget (finding 89), read only: a visitor who used it up learns nothing, whatever the address.
  let salt = await saltOfDay(deps.db, now, randomBytes);
  let visitor = await rateVisitor(secret, salt, input.visitor);
  const budget = await checkStart(deps.db, visitor, now, starts);
  if (!budget.result.allowed) return rateLimited(budget.result.retryAfterSeconds, budget.result.limit);

  const cached = await findCachedScan(deps.db, address.url, now);
  let first: LoadedState | undefined = budget.loaded;
  if (cached !== null) {
    // A cached answer takes no scan slot, but it is a start of the visitor's budget. Counted before the visitor joins
    // (review of B2 part 2), so a refused start leaves no token with the job that nobody holds.
    const counted = await recordStart(deps.db, visitor, now, starts, budget.loaded);
    if (!counted.allowed) return rateLimited(counted.retryAfterSeconds, counted.limit);
    first = undefined;
    // Session B2 part 2: the visitor joins a scan that waits or runs with a cancel token of their own. A scan that left
    // the queue between the read and the join (its last visitor cancelled it) is read again: D1 knows that by now.
    let shown: typeof cached | null = cached;
    let token: string | null = null;
    if (inProgress(cached) && deps.join !== undefined) {
      token = await deps.join(cached.id);
      if (token === null) {
        shown = await findCachedScan(deps.db, address.url, clock());
        if (shown !== null && inProgress(shown)) token = await deps.join(shown.id);
      }
    }
    // Nothing reusable any more: a new scan, as for a miss (this rare start then counts twice in the budget).
    if (shown !== null) return answer(200, scanBody(shown, true, null, { host: address.host, cancelToken: token }));
  }

  const verdict = await deps.check(address.url);
  if (!verdict.allowed) return refusal(verdict.rejection);

  // The name check can take time: the slot and the new scan use the time after it, not the first reading, and a
  // start that crossed midnight UTC meanwhile counts for the new day with the newest salt (finding 8).
  const at = clock();
  if (utcDay(at) !== salt.day) {
    salt = await saltOfDay(deps.db, at, randomBytes);
    visitor = await rateVisitor(secret, salt, input.visitor);
    first = undefined;
  }
  const slot = await takeSlot(deps.db, visitor, at, newScanId(randomBytes).slice(0, 8), perHour, perDay, starts, first);
  if (!slot.allowed) return rateLimited(slot.retryAfterSeconds, slot.limit);

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
    const joined = inProgress(result.scan) && deps.join !== undefined ? await deps.join(result.scan.id) : null;
    return answer(200, scanBody(result.scan, true, null, { host: address.host, cancelToken: joined }));
  }
  let position: number | null = null;
  let holderToken: string | null = null;
  if (deps.dispatch !== undefined) {
    let dispatched: DispatchResult | void;
    try {
      dispatched = await deps.dispatch({ id: result.scan.id, url: address.url, createdAt: result.scan.createdAt });
    } catch {
      await markError(deps.db, result.scan.id, 'dispatch failed', clock());
      return errorAnswer(503, 'queue-unavailable', {}, 60);
    }
    if (dispatched !== undefined && !dispatched.accepted) {
      // The day's cap was reached by starts that passed the check above at the same moment. The gate remembers it,
      // so further starts write nothing, and the visitor's slot is kept, so the hourly limit still bounds retries.
      deps.dailyGate.until = Math.max(deps.dailyGate.until, at + dispatched.retryAfterSeconds * 1000);
      await markError(deps.db, result.scan.id, 'daily-limit', clock());
      return dailyLimit(dispatched.retryAfterSeconds);
    }
    position = dispatched?.position ?? null;
    holderToken = dispatched?.token ?? null;
  }
  return answer(202, scanBody(result.scan, false, position, { host: address.host, cancelToken: holderToken }));
}

function rateLimited(retryAfterSeconds: number, limit: 'hour' | 'day' | 'starts'): Answer {
  return errorAnswer(429, 'rate-limited', { retryAfterSeconds, limit }, retryAfterSeconds);
}

/** The answer as the queue object sends it back to the API Worker: the JSON body, the status and `Retry-After`. */
export function answerResponse(a: Answer): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' };
  if (a.retryAfter !== undefined) headers['retry-after'] = String(a.retryAfter);
  return new Response(JSON.stringify(a.body), { status: a.status, headers });
}
