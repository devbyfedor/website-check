import { parseIPv4, parseIPv6 } from '@website-check/scanner/api';

/**
 * Rate limit of the brief: 5 new scans per hour and 15 per UTC day per visitor, by a hash of the visitor's
 * IP address with a salt that changes every day. The raw address is never stored, logged or returned.
 *
 * What is stored: HMAC-SHA-256 of the visitor key, keyed with a Worker secret (`RATE_LIMIT_SECRET`, set
 * by Fedor; locally in `.dev.vars`) and the random salt of the UTC day (first 128 bits kept). The secret
 * is not in D1, so a copy of the database (an export, or a Time Travel restore that brings back a deleted
 * salt) is not enough to try all IPv4 addresses against a hash (review of A5 part 2: the event time can be
 * matched to the creation time of a scan). The salt changes at 00:00 UTC and is deleted by the hourly
 * cleanup, so hashes of different days cannot be linked even with the secret.
 *
 * Three tables: `rate_salts` (one salt per day), `rate_events` (hash and time of each scan of the last
 * hour, for the hourly limit) and `rate_daily` (hash, day and count, for the daily limit; it stores no
 * time). A start that crosses midnight keeps the newest salt (`saltOfDay`), and the day of that salt is
 * the day the count belongs to (fix-a4).
 *
 * IPv6 visitors are counted by their /56 network: one connection usually gets a /64 or a delegated /56
 * (often in Germany), and could otherwise change its address for every scan. A /48 would join unrelated
 * mobile customers.
 */

export const RATE_LIMIT = { scans: 5, windowMs: 60 * 60 * 1000 } as const;
/** At most this many accepted scans per visitor per UTC day. */
export const RATE_LIMIT_DAY = { scans: 15 } as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The secret must be long enough not to be guessed: at least 32 characters. */
export const MIN_SECRET_LENGTH = 32;

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

