import { parseIPv4, parseIPv6 } from '@website-check/scanner/api';

/**
 * Rate limit of the brief: 5 new scans per hour and 15 per UTC day per visitor, by a hash of the visitor's
 * IP address with a salt that changes every day. The raw address is never stored, logged or returned.
 *
 * Since session fix-a5 (review findings 89 and 91) every start that reaches the queue object counts too,
 * answered from the 24-hour cache or not: at most 20 per hour and 60 per UTC day (`START_LIMIT`), so the cache
 * cannot be asked without a limit which sites other visitors checked.
 *
 * What is stored (table `rate_state`, migration 0004): one row per visitor and UTC day with
 * - the visitor hash: HMAC-SHA-256 of the visitor key, keyed with a Worker secret (`RATE_LIMIT_SECRET`, set
 *   by Fedor; locally in `.dev.vars`) over the random salt of the UTC day (first 128 bits kept);
 * - the day;
 * - the state, encrypted (AES-GCM with a key derived from the secret and the day's salt, padded to a whole
 *   number of blocks): the times of the visitor's scans and starts of the last hour and the counts of the day.
 * So a copy of the database (an export, or a Time Travel restore) holds no time of any visitor: it cannot be
 * matched with the creation time of a scan (review finding 91: before, `rate_events.at` equalled
 * `scans.created_at` to the millisecond), and it says only that a pseudonym used the service on that day.
 * The secret is not in D1. The salt changes at 00:00 UTC and is deleted with the day's rows by the first start
 * of a new day and by the hourly cleanup, so hashes of different days cannot be linked even with the secret.
 *
 * IPv6 visitors are counted by their /56 network: one connection usually gets a /64 or a delegated /56
 * (often in Germany), and could otherwise change its address for every scan. A /48 would join unrelated
 * mobile customers.
 */

export const RATE_LIMIT = { scans: 5, windowMs: 60 * 60 * 1000 } as const;
/** At most this many accepted scans per visitor per UTC day. */
export const RATE_LIMIT_DAY = { scans: 15 } as const;
/** Starts per visitor that reach the queue object, a new scan or not (finding 89): four times the scan limits. */
export const START_LIMIT = { hour: 20, day: 60 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The secret must be long enough not to be guessed: at least 32 characters. */
export const MIN_SECRET_LENGTH = 32;
/** The plain state is padded to a multiple of this, so the length of a row does not tell how often a visitor came. */
const STATE_BLOCK = 1024;

/** The part of the address that identifies a visitor: an IPv4 address, or the first 56 bits of an IPv6 address. */
export function visitorKeyOf(ip: string | null): string {
  if (ip === null || ip.trim() === '') return 'unknown';
  const text = ip.trim();
  const v4 = parseIPv4(text);
  if (v4 !== null && /^[0-9.]+$/.test(text)) return `4:${v4}`;
  const v6 = parseIPv6(text);
  if (v6 !== null) {
    // An IPv4-mapped IPv6 address (::ffff:192.0.2.1) is the IPv4 visitor.
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) return `4:${((v6[6] ?? 0) * 65536 + (v6[7] ?? 0)) >>> 0}`;
    const prefix = [v6[0] ?? 0, v6[1] ?? 0, v6[2] ?? 0, (v6[3] ?? 0) & 0xff00];
    return `6:${prefix.map((g) => g.toString(16)).join(':')}/56`;
  }
  return 'unknown';
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text));

/** UTC day `YYYY-MM-DD`: the salt changes at 00:00 UTC, like Cloudflare's daily limits. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, utf8(message)));
}

/** HMAC-SHA-256 with the Worker secret of the day's salt and the visitor key; the first 128 bits as hex. */
export async function hashVisitor(secret: string, salt: string, key: string): Promise<string> {
  return hex((await hmac(secret, `${salt}|${key}`)).slice(0, 16));
}

/**
 * The salt of the day and that day. Created on the first scan of the day, never when the table already has
 * the salt of the same or a later day (a start that crosses midnight gets the newest salt, never an older
 * one). Salts and visitor rows of earlier days are deleted at the same time; the newest salt never is.
 */
export async function saltOfDay(db: D1Database, now: number, randomBytes: (n: number) => Uint8Array): Promise<{ day: string; salt: string }> {
  const day = utcDay(now);
  const results = await db.batch([
    db.prepare('INSERT INTO rate_salts (day, salt) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM rate_salts WHERE day >= ?1)').bind(day, hex(randomBytes(32))),
    db.prepare('DELETE FROM rate_salts WHERE day < ?1').bind(day),
    db.prepare('DELETE FROM rate_state WHERE day < ?1').bind(day),
    db.prepare('SELECT day, salt FROM rate_salts ORDER BY day DESC LIMIT 1'),
  ]);
  const newest = results[3]?.results[0] as { day?: string; salt?: string } | undefined;
  if (newest?.day === undefined || newest.salt === undefined) throw new Error('no salt for the day');
  return { day: newest.day, salt: newest.salt };
}

