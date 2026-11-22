import { precheckUrl, type UrlRejection } from '../security/ssrf.ts';

/**
 * The address a visitor enters, normalized (session A5). The scan checks only the homepage and the
 * Impressum, so the normalized address is scheme, host and "/": path, query and fragment are dropped,
 * the host is lower case without a trailing dot, the default port is dropped. "beispiel.de" becomes
 * "https://beispiel.de/". "www.beispiel.de" stays its own address: the scan starts where the visitor said.
 * The 24-hour cache of the API uses this address as its key.
 */

export const MAX_ADDRESS_INPUT = 2048;

export type AddressError =
  /** Nothing entered, or the input is longer than `MAX_ADDRESS_INPUT`, or it holds spaces or control characters. */
  | 'invalid-input'
  /** Refused by the SSRF rules without DNS (`precheckUrl`): see the rejection. */
  | 'not-allowed'
  | 'invalid-url';

export type NormalizedAddress =
  | { ok: true; url: string; host: string }
  | { ok: false; error: AddressError; rejection: UrlRejection | null; detail: string };

export function normalizeSiteAddress(input: string): NormalizedAddress {
  const trimmed = input.trim();
  if (trimmed === '' || trimmed.length > MAX_ADDRESS_INPUT || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    return { ok: false, error: 'invalid-input', rejection: null, detail: 'empty, too long, or with spaces or control characters' };
  }
  // "beispiel.de" and "beispiel.de:8080" get https://; "ftp://…", "javascript:…" keep their scheme and are refused below.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'invalid-url', rejection: 'invalid-url', detail: 'not a valid web address' };
  }
  const verdict = precheckUrl(url);
  if (verdict !== null && !verdict.allowed) {
    return { ok: false, error: verdict.rejection === 'invalid-url' ? 'invalid-url' : 'not-allowed', rejection: verdict.rejection, detail: verdict.detail };
  }
  const host = url.hostname.replace(/\.$/, '');
  if (host === '') return { ok: false, error: 'invalid-url', rejection: 'invalid-url', detail: 'no host name' };
  const port = url.port === '' ? '' : `:${url.port}`;
  return { ok: true, url: `${url.protocol}//${host}${port}/`, host };
}

// ---------------------------------------------------------------------------------------------
// Punycode (RFC 3492) decoding, for showing umlaut domains as the visitor wrote them.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitOf(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 22;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return BASE;
}

/** Decodes one punycode label (without "xn--"); null when it is not valid punycode. */
export function decodePunycodeLabel(input: string): string | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(delimiter, 0); j += 1) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let index = delimiter > 0 ? delimiter + 1 : 0; index < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitOf(input.charCodeAt(index));
      index += 1;
      if (digit >= BASE) return null;
      i += digit * w;
      if (i > 0x7fffffff) return null;
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
      if (w > 0x7fffffff) return null;
    }
    const length = output.length + 1;
    bias = adapt(i - oldi, length, oldi === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff) return null;
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

/** "xn--mller-kva.de" becomes "müller.de"; labels that do not decode stay as they are. */
export function hostToUnicode(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label;
      return decodePunycodeLabel(label.slice(4).toLowerCase()) ?? label;
    })
    .join('.');
}

/** For the head and the title block of the report: Unicode, without a leading "www.". */
export function displayHostOf(host: string): string {
  const unicode = hostToUnicode(host);
  return /^www\.[^.]+\.[^.]/.test(unicode) ? unicode.slice(4) : unicode;
}