/** UTC day `YYYY-MM-DD`: the salt changes at 00:00 UTC, like Cloudflare's daily limits. */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** HMAC-SHA-256 with the Worker secret of the day's salt and the visitor key; the first 128 bits as hex. */
export async function hashVisitor(secret: string, salt: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${salt}|${key}`)));
  return hex(mac.slice(0, 16));
}

/**
 * The salt of the day and that day. Created on the first scan of the day, never when the table already has
 * the salt of the same or a later day (a start that crosses midnight gets the newest salt, never an older
 * one). Salts and daily counts of earlier days are deleted at the same time; the newest salt never is.
 */
export async function saltOfDay(db: D1Database, now: number, randomBytes: (n: number) => Uint8Array): Promise<{ day: string; salt: string }> {
  const day = utcDay(now);
  const results = await db.batch([
    db.prepare('INSERT INTO rate_salts (day, salt) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM rate_salts WHERE day >= ?1)').bind(day, hex(randomBytes(32))),
    db.prepare('DELETE FROM rate_salts WHERE day < ?1').bind(day),
    db.prepare('DELETE FROM rate_daily WHERE day < ?1').bind(day),
    db.prepare('SELECT day, salt FROM rate_salts ORDER BY day DESC LIMIT 1'),
  ]);
  const newest = results[3]?.results[0] as { day?: string; salt?: string } | undefined;
  if (newest?.day === undefined || newest.salt === undefined) throw new Error('no salt for the day');
  return { day: newest.day, salt: newest.salt };
}

export type SlotResult =
  | { allowed: true; at: number; nonce: string; day: string }
  | { allowed: false; retryAfterSeconds: number; limit: 'hour' | 'day' };

/** Seconds from `now` to the end of the UTC `day` (00:00 UTC of the next day), at least 1. */
function secondsToEndOfDay(day: string, now: number): number {
  return Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + DAY_MS - now) / 1000));
}

/**
 * Takes one of the visitor's slots if fewer than `limit` (default `RATE_LIMIT.scans`) were taken in the last hour
 * and fewer than `dayLimit` (default `RATE_LIMIT_DAY.scans`) on the UTC `day`, the day of the salt that hashed the
 * visitor. The check and the insert are one statement, so two requests at the same moment cannot both take the
 * last slot; the day's count goes up in the same transaction, only when this call's event exists. Events older
 * than the window are deleted in the same transaction. A refusal says which limit it was (`day` when both).
 */
export async function takeSlot(
  db: D1Database,
  visitor: string,
  now: number,
  nonce: string,
  day: string,
  limit: number = RATE_LIMIT.scans,
  dayLimit: number = RATE_LIMIT_DAY.scans,
): Promise<SlotResult> {
  const since = now - RATE_LIMIT.windowMs;
  const results = await db.batch([
    db.prepare('DELETE FROM rate_events WHERE at <= ?1').bind(since),
    db
      .prepare(
        `INSERT INTO rate_events (visitor, at, nonce) SELECT ?1, ?2, ?3
         WHERE (SELECT COUNT(*) FROM rate_events WHERE visitor = ?1 AND at > ?4) < ?5
           AND COALESCE((SELECT scans FROM rate_daily WHERE visitor = ?1 AND day = ?6), 0) < ?7`,
      )
      .bind(visitor, now, nonce, since, limit, day, dayLimit),
    db
      .prepare(
        `INSERT INTO rate_daily (visitor, day, scans) SELECT ?1, ?4, 1
         WHERE EXISTS (SELECT 1 FROM rate_events WHERE visitor = ?1 AND at = ?2 AND nonce = ?3)
         ON CONFLICT (visitor, day) DO UPDATE SET scans = scans + 1`,
      )
      .bind(visitor, now, nonce, day),
    db.prepare('SELECT MIN(at) AS oldest FROM rate_events WHERE visitor = ?1 AND at > ?2').bind(visitor, since),
    db.prepare('SELECT scans FROM rate_daily WHERE visitor = ?1 AND day = ?2').bind(visitor, day),
  ]);
  if ((results[1]?.meta.changes ?? 0) === 1) return { allowed: true, at: now, nonce, day };
  const dayCount = (results[4]?.results[0] as { scans?: number } | undefined)?.scans ?? 0;
  if (dayCount >= dayLimit) return { allowed: false, retryAfterSeconds: secondsToEndOfDay(day, now), limit: 'day' };
  const oldest = (results[3]?.results[0] as { oldest?: number | null } | undefined)?.oldest ?? now;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_LIMIT.windowMs - now) / 1000)), limit: 'hour' };
}

/**
 * Gives a slot back, the event and the day's count: the visitor got the scan another visitor started at the
 * same moment, or the scan could not be created (review of A5 part 2). Calling it twice gives it back once.
 */
export async function releaseSlot(db: D1Database, visitor: string, slot: { at: number; nonce: string; day: string }): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE rate_daily SET scans = scans - 1
         WHERE visitor = ?1 AND day = ?4 AND scans > 0
           AND EXISTS (SELECT 1 FROM rate_events WHERE visitor = ?1 AND at = ?2 AND nonce = ?3)`,
      )
      .bind(visitor, slot.at, slot.nonce, slot.day),
    db.prepare('DELETE FROM rate_events WHERE visitor = ?1 AND at = ?2 AND nonce = ?3').bind(visitor, slot.at, slot.nonce),
  ]);
}

/**
 * The hourly cleanup (cron trigger of the Worker): deletes the salts and the daily counts of earlier days and
 * events older than the window even when nobody starts a scan, so none outlives its time (review of A5 part 2).
 */
export async function cleanupRateLimit(db: D1Database, now: number): Promise<{ salts: number; events: number; daily: number }> {
  const [salts, events, daily] = await db.batch([
    db.prepare('DELETE FROM rate_salts WHERE day < ?1').bind(utcDay(now)),
    db.prepare('DELETE FROM rate_events WHERE at <= ?1').bind(now - RATE_LIMIT.windowMs),
    db.prepare('DELETE FROM rate_daily WHERE day < ?1').bind(utcDay(now)),
  ]);
  return { salts: salts?.meta.changes ?? 0, events: events?.meta.changes ?? 0, daily: daily?.meta.changes ?? 0 };
}