/** A visitor of one salt day: the hash that names the row, the day, and the key of the row's state. */
export interface RateVisitor {
  hash: string;
  day: string;
  key: CryptoKey;
}

export async function rateVisitor(secret: string, salt: { day: string; salt: string }, visitorKey: string): Promise<RateVisitor> {
  const hash = await hashVisitor(secret, salt.salt, visitorKey);
  const raw = await hmac(secret, `rate-state|${salt.salt}`);
  const key = await crypto.subtle.importKey('raw', raw.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { hash, day: salt.day, key };
}

/** The visitor's state of the day: scans and starts of the last hour (time, and a nonce for scans), counts of the day. */
export interface VisitorState {
  scans: [number, string][];
  starts: number[];
  dayScans: number;
  dayStarts: number;
}

const EMPTY_STATE: VisitorState = { scans: [], starts: [], dayScans: 0, dayStarts: 0 };

function base64(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

function unbase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function seal(visitor: RateVisitor, state: VisitorState): Promise<string> {
  const json = JSON.stringify(state);
  const padded = json + ' '.repeat((STATE_BLOCK - (json.length % STATE_BLOCK)) % STATE_BLOCK);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`${visitor.hash}|${visitor.day}`) }, visitor.key, utf8(padded)));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv, 0);
  out.set(sealed, iv.length);
  return base64(out);
}

function isState(value: unknown): value is VisitorState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.scans) &&
    v.scans.every((s) => Array.isArray(s) && typeof s[0] === 'number' && typeof s[1] === 'string') &&
    Array.isArray(v.starts) &&
    v.starts.every((t) => typeof t === 'number') &&
    typeof v.dayScans === 'number' &&
    typeof v.dayStarts === 'number'
  );
}

/** The decrypted state; a row that does not decrypt (another secret, a damaged row) counts as a fresh day. */
async function unseal(visitor: RateVisitor, text: string): Promise<VisitorState> {
  try {
    const bytes = unbase64(text);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(`${visitor.hash}|${visitor.day}`) }, visitor.key, bytes.slice(12));
    const value = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    return isState(value) ? value : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/** The visitor's row as stored (null when the visitor has none today) and its state. */
export interface LoadedState {
  stored: string | null;
  state: VisitorState;
}

export async function loadState(db: D1Database, visitor: RateVisitor): Promise<LoadedState> {
  const result = await db.prepare('SELECT state FROM rate_state WHERE visitor = ?1 AND day = ?2').bind(visitor.hash, visitor.day).all<{ state: string }>();
  const stored = result.results[0]?.state ?? null;
  return { stored, state: stored === null ? EMPTY_STATE : await unseal(visitor, stored) };
}

/** Writes the new state only if the row is still the one read (compare and set): false when another start changed it. */
async function storeState(db: D1Database, visitor: RateVisitor, stored: string | null, next: VisitorState): Promise<boolean> {
  const text = await seal(visitor, next);
  const statement =
    stored === null
      ? db.prepare('INSERT INTO rate_state (visitor, day, state) VALUES (?1, ?2, ?3) ON CONFLICT (visitor, day) DO NOTHING').bind(visitor.hash, visitor.day, text)
      : db.prepare('UPDATE rate_state SET state = ?3 WHERE visitor = ?1 AND day = ?2 AND state = ?4').bind(visitor.hash, visitor.day, text, stored);
  const result = await statement.run();
  return (result.meta.changes ?? 0) === 1;
}

/**
 * One read-modify-write of the visitor's state. `change` decides on the state read and returns the new state,
 * or null to write nothing. When another start of the same visitor changed the row in between, the row is read
 * again and `change` decides again, so two starts at the same moment cannot both take the last slot.
 */
async function updateState<T>(db: D1Database, visitor: RateVisitor, change: (state: VisitorState) => { next: VisitorState | null; result: T }, first?: LoadedState): Promise<T> {
  let loaded = first ?? (await loadState(db, visitor));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { next, result } = change(loaded.state);
    if (next === null || (await storeState(db, visitor, loaded.stored, next))) return result;
    loaded = await loadState(db, visitor);
  }
  throw new Error('the rate state changed too often');
}

function recent(state: VisitorState, now: number): VisitorState {
  const since = now - RATE_LIMIT.windowMs;
  return { ...state, scans: state.scans.filter(([at]) => at > since), starts: state.starts.filter((at) => at > since) };
}

/** Seconds from `now` to the end of the UTC `day` (00:00 UTC of the next day), at least 1. */
function secondsToEndOfDay(day: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + DAY_MS - now) / 1000));
}

function secondsUntilWindowFrees(oldest: number, now: number): number {
  return Math.max(1, Math.ceil((oldest + RATE_LIMIT.windowMs - now) / 1000));
}

export interface StartLimits {
  perHour: number;
  perDay: number;
}

export type StartResult = { allowed: true } | { allowed: false; retryAfterSeconds: number; limit: 'starts' };

