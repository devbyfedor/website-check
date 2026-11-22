import { parseIPv4, parseIPv6 } from '@website-check/scanner';

/**
 * Rate limit of the brief: 5 new scans per hour per visitor, by a hash of the visitor's IP address with
 * a salt that changes every day. The raw address is never stored, logged or returned: only an HMAC of it
 * (keyed with the salt of the UTC day) goes into D1, and the salt itself is deleted when the next day
 * starts, so a stored hash can no longer be tied to an address after that day.
 *
 * IPv6 visitors are counted by their /64 network, because one connection usually gets a whole /64 and
 * could otherwise change its address for every scan.
 */

export const RATE_LIMIT = { scans: 5, windowMs: 60 * 60 * 1000 } as const;

/** The part of the address that identifies a visitor: an IPv4 address, or the first 64 bits of an IPv6 address. */
export function visitorKeyOf(ip: string | null): string {
  if (ip === null || ip.trim() === '') return 'unknown';
  const text = ip.trim();
  const v4 = parseIPv4(text);
  if (v4 !== null && /^[0-9.]+$/.test(text)) return `4:${v4}`;
  const v6 = parseIPv6(text);
  if (v6 !== null) {
    // An IPv4-mapped IPv6 address (::ffff:192.0.2.1) is the IPv4 visitor.
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) return `4:${((v6[6] ?? 0) * 65536 + (v6[7] ?? 0)) >>> 0}`;
    return `6:${v6.slice(0, 4).map((g) => g.toString(16)).join(':')}`;
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

/** HMAC-SHA-256 of the visitor key with the day's salt, the first 128 bits as hex. */
export async function hashVisitor(salt: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(key)));
  return hex(mac.slice(0, 16));
}

/** The salt of the day: created on the first scan of the day; the salts of earlier days are deleted at the same time. */
export async function saltOfDay(db: D1Database, now: number, randomBytes: (n: number) => Uint8Array): Promise<string> {
  const day = utcDay(now);
  const results = await db.batch([
    db.prepare('INSERT INTO rate_salts (day, salt) VALUES (?1, ?2) ON CONFLICT (day) DO NOTHING').bind(day, hex(randomBytes(32))),
    db.prepare('DELETE FROM rate_salts WHERE day < ?1').bind(day),
    db.prepare('SELECT salt FROM rate_salts WHERE day = ?1').bind(day),
  ]);
  const salt = (results[2]?.results[0] as { salt?: string } | undefined)?.salt;
  if (salt === undefined) throw new Error('no salt for the day');
  return salt;
}

export type SlotResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Takes one of the visitor's slots if fewer than `RATE_LIMIT.scans` were taken in the last hour. The check
 * and the insert are one statement, so two requests at the same moment cannot both take the fifth slot.
 * Events older than the window are deleted in the same transaction.
 */
export async function takeSlot(db: D1Database, visitor: string, now: number, nonce: string): Promise<SlotResult> {
  const since = now - RATE_LIMIT.windowMs;
  const results = await db.batch([
    db.prepare('DELETE FROM rate_events WHERE at <= ?1').bind(since),
    db
      .prepare('INSERT INTO rate_events (visitor, at, nonce) SELECT ?1, ?2, ?3 WHERE (SELECT COUNT(*) FROM rate_events WHERE visitor = ?1 AND at > ?4) < ?5')
      .bind(visitor, now, nonce, since, RATE_LIMIT.scans),
    db.prepare('SELECT MIN(at) AS oldest FROM rate_events WHERE visitor = ?1 AND at > ?2').bind(visitor, since),
  ]);
  if ((results[1]?.meta.changes ?? 0) === 1) return { allowed: true };
  const oldest = (results[2]?.results[0] as { oldest?: number | null } | undefined)?.oldest ?? now;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + RATE_LIMIT.windowMs - now) / 1000)) };
}
