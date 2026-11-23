/**
 * Constant-time comparison of two strings (no early exit on the first difference). A module of its own since
 * A5 part 4, so the lab API Worker (`e2e.ts`) can use it without the A2 lab handler, which imports the whole
 * scan core.
 */
export function sameToken(given: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
