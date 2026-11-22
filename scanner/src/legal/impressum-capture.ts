/**
 * How long the second tab waits for the Impressum (session A4), shared by every capture adapter.
 *
 * Only text and links are read, so the tab waits for DOMContentLoaded and then only until the text
 * stops growing: no quiet network, no accessibility check, no screenshot in production. Fedor's rule
 * for A4: do not wait longer than the text and the links need.
 */

export const IMPRESSUM_SETTINGS = {
  /** Navigation up to DOMContentLoaded. */
  navigationTimeoutMs: 10_000,
  /** How often the text length is read while waiting. */
  pollMs: 250,
  /** After the load event: the text must keep its length for this long. */
  stableAfterLoadMs: 500,
  /** Before the load event (a slow image or script), or while the text is shorter than `minTextLength`: the text must keep its length for this long. */
  stableBeforeLoadMs: 1_500,
  /** A shorter text is probably still a loading placeholder ("Lade …"): no real Impressum is that short with header and footer. */
  minTextLength: 300,
  /** At most this long after DOMContentLoaded. */
  maxSettleMs: 4_000,
  /** Absolute limit for the whole tab, reading the text included. */
  hardLimitMs: 16_000,
} as const;

export interface TextWatch {
  /** Text length at the last poll, -1 before the first. */
  length: number;
  /** When the length last changed (ms since DOMContentLoaded). */
  changedAtMs: number;
}

/**
 * One poll of the wait: the new watch state and whether the text is ready. `nowMs` is the time since
 * DOMContentLoaded, `complete` whether the document's load event has fired.
 */
export function pollText(watch: TextWatch, length: number, complete: boolean, nowMs: number): { watch: TextWatch; done: 'text-stable' | 'max-wait' | null } {
  const next = length === watch.length ? watch : { length, changedAtMs: nowMs };
  if (nowMs >= IMPRESSUM_SETTINGS.maxSettleMs) return { watch: next, done: 'max-wait' };
  const stableFor = nowMs - next.changedAtMs;
  const needed = complete && length >= IMPRESSUM_SETTINGS.minTextLength ? IMPRESSUM_SETTINGS.stableAfterLoadMs : IMPRESSUM_SETTINGS.stableBeforeLoadMs;
  if (length > 0 && watch.length !== -1 && stableFor >= needed) return { watch: next, done: 'text-stable' };
  return { watch: next, done: null };
}