function startRefusal(state: VisitorState, visitor: RateVisitor, now: number, limits: StartLimits): StartResult | null {
  if (state.dayStarts >= limits.perDay) return { allowed: false, retryAfterSeconds: secondsToEndOfDay(visitor.day, now), limit: 'starts' };
  if (state.starts.length >= limits.perHour) return { allowed: false, retryAfterSeconds: secondsUntilWindowFrees(Math.min(...state.starts), now), limit: 'starts' };
  return null;
}

/** Whether the visitor may start at all (read only): a refused start writes nothing. */
export async function checkStart(db: D1Database, visitor: RateVisitor, now: number, limits: StartLimits = { perHour: START_LIMIT.hour, perDay: START_LIMIT.day }): Promise<{ result: StartResult; loaded: LoadedState }> {
  const loaded = await loadState(db, visitor);
  return { result: startRefusal(recent(loaded.state, now), visitor, now, limits) ?? { allowed: true }, loaded };
}

/** Counts a start that is answered without a new scan (from the cache); refused without a write when the budget is used up. */
export function recordStart(db: D1Database, visitor: RateVisitor, now: number, limits: StartLimits = { perHour: START_LIMIT.hour, perDay: START_LIMIT.day }, first?: LoadedState): Promise<StartResult> {
  return updateState(
    db,
    visitor,
    (raw) => {
      const state = recent(raw, now);
      const refused = startRefusal(state, visitor, now, limits);
      if (refused !== null) return { next: null, result: refused };
      return { next: { ...state, starts: [...state.starts, now], dayStarts: state.dayStarts + 1 }, result: { allowed: true } as StartResult };
    },
    first,
  );
}

export type SlotResult =
  | { allowed: true; at: number; nonce: string }
  | { allowed: false; retryAfterSeconds: number; limit: 'hour' | 'day' | 'starts' };

/**
 * Takes one of the visitor's scan slots if fewer than `limit` (default `RATE_LIMIT.scans`) scans were taken in
 * the last hour and fewer than `dayLimit` (default `RATE_LIMIT_DAY.scans`) on the salt's day, and counts the
 * start in the same write. A start refused by the hour or the day still counts as a start (finding 89: a refusal
 * tells as much as an answer); a start beyond the start budget writes nothing. A refusal says which limit it
 * was (`day` when both).
 */
export function takeSlot(
  db: D1Database,
  visitor: RateVisitor,
  now: number,
  nonce: string,
  limit: number = RATE_LIMIT.scans,
  dayLimit: number = RATE_LIMIT_DAY.scans,
  starts: StartLimits = { perHour: START_LIMIT.hour, perDay: START_LIMIT.day },
  first?: LoadedState,
): Promise<SlotResult> {
  return updateState(
    db,
    visitor,
    (raw) => {
      const state = recent(raw, now);
      const refusedStart = startRefusal(state, visitor, now, starts);
      if (refusedStart !== null) return { next: null, result: refusedStart as SlotResult };
      const counted: VisitorState = { ...state, starts: [...state.starts, now], dayStarts: state.dayStarts + 1 };
      if (state.dayScans >= dayLimit) return { next: counted, result: { allowed: false, retryAfterSeconds: secondsToEndOfDay(visitor.day, now), limit: 'day' } as SlotResult };
      if (state.scans.length >= limit) {
        return { next: counted, result: { allowed: false, retryAfterSeconds: secondsUntilWindowFrees(Math.min(...state.scans.map(([at]) => at)), now), limit: 'hour' } as SlotResult };
      }
      return { next: { ...counted, scans: [...state.scans, [now, nonce]], dayScans: state.dayScans + 1 }, result: { allowed: true, at: now, nonce } as SlotResult };
    },
    first,
  );
}

/**
 * Gives a scan slot back (the visitor got the scan another visitor started at the same moment, or the scan
 * could not be created; review of A5 part 2). The start stays counted. Calling it twice gives it back once.
 */
export async function releaseSlot(db: D1Database, visitor: RateVisitor, slot: { at: number; nonce: string }): Promise<void> {
  await updateState(db, visitor, (state) => {
    const index = state.scans.findIndex(([at, nonce]) => at === slot.at && nonce === slot.nonce);
    if (index === -1) return { next: null, result: undefined };
    return { next: { ...state, scans: state.scans.filter((_, i) => i !== index), dayScans: Math.max(0, state.dayScans - 1) }, result: undefined };
  });
}

/**
 * The hourly cleanup (cron trigger of the Worker): deletes the salts and the visitor rows of earlier days even
 * when nobody starts a scan, so none outlives its day (review of A5 part 2).
 */
export async function cleanupRateLimit(db: D1Database, now: number): Promise<{ salts: number; states: number }> {
  const [salts, states] = await db.batch([db.prepare('DELETE FROM rate_salts WHERE day < ?1').bind(utcDay(now)), db.prepare('DELETE FROM rate_state WHERE day < ?1').bind(utcDay(now))]);
  return { salts: salts?.meta.changes ?? 0, states: states?.meta.changes ?? 0 };
}
