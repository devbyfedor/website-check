import { CAPTURE_LIMITS, cutText } from '../capture/limits.ts';
import { LEGAL_LINK_RESERVE, LINK_SCAN_MAX } from '../capture/page-scripts.ts';
import type { PageLink, PageSnapshot, PlatformHints, SecurityMeta } from '../capture/types.ts';
import { PLATFORM_SELECTORS } from '../platform/fingerprints.ts';

/**
 * The quick check without a browser (session A5 part 3): the HTML of a page, as the server sent it, read
 * into the same `PageSnapshot` that the in-page scripts of the browser adapters return
 * (`TEXT_AND_LINKS`, `SNAPSHOT_EXPRESSION` and `IMPRESSUM_SNAPSHOT_EXPRESSION` in
 * `scanner/src/capture/page-scripts.ts`), so the analyzers run unchanged on it.
 *
 * Nothing here runs a script, loads a stylesheet or fetches anything. The page is parsed with a small,
 * tolerant HTML parser that follows the parts of the HTML standard that change the text and the links
 * (implied end tags, raw text elements, tables, foreign content, reopened unclosed links), and the
 * visible text is an approximation of `document.body.innerText` as Chromium computes it (block line
 * breaks, two for `<p>`, tabs between table cells, collapsed white space, `<pre>` kept). What static HTML
 * cannot know: CSS from style sheets (only the `style` attribute and the browser's default styles count),
 * content that scripts build or change, JavaScript globals (`platform.globals` is always empty).
 *
 * Every step is linear in the size of the page (no regular expression that can backtrack, bounded
 * look-ups), because the quick check runs in a Durable Object with a CPU limit on pages up to 2 MB.
 */

// ---------------------------------------------------------------------------------------------
// The caps of the in-page script (a unit test checks that they appear in its source)

/** Maximum text length (`MAX_TEXT` of the in-page script). */
export const SNAPSHOT_MAX_TEXT = CAPTURE_LIMITS.textLength;
/** Maximum number of links in document order (`MAX_LINKS`). */
export const SNAPSHOT_MAX_LINKS = CAPTURE_LIMITS.maxLinks;
/** Links beyond the cap that are still kept when their text or address names a legal page (`MAX_EXTRA_LINKS`). */
export const SNAPSHOT_MAX_EXTRA_LINKS = CAPTURE_LIMITS.extraLinks;
/** The words of legal links (`LEGAL_WORDS`), used as `/…/i`. */
export const SNAPSHOT_LEGAL_WORDS = 'impressum|imprint|anbieterkenn|legal|datenschutz|privacy|data protection|barrierefrei|accessib';
/** Characters of a link text. */
export const SNAPSHOT_LINK_TEXT_LENGTH = CAPTURE_LIMITS.linkTextLength;
/** Generator meta tags read, and characters of each. */
export const SNAPSHOT_MAX_GENERATORS = 5;
export const SNAPSHOT_GENERATOR_LENGTH = 120;
/** Characters of the `content` of a security meta tag. */
export const SNAPSHOT_META_LENGTH = CAPTURE_LIMITS.metaLength;

/** Characters of one link's text that are read at most (the label keeps 200 of them after collapsing white space). */
const LINK_TEXT_READ = 65536;
/**
 * Characters of link text that all links read together; past it a link reads at most `LINK_TEXT_MIN`. Without nested
 * links all link texts together are at most the page's text (a link of the legal-word test is read twice), so only
 * nested links on a hostile page reach it: 256 links nested in each other repeat the same text 256 times.
 */
const LINK_TEXT_BUDGET = 4_000_000;
const LINK_TEXT_MIN = 512;
/** Chromium attaches elements deeper than this to the parent of the current node (`kMaximumHTMLParserDOMTreeDepth`). */
const MAX_TREE_DEPTH = 512;
/** Copies of an unclosed link that the parser makes at most (a browser has no limit; a page that needs more is hostile). */
const MAX_LINK_CLONES = 10000;
/**
 * Characters of attributes that the copies of unclosed links carry in all. Every copy shares the attributes
 * of the link and every later step (style, address, the legal-word test) reads them again, so a link with a
 * 1 MB `style` reopened 10,000 times would cost minutes; real pages stay far below (10,000 copies of 400 characters).
 */
const MAX_CLONED_ATTRIBUTE_CHARS = 4_000_000;

// ---------------------------------------------------------------------------------------------
// Decoding

/** WHATWG windows-1252 for the bytes 0x80–0x9F (the other bytes are Latin-1); HTML uses the same table for numeric references. */
const C1_TABLE: readonly number[] = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

const UTF8_LABELS = new Set(['unicode-1-1-utf-8', 'unicode11utf8', 'unicode20utf8', 'utf-8', 'utf8', 'x-unicode20utf8']);
/** ISO-8859-1, Latin-1 and ASCII are decoded as windows-1252, as the Encoding standard does. */
const WINDOWS_1252_LABELS = new Set([
  'ansi_x3.4-1968', 'ascii', 'cp1252', 'cp819', 'csisolatin1', 'ibm819', 'iso-8859-1', 'iso-ir-100', 'iso8859-1', 'iso88591', 'iso_8859-1',
  'iso_8859-1:1987', 'l1', 'latin1', 'us-ascii', 'windows-1252', 'x-cp1252', 'x-user-defined',
]);
const UTF16LE_LABELS = new Set(['csunicode', 'iso-10646-ucs-2', 'ucs-2', 'unicode', 'unicodefeff', 'utf-16', 'utf-16le']);
const UTF16BE_LABELS = new Set(['unicodefffe', 'utf-16be']);
/** Single-byte labels that a runtime without legacy encodings rejects: decoded as windows-1252 (close for German text). */
const SINGLE_BYTE_LABEL = /^(?:iso[-_]?8859|iso-ir-|latin|l[1-9]$|windows-125|cp125|x-cp125|csisolatin)/;

/** Decodes windows-1252 by hand: exactly the WHATWG index, the same in every runtime. */
export function decodeWindows1252(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = 8192;
  for (let start = 0; start < bytes.length; start += chunk) {
    const end = Math.min(bytes.length, start + chunk);
    const codes = new Array<number>(end - start);
    for (let i = start; i < end; i += 1) {
      const b = bytes[i] as number;
      codes[i - start] = b >= 0x80 && b < 0xa0 ? (C1_TABLE[b - 0x80] as number) : b;
    }
    parts.push(String.fromCharCode(...codes));
  }
  return parts.join('');
}

const isAsciiSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d;

function trimAscii(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isAsciiSpace(s.charCodeAt(start))) start += 1;
  while (end > start && isAsciiSpace(s.charCodeAt(end - 1))) end -= 1;
  return start === 0 && end === s.length ? s : s.slice(start, end);
}

/** The encoding of a label, or null when the label names none. */
function encodingForLabel(raw: string): string | null {
  const label = trimAscii(raw).toLowerCase();
  if (label === '') return null;
  if (UTF8_LABELS.has(label)) return 'utf-8';
  if (WINDOWS_1252_LABELS.has(label)) return 'windows-1252';
  if (UTF16LE_LABELS.has(label)) return 'utf-16le';
  if (UTF16BE_LABELS.has(label)) return 'utf-16be';
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return SINGLE_BYTE_LABEL.test(label) ? 'windows-1252' : null;
  }
}

function decodeAs(bytes: Uint8Array, encoding: string): string {
  if (encoding === 'windows-1252') return decodeWindows1252(bytes);
  if (encoding === 'utf-16be') {
    try {
      return new TextDecoder('utf-16be', { fatal: false, ignoreBOM: false }).decode(bytes);
    } catch {
      const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        swapped[i] = bytes[i + 1] as number;
        swapped[i + 1] = bytes[i] as number;
      }
      return new TextDecoder('utf-16le', { fatal: false, ignoreBOM: false }).decode(swapped);
    }
  }
  try {
    return new TextDecoder(encoding, { fatal: false, ignoreBOM: false }).decode(bytes);
  } catch {
    return SINGLE_BYTE_LABEL.test(encoding) ? decodeWindows1252(bytes) : new TextDecoder('utf-8', { fatal: false, ignoreBOM: false }).decode(bytes);
  }
}

/** The `charset` parameter of a Content-Type header, or null. */
function charsetParameter(contentType: string): string | null {
  let i = contentType.indexOf(';');
  while (i !== -1) {
    const eq = contentType.indexOf('=', i + 1);
    if (eq === -1) return null;
    const semi = contentType.indexOf(';', i + 1);
    if (semi !== -1 && semi < eq) {
      i = semi;
      continue;
    }
    const name = trimAscii(contentType.slice(i + 1, eq)).toLowerCase();
    let start = eq + 1;
    while (start < contentType.length && isAsciiSpace(contentType.charCodeAt(start))) start += 1;
    let value: string;
    let next: number;
    if (contentType.charCodeAt(start) === 0x22) {
      const close = contentType.indexOf('"', start + 1);
      value = contentType.slice(start + 1, close === -1 ? contentType.length : close);
      next = close === -1 ? -1 : contentType.indexOf(';', close);
    } else {
      value = trimAscii(contentType.slice(start, semi === -1 ? contentType.length : semi));
      next = semi;
    }
    if (name === 'charset' && value !== '') return value;
    i = next;
  }
  return null;
}

/** "Extracting a character encoding from a meta element": the value after `charset=` in a `content` attribute. */
function charsetInContent(content: string): string | null {
  const lower = content.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf('charset', from);
    if (at === -1) return null;
    let j = at + 7;
    while (j < lower.length && isAsciiSpace(lower.charCodeAt(j))) j += 1;
    if (lower.charCodeAt(j) !== 0x3d) {
      from = at + 7;
      continue;
    }
    j += 1;
    while (j < lower.length && isAsciiSpace(lower.charCodeAt(j))) j += 1;
    const q = lower.charCodeAt(j);
    if (q === 0x22 || q === 0x27) {
      const close = lower.indexOf(q === 0x22 ? '"' : "'", j + 1);
      return close === -1 ? null : content.slice(j + 1, close);
    }
    let end = j;
    while (end < lower.length && !isAsciiSpace(lower.charCodeAt(end)) && lower.charCodeAt(end) !== 0x3b) end += 1;
    return end === j ? null : content.slice(j, end);
  }
}

interface PrescanAttribute {
  name: string;
  value: string;
}

/** "Get an attribute" of the prescan; null when the tag ends (`>`) or the bytes run out. */
function prescanAttribute(s: string, state: { i: number }): PrescanAttribute | null {
  const n = s.length;
  let i = state.i;
  while (i < n && (isAsciiSpace(s.charCodeAt(i)) || s.charCodeAt(i) === 0x2f)) i += 1;
  if (i >= n || s.charCodeAt(i) === 0x3e) {
    state.i = i;
    return null;
  }
  let name = '';
  let value = '';
  for (;;) {
    if (i >= n) {
      state.i = n;
      return null;
    }
    const c = s.charCodeAt(i);
    if (c === 0x3d && name !== '') {
      i += 1;
      break;
    }
    if (isAsciiSpace(c)) {
      while (i < n && isAsciiSpace(s.charCodeAt(i))) i += 1;
      if (s.charCodeAt(i) !== 0x3d) {
        state.i = i;
        return { name, value: '' };
      }
      i += 1;
      break;
    }
    if (c === 0x2f || c === 0x3e) {
      state.i = i;
      return { name, value: '' };
    }
    name += s[i]?.toLowerCase() ?? '';
    i += 1;
  }
  while (i < n && isAsciiSpace(s.charCodeAt(i))) i += 1;
  const q = s.charCodeAt(i);
  if (q === 0x22 || q === 0x27) {
    const close = s.indexOf(q === 0x22 ? '"' : "'", i + 1);
    if (close === -1) {
      state.i = n;
      return null;
    }
    state.i = close + 1;
    return { name, value: s.slice(i + 1, close) };
  }
  if (q === 0x3e) {
    state.i = i;
    return { name, value: '' };
  }
  const start = i;
  while (i < n && !isAsciiSpace(s.charCodeAt(i)) && s.charCodeAt(i) !== 0x3e) i += 1;
  value = s.slice(start, i).toLowerCase();
  state.i = i;
  return { name, value };
}

/** The prescan of the HTML standard over the first 1024 bytes: `<meta charset>` or `<meta http-equiv="content-type" content="…charset=…">`. */
function prescanMetaCharset(bytes: Uint8Array): string | null {
  const s = String.fromCharCode(...bytes.subarray(0, 1024));
  const lower = s.toLowerCase();
  const n = s.length;
  let i = 0;
  while (i < n) {
    if (lower.startsWith('<!--', i)) {
      const end = lower.indexOf('-->', i + 2);
      if (end === -1) return null;
      i = end + 3;
      continue;
    }
    if (lower.startsWith('<meta', i) && (isAsciiSpace(lower.charCodeAt(i + 5)) || lower.charCodeAt(i + 5) === 0x2f)) {
      const state = { i: i + 6 };
      const seen = new Set<string>();
      let gotPragma = false;
      let needPragma: boolean | null = null;
      let charset: string | null = null;
      for (;;) {
        const attribute = prescanAttribute(s, state);
        if (attribute === null) break;
        if (seen.has(attribute.name)) continue;
        seen.add(attribute.name);
        if (attribute.name === 'http-equiv') {
          if (attribute.value.toLowerCase() === 'content-type') gotPragma = true;
        } else if (attribute.name === 'content') {
          if (charset === null) {
            const found = charsetInContent(attribute.value);
            if (found !== null) {
              charset = found;
              needPragma = true;
            }
          }
        } else if (attribute.name === 'charset') {
          charset = attribute.value;
          needPragma = false;
        }
      }
      i = state.i + 1;
      if (needPragma === null || (needPragma && !gotPragma) || charset === null) continue;
      const encoding = encodingForLabel(charset);
      if (encoding === null) continue;
      return encoding === 'utf-16le' || encoding === 'utf-16be' ? 'utf-8' : encoding;
    }
    const c1 = lower.charCodeAt(i + 1);
    const isLetter = (c: number): boolean => c >= 0x61 && c <= 0x7a;
    if (lower.charCodeAt(i) === 0x3c && (isLetter(c1) || (c1 === 0x2f && isLetter(lower.charCodeAt(i + 2))))) {
      let j = i + 2;
      while (j < n && !isAsciiSpace(lower.charCodeAt(j)) && lower.charCodeAt(j) !== 0x3e) j += 1;
      const state = { i: j };
      while (prescanAttribute(s, state) !== null);
      i = state.i + 1;
      continue;
    }
    if (lower.startsWith('<!', i) || lower.startsWith('</', i) || lower.startsWith('<?', i)) {
      const gt = lower.indexOf('>', i + 2);
      if (gt === -1) return null;
      i = gt + 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * Decodes the body of an HTML response as a browser does: the encoding comes from a byte order mark,
 * then the `charset` of the Content-Type header, then a `<meta charset>` or `<meta http-equiv>` in the
 * first 1024 bytes, else UTF-8. ISO-8859-1 and ASCII are read as windows-1252 (WHATWG Encoding
 * standard). Invalid bytes become U+FFFD; nothing throws.
 *
 * Session fix-a4: a page that declares no encoding at all and whose bytes are not valid UTF-8 is read as
 * windows-1252, as a browser with German settings reads it: old pages written in ISO-8859-1 keep their
 * umlauts. A declared encoding is never second-guessed.
 */
export function decodeHtml(body: Uint8Array, contentType: string | null | undefined): string {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return decodeAs(body.subarray(3), 'utf-8');
  if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) return decodeAs(body.subarray(2), 'utf-16be');
  if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) return decodeAs(body.subarray(2), 'utf-16le');
  const label = contentType === null || contentType === undefined ? null : charsetParameter(contentType);
  const fromHeader = label === null ? null : encodingForLabel(label);
  const declared = fromHeader ?? prescanMetaCharset(body);
  if (declared !== null) return decodeAs(body, declared);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body);
  } catch {
    return decodeWindows1252(body);
  }
}

// ---------------------------------------------------------------------------------------------
// Character references

/** The Latin-1 names in code point order from U+00A0; they also work without the semicolon. */
const LATIN1_NAMES = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot ' +
  'cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml ' +
  'Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ' +
  'ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
).split(' ');

/** References that the HTML standard also decodes without a semicolon (legacy). */
const LEGACY_REFERENCES = new Map<string, string>([
  ...LATIN1_NAMES.map((name, i): [string, string] => [name, String.fromCharCode(0xa0 + i)]),
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['AMP', '&'], ['LT', '<'], ['GT', '>'], ['QUOT', '"'], ['COPY', '©'], ['REG', '®'],
]);

/** Further named references (with semicolon only): typography, the ASCII punctuation that e-mail obfuscation uses, spaces. */
const NAMED_REFERENCES = new Map<string, string>([
  ...LEGACY_REFERENCES,
  ...(
    [
      ['apos', 0x27], ['OElig', 0x152], ['oelig', 0x153], ['Scaron', 0x160], ['scaron', 0x161], ['Yuml', 0x178], ['fnof', 0x192],
      ['circ', 0x2c6], ['tilde', 0x2dc], ['ensp', 0x2002], ['emsp', 0x2003], ['thinsp', 0x2009], ['zwnj', 0x200c], ['zwj', 0x200d],
      ['lrm', 0x200e], ['rlm', 0x200f], ['ndash', 0x2013], ['mdash', 0x2014], ['lsquo', 0x2018], ['rsquo', 0x2019], ['sbquo', 0x201a],
      ['ldquo', 0x201c], ['rdquo', 0x201d], ['bdquo', 0x201e], ['dagger', 0x2020], ['Dagger', 0x2021], ['bull', 0x2022],
      ['bullet', 0x2022], ['hellip', 0x2026], ['permil', 0x2030], ['prime', 0x2032], ['Prime', 0x2033], ['lsaquo', 0x2039],
      ['rsaquo', 0x203a], ['oline', 0x203e], ['frasl', 0x2044], ['euro', 0x20ac], ['trade', 0x2122], ['TRADE', 0x2122],
      ['larr', 0x2190], ['uarr', 0x2191], ['rarr', 0x2192], ['darr', 0x2193], ['harr', 0x2194], ['minus', 0x2212], ['lowast', 0x2217],
      ['infin', 0x221e], ['asymp', 0x2248], ['ne', 0x2260], ['le', 0x2264], ['ge', 0x2265], ['sdot', 0x22c5], ['check', 0x2713],
      ['phone', 0x260e], ['starf', 0x2605], ['star', 0x2606], ['hearts', 0x2665], ['mu', 0x3bc], ['Omega', 0x3a9], ['ohm', 0x3a9],
      ['half', 0xbd], ['centerdot', 0xb7], ['NonBreakingSpace', 0xa0], ['ZeroWidthSpace', 0x200b], ['hairsp', 0x200a],
      ['numsp', 0x2007], ['puncsp', 0x2008], ['MediumSpace', 0x205f], ['NoBreak', 0x2060], ['hyphen', 0x2010], ['dash', 0x2010],
      ['Tab', 0x09], ['NewLine', 0x0a], ['excl', 0x21], ['num', 0x23], ['dollar', 0x24], ['percnt', 0x25], ['lpar', 0x28],
      ['rpar', 0x29], ['ast', 0x2a], ['plus', 0x2b], ['comma', 0x2c], ['period', 0x2e], ['sol', 0x2f], ['colon', 0x3a], ['semi', 0x3b],
      ['equals', 0x3d], ['quest', 0x3f], ['commat', 0x40], ['lsqb', 0x5b], ['lbrack', 0x5b], ['bsol', 0x5c], ['rsqb', 0x5d],
      ['rbrack', 0x5d], ['Hat', 0x5e], ['lowbar', 0x5f], ['UnderBar', 0x5f], ['grave', 0x60], ['lcub', 0x7b], ['lbrace', 0x7b],
      ['verbar', 0x7c], ['vert', 0x7c], ['VerticalLine', 0x7c], ['rcub', 0x7d], ['rbrace', 0x7d],
    ] as const
  ).map(([name, code]): [string, string] => [name, String.fromCharCode(code)]),
  // Every name of the standard that starts with a legacy name: without them `&notin;` would become "¬in;" (the legacy
  // `&not` plus "in;") where a browser shows "∉". Other unknown names stay as written.
  ...([
    ['copysr', '℗'], ['divideontimes', '⋇'], ['gtcc', '⪧'], ['gtcir', '⩺'], ['gtdot', '⋗'],
    ['gtlPar', '⦕'], ['gtquest', '⩼'], ['gtrapprox', '⪆'], ['gtrarr', '⥸'], ['gtrdot', '⋗'],
    ['gtreqless', '⋛'], ['gtreqqless', '⪌'], ['gtrless', '≷'], ['gtrsim', '≳'], ['ltcc', '⪦'],
    ['ltcir', '⩹'], ['ltdot', '⋖'], ['lthree', '⋋'], ['ltimes', '⋉'], ['ltlarr', '⥶'],
    ['ltquest', '⩻'], ['ltrPar', '⦖'], ['ltri', '◃'], ['ltrie', '⊴'], ['ltrif', '◂'], ['notin', '∉'],
    ['notinE', '⋹̸'], ['notindot', '⋵̸'], ['notinva', '∉'], ['notinvb', '⋷'], ['notinvc', '⋶'],
    ['notni', '∌'], ['notniva', '∌'], ['notnivb', '⋾'], ['notnivc', '⋽'], ['parallel', '∥'],
    ['timesb', '⊠'], ['timesbar', '⨱'], ['timesd', '⨰'],
  ] as const),
]);

const isAsciiAlnum = (c: number): boolean => (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

function numericCharacter(code: number): string {
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  if (code >= 0x80 && code <= 0x9f) return String.fromCharCode(C1_TABLE[code - 0x80] as number);
  return String.fromCodePoint(code);
}

/** One character reference at `amp`: the replacement and the index after it, or null when the `&` stays as it is. */
function readReference(s: string, amp: number, attribute: boolean): [string, number] | null {
  if (s.charCodeAt(amp + 1) === 0x23) {
    let j = amp + 2;
    const x = s.charCodeAt(j);
    const hex = x === 0x78 || x === 0x58;
    if (hex) j += 1;
    const digits = j;
    let code = 0;
    while (j < s.length) {
      const d = s.charCodeAt(j);
      let v: number;
      if (d >= 0x30 && d <= 0x39) v = d - 0x30;
      else if (hex && d >= 0x61 && d <= 0x66) v = d - 0x57;
      else if (hex && d >= 0x41 && d <= 0x46) v = d - 0x37;
      else break;
      if (code <= 0x10ffff) code = code * (hex ? 16 : 10) + v;
      j += 1;
    }
    if (j === digits) return null;
    if (s.charCodeAt(j) === 0x3b) j += 1;
    return [numericCharacter(code), j];
  }
  const limit = Math.min(s.length, amp + 33);
  let j = amp + 1;
  while (j < limit && isAsciiAlnum(s.charCodeAt(j))) j += 1;
  if (j === amp + 1) return null;
  const name = s.slice(amp + 1, j);
  if (s.charCodeAt(j) === 0x3b) {
    const value = NAMED_REFERENCES.get(name);
    if (value !== undefined) return [value, j + 1];
  }
  for (let k = name.length; k >= 2; k -= 1) {
    const value = LEGACY_REFERENCES.get(name.slice(0, k));
    if (value === undefined) continue;
    const next = s.charCodeAt(amp + 1 + k);
    // In attribute values a legacy reference followed by a letter, a digit or "=" stays as it is (`?a=1&copy=2`).
    if (attribute && (isAsciiAlnum(next) || next === 0x3d)) return null;
    return [value, amp + 1 + k];
  }
  return null;
}

function decodeReferences(s: string, attribute: boolean): string {
  let amp = s.indexOf('&');
  if (amp === -1) return s;
  const parts: string[] = [];
  let last = 0;
  while (amp !== -1) {
    const reference = readReference(s, amp, attribute);
    if (reference === null) {
      amp = s.indexOf('&', amp + 1);
      continue;
    }
    parts.push(s.slice(last, amp), reference[0]);
    last = reference[1];
    amp = s.indexOf('&', last);
  }
  parts.push(s.slice(last));
  return parts.join('');
}

// ---------------------------------------------------------------------------------------------
// The document tree

const HTML = 0;
const SVG = 1;
const MATH = 2;

interface ElementNode {
  readonly t: 1;
  readonly name: string;
  readonly ns: number;
  readonly attrs: [string, string][];
  readonly children: TreeNode[];
  readonly parent: ElementNode | null;
  /** Inside the contents of a `<template>`: not part of the document for selectors, links or text. */
  readonly inTemplate: boolean;
  /** Parser: on the stack of open elements, and where. */
  open: boolean;
  index: number;
  /** Has a descendant `header`, `main`, `[role="main"]` or `[role="banner"]` (the footer test). */
  hasHeaderOrMain: boolean;
  /** Memo of the footer test: 0 not computed, 1 no, 2 yes. */
  footerBox: number;
  footerAncestor: number;
  /** Where the element's textContent starts and ends in `DocumentIndex.text` (-1 in template contents). */
  textStart: number;
  textEnd: number;
}

interface TextNode {
  readonly t: 3;
  text: string;
}

type TreeNode = ElementNode | TextNode;

function attr(el: ElementNode, name: string): string | null {
  for (const [key, value] of el.attrs) if (key === name) return value;
  return null;
}

const asciiLower = (s: string): string => (/[A-Z]/.test(s) ? s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) : s);

function keyOf(name: string, ns: number): string {
  return ns === HTML ? name : ns === SVG ? `svg ${name}` : `math ${name}`;
}

const SPECIAL = new Set([
  'address', 'applet', 'area', 'article', 'aside', 'base', 'basefont', 'bgsound', 'blockquote', 'body', 'br', 'button', 'caption', 'center',
  'col', 'colgroup', 'dd', 'details', 'dir', 'div', 'dl', 'dt', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'iframe', 'img', 'input', 'keygen', 'li', 'link',
  'listing', 'main', 'marquee', 'menu', 'meta', 'nav', 'noembed', 'noframes', 'noscript', 'object', 'ol', 'p', 'param', 'plaintext', 'pre',
  'script', 'search', 'section', 'select', 'source', 'style', 'summary', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
  'thead', 'title', 'tr', 'track', 'ul', 'wbr', 'xmp', 'math mi', 'math mo', 'math mn', 'math ms', 'math mtext', 'math annotation-xml',
  'svg foreignobject', 'svg desc', 'svg title',
]);
/** Elements that end the default scope ("has an element in scope"). */
const SCOPE_BOUNDARY = new Set([
  'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template', 'math mi', 'math mo', 'math mn', 'math ms',
  'math mtext', 'math annotation-xml', 'svg foreignobject', 'svg desc', 'svg title',
]);
/** Elements that put a marker on the list of active formatting elements. */
const MARKER_ELEMENTS = new Set(['applet', 'caption', 'marquee', 'object', 'template', 'td', 'th']);
const VOID_ELEMENTS = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source',
  'track', 'wbr',
]);
const HEAD_ELEMENTS = new Set(['base', 'basefont', 'bgsound', 'link', 'meta', 'noframes', 'noscript', 'script', 'style', 'template', 'title']);
/** Start tags that close an open `<p>`. */
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption', 'figure',
  'footer', 'header', 'hgroup', 'main', 'menu', 'nav', 'ol', 'p', 'search', 'section', 'summary', 'ul',
]);
/** End tags that close the element when it is in scope. */
const BLOCK_END = new Set([
  'address', 'article', 'aside', 'blockquote', 'button', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset', 'figcaption',
  'figure', 'footer', 'header', 'hgroup', 'listing', 'main', 'menu', 'nav', 'ol', 'pre', 'search', 'section', 'summary', 'ul', 'dd', 'dt',
  'form', 'applet', 'marquee', 'object',
]);
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const TABLE_CONTEXT = new Set(['table', 'tbody', 'thead', 'tfoot', 'tr']);
const TABLE_TAGS = new Set(['caption', 'colgroup', 'col', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th']);
/** HTML start tags that end foreign content (SVG, MathML). */
const BREAKOUT = new Set([
  'b', 'big', 'blockquote', 'body', 'br', 'center', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'embed', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'head', 'hr', 'i', 'img', 'li', 'listing', 'menu', 'meta', 'nobr', 'ol', 'p', 'pre', 'ruby', 's', 'small', 'span', 'strong', 'strike',
  'sub', 'sup', 'table', 'tt', 'u', 'ul', 'var',
]);
/** Raw text elements: their content is text up to the matching end tag. `noscript` too, because the browser runs scripts. */
const RAW_TEXT = new Map<string, 'raw' | 'rcdata' | 'plaintext'>([
  ['script', 'raw'], ['style', 'raw'], ['xmp', 'raw'], ['iframe', 'raw'], ['noembed', 'raw'], ['noframes', 'raw'], ['noscript', 'raw'],
  ['title', 'rcdata'], ['textarea', 'rcdata'], ['plaintext', 'plaintext'],
]);

const QUIRKS_PUBLIC_PREFIXES = [
  '+//silmaril//dtd html pro v0r11 19970101//', '-//as//dtd html 3.0 aswedit + extensions//', '-//advasoft ltd//dtd html 3.0 aswedit + extensions//',
  '-//ietf//dtd html 2.0', '-//ietf//dtd html 2.1e//', '-//ietf//dtd html 3', '-//ietf//dtd html level', '-//ietf//dtd html strict',
  '-//ietf//dtd html//', '-//metrius//dtd metrius presentational//', '-//microsoft//dtd internet explorer', '-//netscape comm. corp.//dtd',
  "-//o'reilly and associates//dtd html", '-//sq//dtd html 2.0 hotmetal + extensions//', '-//softquad software//dtd hotmetal pro',
  '-//softquad//dtd hotmetal pro', '-//spyglass//dtd html 2.0 extended//', '-//sun microsystems corp.//dtd hotjava',
  '-//w3c//dtd html 3 1995-03-24//', '-//w3c//dtd html 3.2', '-//w3c//dtd html 4.0 frameset//', '-//w3c//dtd html 4.0 transitional//',
  '-//w3c//dtd html experimental', '-//w3c//dtd w3 html//', '-//w3o//dtd w3 html 3.0//', '-//webtechs//dtd mozilla html',
];

/** Quirks mode from the doctype (the HTML standard's list, shortened to common prefixes): class and id selectors then ignore case. */
function quirksOf(doctype: string): boolean {
  let i = 0;
  while (i < doctype.length && isAsciiSpace(doctype.charCodeAt(i))) i += 1;
  let j = i;
  while (j < doctype.length && !isAsciiSpace(doctype.charCodeAt(j))) j += 1;
  if (doctype.slice(i, j).toLowerCase() !== 'html') return true;
  const rest = doctype.slice(j);
  const keyword = trimAscii(rest).slice(0, 6).toLowerCase();
  const quoted: string[] = [];
  let k = 0;
  while (quoted.length < 2) {
    const dq = rest.indexOf('"', k);
    const sq = rest.indexOf("'", k);
    const open = dq === -1 ? sq : sq === -1 ? dq : Math.min(dq, sq);
    if (open === -1) break;
    const close = rest.indexOf(rest[open] as string, open + 1);
    if (close === -1) break;
    quoted.push(rest.slice(open + 1, close).toLowerCase());
    k = close + 1;
  }
  const publicId = keyword === 'public' ? (quoted[0] ?? null) : null;
  const systemId = keyword === 'public' ? (quoted[1] ?? null) : keyword === 'system' ? (quoted[0] ?? null) : null;
  if (systemId === 'http://www.ibm.com/data/dtd/v11/ibmxhtml1-transitional.dtd') return true;
  if (publicId === null) return false;
  if (publicId === '-//w3o//dtd w3 html strict 3.0//en//' || publicId === '-/w3c/dtd html 4.0 transitional/en' || publicId === 'html') return true;
  if (QUIRKS_PUBLIC_PREFIXES.some((prefix) => publicId.startsWith(prefix))) return true;
  return systemId === null && (publicId.startsWith('-//w3c//dtd html 4.01 frameset//') || publicId.startsWith('-//w3c//dtd html 4.01 transitional//'));
}

const top = (list: readonly number[]): number => (list.length === 0 ? -1 : (list[list.length - 1] as number));

function isHtmlIntegrationPoint(el: ElementNode): boolean {
  if (el.ns === SVG) return el.name === 'foreignobject' || el.name === 'desc' || el.name === 'title';
  if (el.ns === MATH) return el.name === 'mi' || el.name === 'mo' || el.name === 'mn' || el.name === 'ms' || el.name === 'mtext' || el.name === 'annotation-xml';
  return false;
}

/**
 * The tree construction of the HTML standard, reduced to what changes the text and the links: implied
 * end tags (`p`, `li`, `dd`, `dt`, cells and rows), scopes, raw text elements, foreign content, `<template>`,
 * `<select>`, and the reopening of an unclosed `<a>` (the list of active formatting elements, kept for `a`
 * only, since the other formatting elements change neither text nor links). Not done: foster parenting
 * (stray content in a table stays where it is) and moving nodes in the adoption agency algorithm.
 */
class TreeBuilder {
  readonly html: ElementNode;
  body: ElementNode | null = null;
  quirks: boolean | null = null;
  skipNewline = false;
  private readonly stack: ElementNode[] = [];
  private readonly positions = new Map<string, number[]>();
  private readonly special: number[] = [];
  private readonly specialNotAdp: number[] = [];
  private readonly scope: number[] = [];
  private readonly htmlElements: number[] = [];
  /** Active formatting elements, `a` only; null is a marker. */
  private readonly active: (ElementNode | null)[] = [];
  private templates = 0;
  private clones = 0;
  private clonedChars = 0;
  /** Characters of an attribute list (shared by a link and its copies), computed once per list. */
  private readonly attributeChars = new WeakMap<[string, string][], number>();
  /** Names of the attributes of `<html>` and `<body>`, which later start tags extend: a set, so many merges stay linear. */
  private readonly mergedNames = new Map<ElementNode, Set<string>>();
  private beforeBody = true;

  constructor() {
    this.html = this.create('html', HTML, [], null);
    this.push(this.html);
    this.push(this.create('head', HTML, [], this.html));
  }

  private create(name: string, ns: number, attrs: [string, string][], parent: ElementNode | null): ElementNode {
    const el: ElementNode = { t: 1, name, ns, attrs, children: [], parent, inTemplate: this.templates > 0, open: false, index: -1, hasHeaderOrMain: false, footerBox: 0, footerAncestor: 0, textStart: -1, textEnd: -1 };
    if (parent !== null) parent.children.push(el);
    return el;
  }

  current(): ElementNode {
    return this.stack[this.stack.length - 1] as ElementNode;
  }

  private insertionParent(): ElementNode {
    const current = this.current();
    return this.stack.length > MAX_TREE_DEPTH && current.parent !== null ? current.parent : current;
  }

  private insert(name: string, ns: number, attrs: [string, string][]): ElementNode {
    return this.create(name, ns, attrs, this.insertionParent());
  }

  private insertOpen(name: string, attrs: [string, string][]): ElementNode {
    const el = this.insert(name, HTML, attrs);
    this.push(el);
    return el;
  }

  private insertText(text: string): void {
    const parent = this.insertionParent();
    const last = parent.children[parent.children.length - 1];
    if (last !== undefined && last.t === 3) last.text += text;
    else parent.children.push({ t: 3, text });
  }

  private topIndex(key: string): number {
    const list = this.positions.get(key);
    return list === undefined ? -1 : top(list);
  }

  private push(el: ElementNode): void {
    el.open = true;
    el.index = this.stack.length;
    this.stack.push(el);
    const key = keyOf(el.name, el.ns);
    let list = this.positions.get(key);
    if (list === undefined) {
      list = [];
      this.positions.set(key, list);
    }
    list.push(el.index);
    if (SPECIAL.has(key)) {
      this.special.push(el.index);
      if (key !== 'address' && key !== 'div' && key !== 'p') this.specialNotAdp.push(el.index);
    }
    if (SCOPE_BOUNDARY.has(key)) this.scope.push(el.index);
    if (el.ns === HTML) {
      this.htmlElements.push(el.index);
      if (el.name === 'template') this.templates += 1;
      if (MARKER_ELEMENTS.has(el.name)) this.active.push(null);
    }
  }

  private pop(): void {
    const el = this.stack.pop() as ElementNode;
    const index = this.stack.length;
    el.open = false;
    this.positions.get(keyOf(el.name, el.ns))?.pop();
    if (top(this.special) === index) this.special.pop();
    if (top(this.specialNotAdp) === index) this.specialNotAdp.pop();
    if (top(this.scope) === index) this.scope.pop();
    if (top(this.htmlElements) === index) this.htmlElements.pop();
    if (el.ns === HTML) {
      if (el.name === 'template') this.templates -= 1;
      if (MARKER_ELEMENTS.has(el.name)) {
        while (this.active.length > 0 && this.active.pop() !== null);
      }
    }
  }

  private popUntil(index: number): void {
    const stop = Math.max(1, index);
    while (this.stack.length > stop) this.pop();
  }

  /** The index of the topmost `key` element when it is in scope (default scope plus `extra` boundaries), else -1. */
  private inScope(key: string, extra: readonly string[] = []): number {
    const t = this.topIndex(key);
    if (t < 0) return -1;
    let boundary = top(this.scope);
    for (const k of extra) boundary = Math.max(boundary, this.topIndex(k));
    return t >= boundary ? t : -1;
  }

  private inTableScope(key: string): number {
    const t = this.topIndex(key);
    if (t < 0) return -1;
    return t >= Math.max(this.topIndex('html'), this.topIndex('table'), this.topIndex('template')) ? t : -1;
  }

  private closeP(): void {
    const t = this.inScope('p', ['button']);
    if (t >= 0) this.popUntil(t);
  }

  private inSelect(): boolean {
    const s = this.topIndex('select');
    return s >= 0 && s > this.topIndex('template');
  }

  private currentIs(name: string): boolean {
    const current = this.current();
    return current.ns === HTML && current.name === name;
  }

  /** Reopens an `a` that was closed by an end tag of an element around it (`<p><a href=…>x</p><p>y`: "y" is a link too). */
  private reconstruct(): void {
    const last = this.active[this.active.length - 1];
    if (last === undefined || last === null || last.open) return;
    let chars = this.attributeChars.get(last.attrs);
    if (chars === undefined) {
      chars = 0;
      for (const [key, value] of last.attrs) chars += key.length + value.length + 2;
      this.attributeChars.set(last.attrs, chars);
    }
    if (this.clones >= MAX_LINK_CLONES || this.clonedChars + chars > MAX_CLONED_ATTRIBUTE_CHARS) {
      this.active.pop();
      return;
    }
    this.clones += 1;
    this.clonedChars += chars;
    const clone = this.insertOpen('a', last.attrs);
    this.active[this.active.length - 1] = clone;
  }

  /** `<html>` or `<body>` again: adds the attributes it does not have yet; ignored inside a `<template>`, as in a browser. */
  private mergeAttributes(el: ElementNode | null, attrs: [string, string][]): void {
    if (el === null || this.templates > 0 || attrs.length === 0) return;
    let names = this.mergedNames.get(el);
    if (names === undefined) {
      names = new Set(el.attrs.map(([key]) => key));
      this.mergedNames.set(el, names);
    }
    for (const [key, value] of attrs) {
      if (names.has(key)) continue;
      names.add(key);
      el.attrs.push([key, value]);
    }
  }

  private startBody(attrs: [string, string][]): void {
    this.popUntil(1);
    this.body = this.insertOpen('body', attrs);
    this.beforeBody = false;
  }

  private contentSeen(): void {
    if (this.quirks === null) this.quirks = true;
  }

  doctype(text: string): void {
    if (this.quirks === null) this.quirks = quirksOf(text);
  }

  inForeignContent(): boolean {
    return this.current().ns !== HTML;
  }

  /** Character data between tags (references not yet decoded). */
  characters(raw: string): void {
    let text = raw.indexOf('&') === -1 ? raw : decodeReferences(raw, false);
    if (this.skipNewline) {
      this.skipNewline = false;
      if (text.charCodeAt(0) === 0x0a) text = text.slice(1);
    }
    if (text === '') return;
    const blank = isBlank(text);
    if (this.beforeBody && this.templates === 0) {
      if (blank) return;
      this.contentSeen();
      let k = 0;
      while (isAsciiSpace(text.charCodeAt(k))) k += 1;
      text = text.slice(k);
      this.startBody([]);
    }
    const current = this.current();
    if (current.ns !== HTML && !isHtmlIntegrationPoint(current)) {
      this.insertText(text);
      return;
    }
    if (!(blank && current.ns === HTML && TABLE_CONTEXT.has(current.name)) && !this.inSelect()) this.reconstruct();
    this.insertText(text);
  }

  /** Text of a CDATA section in foreign content. */
  cdata(text: string): void {
    if (text !== '') this.insertText(text);
  }

  /** Returns the element whose raw text the tokenizer reads next, or null. */
  startTag(tagName: string, attrs: [string, string][], selfClosing: boolean): ElementNode | null {
    this.contentSeen();
    const current = this.current();
    if (current.ns !== HTML && !isHtmlIntegrationPoint(current)) {
      const breaksOut = BREAKOUT.has(tagName) || (tagName === 'font' && attrs.some(([k]) => k === 'color' || k === 'face' || k === 'size'));
      if (!breaksOut) {
        const el = this.insert(tagName, current.ns, attrs);
        if (!selfClosing) this.push(el);
        return null;
      }
      while (this.current().ns !== HTML && !isHtmlIntegrationPoint(this.current())) this.pop();
    }
    if (this.beforeBody && this.templates === 0) {
      if (tagName === 'html') {
        this.mergeAttributes(this.html, attrs);
        return null;
      }
      if (tagName === 'head' || tagName === 'frameset' || tagName === 'frame') return null;
      if (HEAD_ELEMENTS.has(tagName)) {
        const el = this.insert(tagName, HTML, attrs);
        if (VOID_ELEMENTS.has(tagName)) return null;
        this.push(el);
        return RAW_TEXT.has(tagName) ? el : null;
      }
      this.startBody(tagName === 'body' ? attrs : []);
      if (tagName === 'body') return null;
    }
    return this.bodyStartTag(tagName === 'image' ? 'img' : tagName, attrs, selfClosing);
  }

  private bodyStartTag(name: string, attrs: [string, string][], selfClosing: boolean): ElementNode | null {
    if (this.inSelect()) {
      switch (name) {
        case 'html':
          this.mergeAttributes(this.html, attrs);
          return null;
        case 'option':
          if (this.currentIs('option')) this.pop();
          this.insertOpen(name, attrs);
          return null;
        case 'optgroup':
        case 'hr':
          if (this.currentIs('option')) this.pop();
          if (this.currentIs('optgroup')) this.pop();
          if (name === 'hr') this.insert(name, HTML, attrs);
          else this.insertOpen(name, attrs);
          return null;
        case 'select':
          this.popUntil(this.topIndex('select'));
          return null;
        case 'input':
        case 'keygen':
        case 'textarea':
          this.popUntil(this.topIndex('select'));
          break;
        case 'script':
          return this.insertOpen(name, attrs);
        case 'template':
          this.insertOpen(name, attrs);
          return null;
        default:
          return null;
      }
    }
    if (TABLE_TAGS.has(name)) return this.tableStartTag(name, attrs);
    if (CLOSES_P.has(name)) {
      this.closeP();
      this.insertOpen(name, attrs);
      return null;
    }
    switch (name) {
      case 'html':
        this.mergeAttributes(this.html, attrs);
        return null;
      case 'body':
        this.mergeAttributes(this.body, attrs);
        return null;
      case 'head':
      case 'frameset':
      case 'frame':
        return null;
      case 'base':
      case 'basefont':
      case 'bgsound':
      case 'link':
      case 'meta':
      case 'param':
      case 'source':
      case 'track':
        this.insert(name, HTML, attrs);
        return null;
      case 'title':
      case 'style':
      case 'script':
      case 'noframes':
      case 'noscript':
      case 'iframe':
      case 'noembed':
      case 'textarea':
        return this.insertOpen(name, attrs);
      case 'template':
        this.insertOpen(name, attrs);
        return null;
      case 'xmp':
        this.closeP();
        this.reconstruct();
        return this.insertOpen(name, attrs);
      case 'plaintext':
        this.closeP();
        return this.insertOpen(name, attrs);
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        this.closeP();
        const current = this.current();
        if (current.ns === HTML && HEADINGS.includes(current.name)) this.pop();
        this.insertOpen(name, attrs);
        return null;
      }
      case 'pre':
      case 'listing':
        this.closeP();
        this.insertOpen(name, attrs);
        this.skipNewline = true;
        return null;
      case 'form':
        this.closeP();
        this.insertOpen(name, attrs);
        return null;
      case 'li': {
        const t = this.topIndex('li');
        if (t >= 0 && top(this.specialNotAdp) <= t) this.popUntil(t);
        this.closeP();
        this.insertOpen(name, attrs);
        return null;
      }
      case 'dd':
      case 'dt': {
        const t = Math.max(this.topIndex('dd'), this.topIndex('dt'));
        if (t >= 0 && top(this.specialNotAdp) <= t) this.popUntil(t);
        this.closeP();
        this.insertOpen(name, attrs);
        return null;
      }
      case 'button': {
        const t = this.inScope('button');
        if (t >= 0) this.popUntil(t);
        this.reconstruct();
        this.insertOpen(name, attrs);
        return null;
      }
      case 'a': {
        const last = this.active[this.active.length - 1];
        if (last !== undefined && last !== null) {
          if (last.open && last.index >= top(this.scope)) this.popUntil(last.index);
          if (this.active[this.active.length - 1] === last) this.active.pop();
        }
        this.reconstruct();
        this.active.push(this.insertOpen(name, attrs));
        return null;
      }
      case 'table': {
        const current = this.current();
        if (current.ns === HTML && TABLE_CONTEXT.has(current.name)) {
          const t = this.inTableScope('table');
          if (t >= 0) this.popUntil(t);
        } else if (this.quirks !== true) this.closeP();
        this.insertOpen(name, attrs);
        return null;
      }
      case 'hr':
        this.closeP();
        this.insert(name, HTML, attrs);
        return null;
      case 'area':
      case 'br':
      case 'embed':
      case 'img':
      case 'keygen':
      case 'wbr':
      case 'input':
        this.reconstruct();
        this.insert(name, HTML, attrs);
        return null;
      case 'optgroup':
      case 'option':
        if (this.currentIs('option')) this.pop();
        this.reconstruct();
        this.insertOpen(name, attrs);
        return null;
      case 'svg':
      case 'math': {
        this.reconstruct();
        const el = this.insert(name, name === 'svg' ? SVG : MATH, attrs);
        if (!selfClosing) this.push(el);
        return null;
      }
      default:
        this.reconstruct();
        this.insertOpen(name, attrs);
        return null;
    }
  }

  private clearTo(names: ReadonlySet<string>): void {
    for (;;) {
      const current = this.current();
      if (current.ns === HTML && (names.has(current.name) || current.name === 'html' || current.name === 'template')) return;
      this.pop();
    }
  }

  private closeCell(): void {
    const t = Math.max(this.inTableScope('td'), this.inTableScope('th'));
    if (t >= 0) this.popUntil(t);
  }

  private tableStartTag(name: string, attrs: [string, string][]): ElementNode | null {
    if (this.inTableScope('table') < 0) return null; // ignored outside a table
    switch (name) {
      case 'caption':
      case 'colgroup':
      case 'tbody':
      case 'thead':
      case 'tfoot':
        this.clearTo(TABLE_ONLY);
        this.insertOpen(name, attrs);
        return null;
      case 'col':
        this.clearTo(TABLE_ONLY);
        this.insert(name, HTML, attrs);
        return null;
      case 'tr': {
        this.closeCell();
        const t = this.inTableScope('tr');
        if (t >= 0) this.popUntil(t);
        this.clearTo(TABLE_BODY);
        this.insertOpen(name, attrs);
        return null;
      }
      default: {
        this.closeCell();
        if (!this.currentIs('tr')) {
          this.clearTo(TABLE_BODY);
          this.insertOpen('tr', []);
        }
        this.insertOpen(name, attrs);
        return null;
      }
    }
  }

  endTag(name: string): void {
    this.contentSeen();
    if (this.beforeBody && this.templates === 0) {
      if (name !== 'body' && name !== 'html' && name !== 'br') return;
      this.startBody([]);
      if (name !== 'br') return;
    }
    const current = this.current();
    if (current.ns !== HTML) {
      if (name === 'br' || name === 'p') {
        while (this.current().ns !== HTML && !isHtmlIntegrationPoint(this.current())) this.pop();
      } else {
        const t = Math.max(this.topIndex(`svg ${name}`), this.topIndex(`math ${name}`));
        if (t > top(this.htmlElements)) {
          this.popUntil(t);
          return;
        }
      }
    }
    if (this.inSelect()) {
      if (name === 'select') this.popUntil(this.topIndex('select'));
      else if (name === 'option' && this.currentIs('option')) this.pop();
      else if (name === 'optgroup') {
        const below = this.stack[this.stack.length - 2];
        if (this.currentIs('option') && below !== undefined && below.ns === HTML && below.name === 'optgroup') this.pop();
        if (this.currentIs('optgroup')) this.pop();
      } else if (name === 'template') this.popUntil(this.topIndex('template'));
      return;
    }
    if (BLOCK_END.has(name)) {
      const t = this.inScope(name);
      if (t >= 0) this.popUntil(t);
      return;
    }
    switch (name) {
      case 'body':
      case 'html':
      case 'head':
      case 'col':
        return;
      case 'template': {
        const t = this.topIndex('template');
        if (t >= 0) this.popUntil(t);
        return;
      }
      case 'p': {
        const t = this.inScope('p', ['button']);
        if (t < 0) this.insert('p', HTML, []);
        else this.popUntil(t);
        return;
      }
      case 'li': {
        const t = this.inScope('li', ['ol', 'ul']);
        if (t >= 0) this.popUntil(t);
        return;
      }
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6': {
        const t = Math.max(...HEADINGS.map((h) => this.inScope(h)));
        if (t >= 0) this.popUntil(t);
        return;
      }
      case 'a': {
        const last = this.active[this.active.length - 1];
        if (last === undefined || last === null) {
          this.anyOtherEndTag(name);
          return;
        }
        if (!last.open) {
          this.active.pop();
          return;
        }
        if (last.index < top(this.scope)) return;
        this.popUntil(last.index);
        this.active.pop();
        return;
      }
      case 'br':
        this.reconstruct();
        this.insert('br', HTML, []);
        return;
      case 'td':
      case 'th':
      case 'tr':
      case 'tbody':
      case 'thead':
      case 'tfoot':
      case 'table':
      case 'caption':
      case 'colgroup': {
        const t = this.inTableScope(name);
        if (t >= 0) this.popUntil(t);
        return;
      }
      default:
        this.anyOtherEndTag(name);
    }
  }

  /** "Any other end tag": close the element unless a special element stands above it. */
  private anyOtherEndTag(name: string): void {
    const t = this.topIndex(name);
    if (t < 0 || top(this.special) > t) return;
    this.popUntil(t);
  }

  /** Called after the tokenizer read the text of a raw text element. */
  rawText(el: ElementNode, text: string): void {
    if (text !== '') el.children.push({ t: 3, text });
    if (this.current() === el) this.pop();
  }

  finish(): void {
    if (this.body === null) this.startBody([]);
  }
}

const TABLE_ONLY: ReadonlySet<string> = new Set(['table']);
const TABLE_BODY: ReadonlySet<string> = new Set(['tbody', 'thead', 'tfoot', 'table']);

function isBlank(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) if (!isAsciiSpace(s.charCodeAt(i))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Tokenizer

interface RawTag {
  name: string;
  attrs: [string, string][];
  selfClosing: boolean;
  next: number;
}

const isAsciiAlpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/** Reads a tag from the first character of its name; null when the input ends inside the tag (the tag is dropped, as in a browser). */
function readTag(src: string, start: number): RawTag | null {
  const n = src.length;
  let j = start;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (isAsciiSpace(c) || c === 0x2f || c === 0x3e) break;
    j += 1;
  }
  if (j >= n) return null;
  const name = src.slice(start, j).toLowerCase();
  const attrs: [string, string][] = [];
  // Duplicate attributes: the first wins. A set only for tags with many attributes (a hostile page), a scan otherwise.
  let seen: Set<string> | null = null;
  let selfClosing = false;
  for (;;) {
    let c = src.charCodeAt(j);
    while (j < n && (isAsciiSpace(c) || c === 0x2f)) {
      selfClosing = c === 0x2f && src.charCodeAt(j + 1) === 0x3e;
      j += 1;
      c = src.charCodeAt(j);
    }
    if (j >= n) return null;
    if (c === 0x3e) return { name, attrs, selfClosing, next: j + 1 };
    selfClosing = false;
    const nameStart = j;
    j += 1; // the first character may be "="
    while (j < n) {
      c = src.charCodeAt(j);
      if (isAsciiSpace(c) || c === 0x2f || c === 0x3e || c === 0x3d) break;
      j += 1;
    }
    const attrName = src.slice(nameStart, j).toLowerCase();
    while (j < n && isAsciiSpace(src.charCodeAt(j))) j += 1;
    let value = '';
    if (src.charCodeAt(j) === 0x3d) {
      j += 1;
      while (j < n && isAsciiSpace(src.charCodeAt(j))) j += 1;
      const q = src.charCodeAt(j);
      if (q === 0x22 || q === 0x27) {
        const close = src.indexOf(q === 0x22 ? '"' : "'", j + 1);
        if (close === -1) return null;
        value = src.slice(j + 1, close);
        j = close + 1;
      } else if (q !== 0x3e) {
        const valueStart = j;
        while (j < n) {
          c = src.charCodeAt(j);
          if (isAsciiSpace(c) || c === 0x3e) break;
          j += 1;
        }
        value = src.slice(valueStart, j);
      }
      if (value.indexOf('&') !== -1) value = decodeReferences(value, true);
    }
    if (seen === null && attrs.length >= 16) seen = new Set(attrs.map(([key]) => key));
    const duplicate = seen === null ? attrs.some(([key]) => key === attrName) : seen.has(attrName);
    if (!duplicate) {
      seen?.add(attrName);
      attrs.push([attrName, value]);
    }
  }
}

function startsWithIgnoringCase(src: string, at: number, word: string): boolean {
  return src.length >= at + word.length && src.slice(at, at + word.length).toLowerCase() === word;
}

function skipPast(src: string, needle: string, from: number): number {
  const k = src.indexOf(needle, from);
  return k === -1 ? src.length : k + needle.length;
}

/** After `<!--`: the index after the comment (`-->`, `--!>`, or the empty `<!-->` and `<!--->`). Linear: the search only moves forward. */
function skipComment(src: string, from: number): number {
  if (src.charCodeAt(from) === 0x3e) return from + 1;
  if (src.charCodeAt(from) === 0x2d && src.charCodeAt(from + 1) === 0x3e) return from + 2;
  let p = from;
  for (;;) {
    const dashes = src.indexOf('--', p);
    if (dashes === -1) return src.length;
    const after = src.charCodeAt(dashes + 2);
    if (after === 0x3e) return dashes + 3;
    if (after === 0x21 && src.charCodeAt(dashes + 3) === 0x3e) return dashes + 4;
    p = dashes + 1;
  }
}

/** Where the raw text of `name` ends: the first `</name` followed by white space, `/` or `>`. */
function rawTextEnd(src: string, name: string, from: number): { textEnd: number; next: number } {
  let p = from;
  for (;;) {
    const k = src.indexOf('</', p);
    if (k === -1) return { textEnd: src.length, next: src.length };
    if (startsWithIgnoringCase(src, k + 2, name)) {
      const c = src.charCodeAt(k + 2 + name.length);
      if (isAsciiSpace(c) || c === 0x2f || c === 0x3e) {
        const tag = readTag(src, k + 2);
        return { textEnd: k, next: tag === null ? src.length : tag.next };
      }
    }
    p = k + 2;
  }
}

/** True when `name` starts at `at` (any case) and is followed by white space, `/` or `>` (a tag of that name, not `scripts`). */
function namedTagAt(src: string, at: number, name: string): boolean {
  if (!startsWithIgnoringCase(src, at, name)) return false;
  const c = src.charCodeAt(at + name.length);
  return isAsciiSpace(c) || c === 0x2f || c === 0x3e;
}

/**
 * Where the text of a `<script>` ends, with the escape states of the tokenizer: after `<!--` a `<script>` tag
 * starts the "double escaped" state, in which `</script>` only leaves that state, and `-->` ends both
 * (`<script><!-- document.write("<script src=x></script>"); //--></script>` is one script). Linear: both
 * look-ups are cached and the position only moves forward.
 */
function scriptDataEnd(src: string, from: number): { textEnd: number; next: number } {
  const n = src.length;
  let state = 0; // 0 script data, 1 escaped, 2 double escaped
  let i = from;
  let lt = -2;
  let dashes = -2;
  for (;;) {
    if (lt !== -1 && lt < i) lt = src.indexOf('<', i);
    if (state !== 0) {
      if (dashes !== -1 && dashes < i) dashes = src.indexOf('-->', i);
      if (dashes !== -1 && (lt === -1 || dashes < lt)) {
        state = 0;
        i = dashes + 3;
        continue;
      }
    }
    if (lt === -1) return { textEnd: n, next: n };
    if (src.charCodeAt(lt + 1) === 0x2f && namedTagAt(src, lt + 2, 'script')) {
      if (state !== 2) {
        const tag = readTag(src, lt + 2);
        return { textEnd: lt, next: tag === null ? n : tag.next };
      }
      state = 1;
      i = lt + 8;
      continue;
    }
    if (state === 0 && src.startsWith('!--', lt + 1)) {
      state = 1;
      i = lt + 2; // the dashes of "<!--" also count for "-->" ("<!-->" ends at once)
      continue;
    }
    if (state === 1 && namedTagAt(src, lt + 1, 'script')) {
      state = 2;
      i = lt + 7;
      continue;
    }
    i = lt + 1;
  }
}

function parseDocument(input: string): TreeBuilder {
  const src = input.indexOf('\r') === -1 && input.indexOf('\0') === -1 ? input : input.replace(/\r\n?/g, '\n').replace(/\0/g, '');
  const tb = new TreeBuilder();
  const n = src.length;
  let i = 0;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      tb.characters(src.slice(i));
      break;
    }
    if (lt > i) tb.characters(src.slice(i, lt));
    i = lt;
    const c = src.charCodeAt(i + 1);
    if (isAsciiAlpha(c)) {
      const tag = readTag(src, i + 1);
      if (tag === null) break;
      i = tag.next;
      tb.skipNewline = false;
      const raw = tb.startTag(tag.name, tag.attrs, tag.selfClosing);
      if (raw !== null) {
        const kind = RAW_TEXT.get(raw.name);
        let text: string;
        if (kind === 'plaintext') {
          text = src.slice(i);
          i = n;
        } else {
          const end = raw.name === 'script' ? scriptDataEnd(src, i) : rawTextEnd(src, raw.name, i);
          text = src.slice(i, end.textEnd);
          i = end.next;
        }
        if (raw.name === 'textarea' && text.charCodeAt(0) === 0x0a) text = text.slice(1);
        if (kind === 'rcdata') text = decodeReferences(text, false);
        tb.rawText(raw, text);
      }
      continue;
    }
    tb.skipNewline = false;
    if (c === 0x2f) {
      const c2 = src.charCodeAt(i + 2);
      if (isAsciiAlpha(c2)) {
        const tag = readTag(src, i + 2);
        if (tag === null) break;
        i = tag.next;
        tb.endTag(tag.name);
      } else if (c2 === 0x3e) i += 3;
      else if (Number.isNaN(c2)) {
        tb.characters('</');
        i = n;
      } else i = skipPast(src, '>', i + 2);
      continue;
    }
    if (c === 0x21) {
      if (src.startsWith('--', i + 2)) i = skipComment(src, i + 4);
      else if (startsWithIgnoringCase(src, i + 2, 'doctype')) {
        const gt = src.indexOf('>', i + 9);
        tb.doctype(src.slice(i + 9, gt === -1 ? n : gt));
        i = gt === -1 ? n : gt + 1;
      } else if (src.startsWith('[CDATA[', i + 2) && tb.inForeignContent()) {
        const end = src.indexOf(']]>', i + 9);
        tb.cdata(src.slice(i + 9, end === -1 ? n : end));
        i = end === -1 ? n : end + 3;
      } else i = skipPast(src, '>', i + 2);
      continue;
    }
    if (c === 0x3f) {
      i = skipPast(src, '>', i + 2);
      continue;
    }
    tb.characters('<');
    i += 1;
  }
  tb.finish();
  return tb;
}

// ---------------------------------------------------------------------------------------------
// Selectors (the syntax of `PLATFORM_SELECTORS` only; anything else never matches)

interface AttributeTest {
  name: string;
  op: '' | '=' | '~=' | '|=' | '^=' | '$=' | '*=';
  value: string;
  flag: 'i' | 's' | null;
}

interface Compound {
  type: string | null;
  ids: string[];
  classes: string[];
  attributes: AttributeTest[];
}

/** Attributes whose values HTML compares without case in selectors. */
const CASE_INSENSITIVE_ATTRIBUTES = new Set([
  'accept', 'accept-charset', 'align', 'alink', 'axis', 'bgcolor', 'charset', 'checked', 'clear', 'codetype', 'color', 'compact', 'declare',
  'defer', 'dir', 'direction', 'disabled', 'enctype', 'face', 'frame', 'hreflang', 'http-equiv', 'lang', 'language', 'link', 'media', 'method',
  'multiple', 'nohref', 'noresize', 'noshade', 'nowrap', 'readonly', 'rel', 'rev', 'rules', 'scope', 'scrolling', 'selected', 'shape',
  'target', 'text', 'type', 'valign', 'valuetype', 'vlink',
]);

/**
 * Compiles a selector list of compound selectors: a type or `*`, `#id`, `.class`, `[attr]` and
 * `[attr op "value" i|s]` with `=`, `~=`, `|=`, `^=`, `$=`, `*=`, separated by commas. Combinators,
 * pseudo-classes, namespaces and escapes are not supported: the result is null and the selector never matches.
 */
function compileSelector(selector: string): Compound[] | null {
  const s = selector;
  const n = s.length;
  let i = 0;
  const skipSpace = (): void => {
    while (i < n && isAsciiSpace(s.charCodeAt(i))) i += 1;
  };
  /** An identifier; '' when there is none, null for an escape. */
  const ident = (): string | null => {
    const start = i;
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 0x5c) return null;
      if (isAsciiAlnum(c) || c === 0x2d || c === 0x5f || c >= 0x80) i += 1;
      else break;
    }
    return s.slice(start, i);
  };
  const attribute = (): AttributeTest | null => {
    skipSpace();
    const name = ident();
    if (name === null || name === '') return null;
    skipSpace();
    if (s[i] === ']') {
      i += 1;
      return { name: asciiLower(name), op: '', value: '', flag: null };
    }
    let op: AttributeTest['op'];
    if (s[i] === '=') {
      op = '=';
      i += 1;
    } else if ('~|^$*'.includes(s[i] ?? '#') && s[i + 1] === '=') {
      op = `${s[i]}=` as AttributeTest['op'];
      i += 2;
    } else return null;
    skipSpace();
    let value: string;
    const q = s[i];
    if (q === '"' || q === "'") {
      const close = s.indexOf(q, i + 1);
      if (close === -1) return null;
      value = s.slice(i + 1, close);
      if (value.includes('\\') || value.includes('\n')) return null;
      i = close + 1;
    } else {
      const word = ident();
      if (word === null || word === '') return null;
      value = word;
    }
    skipSpace();
    let flag: AttributeTest['flag'] = null;
    const f = s[i]?.toLowerCase();
    if (f === 'i' || f === 's') {
      flag = f;
      i += 1;
      skipSpace();
    }
    if (s[i] !== ']') return null;
    i += 1;
    return { name: asciiLower(name), op, value, flag };
  };
  const list: Compound[] = [];
  for (;;) {
    skipSpace();
    const compound: Compound = { type: null, ids: [], classes: [], attributes: [] };
    let parts = 0;
    if (s[i] === '*') {
      i += 1;
      parts += 1;
    } else {
      const type = ident();
      if (type === null) return null;
      if (type !== '') {
        compound.type = asciiLower(type);
        parts += 1;
      }
    }
    for (;;) {
      const c = s[i];
      if (c === '#' || c === '.') {
        i += 1;
        const name = ident();
        if (name === null || name === '') return null;
        (c === '#' ? compound.ids : compound.classes).push(name);
      } else if (c === '[') {
        i += 1;
        const test = attribute();
        if (test === null) return null;
        compound.attributes.push(test);
      } else break;
      parts += 1;
    }
    if (parts === 0) return null;
    list.push(compound);
    skipSpace();
    if (i >= n) return list;
    if (s[i] !== ',') return null; // a combinator, a pseudo-class or anything else
    i += 1;
  }
}

/** True when the quick check can test `selector` on static HTML (the platform test lists every selector of the fingerprints). */
export function staticSelectorSupported(selector: string): boolean {
  return compileSelector(selector) !== null;
}

function splitAsciiSpace(s: string): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= s.length; i += 1) {
    const space = i === s.length || isAsciiSpace(s.charCodeAt(i));
    if (space && start !== -1) {
      out.push(s.slice(start, i));
      start = -1;
    } else if (!space && start === -1) start = i;
  }
  return out;
}

function matchesAttribute(el: ElementNode, test: AttributeTest): boolean {
  const actual = attr(el, test.name);
  if (actual === null) return false;
  if (test.op === '') return true;
  const ignoreCase = test.flag === 'i' || (test.flag === null && el.ns === HTML && CASE_INSENSITIVE_ATTRIBUTES.has(test.name));
  const v = ignoreCase ? asciiLower(actual) : actual;
  const w = ignoreCase ? asciiLower(test.value) : test.value;
  switch (test.op) {
    case '=':
      return v === w;
    case '~=':
      return w !== '' && !/[\t\n\f\r ]/.test(w) && splitAsciiSpace(v).includes(w);
    case '|=':
      return v === w || v.startsWith(`${w}-`);
    case '^=':
      return w !== '' && v.startsWith(w);
    case '$=':
      return w !== '' && v.endsWith(w);
    case '*=':
      return w !== '' && v.includes(w);
  }
}

function matchesCompound(el: ElementNode, compound: Compound, quirks: boolean): boolean {
  if (compound.type !== null && el.name !== compound.type) return false;
  const same = (a: string, b: string): boolean => (quirks ? asciiLower(a) === asciiLower(b) : a === b);
  for (const id of compound.ids) {
    const value = attr(el, 'id');
    if (value === null || !same(value, id)) return false;
  }
  if (compound.classes.length > 0) {
    const tokens = splitAsciiSpace(attr(el, 'class') ?? '');
    for (const name of compound.classes) if (!tokens.some((token) => same(token, name))) return false;
  }
  return compound.attributes.every((test) => matchesAttribute(el, test));
}

// ---------------------------------------------------------------------------------------------
// The document index: elements in document order, by name, and the footer test

interface DocumentIndex {
  all: ElementNode[];
  byName: Map<string, ElementNode[]>;
  /** The textContent of the document; an element's textContent is `text.slice(textStart, textEnd)`, so nested links cost nothing extra. */
  text: string;
}

/** Elements of the document in tree order (template contents excluded, as for `querySelectorAll`). */
function indexDocument(html: ElementNode): DocumentIndex {
  const all: ElementNode[] = [];
  const byName = new Map<string, ElementNode[]>();
  const parts: string[] = [];
  let length = 0;
  const visit = (el: ElementNode): boolean => {
    all.push(el);
    let list = byName.get(el.name);
    if (list === undefined) {
      list = [];
      byName.set(el.name, list);
    }
    list.push(el);
    el.textStart = length;
    let contains = false;
    if (!(el.ns === HTML && el.name === 'template')) {
      for (const child of el.children) {
        if (child.t === 3) {
          parts.push(child.text);
          length += child.text.length;
        } else if (visit(child)) contains = true;
      }
    }
    el.textEnd = length;
    el.hasHeaderOrMain = contains;
    if (contains) return true;
    const role = attr(el, 'role');
    return el.name === 'header' || el.name === 'main' || role === 'main' || role === 'banner';
  };
  visit(html);
  return { all, byName, text: parts.join('') };
}

/** The footer test of the in-page script: `<footer>`, `role="contentinfo"`, or an id or class naming a footer without a header or main part inside. */
function isFooterBox(el: ElementNode): boolean {
  if (el.footerBox === 0) {
    let result = el.name === 'footer' || attr(el, 'role') === 'contentinfo';
    if (!result) {
      const names = `${attr(el, 'id') ?? ''} ${attr(el, 'class') ?? ''}`.toLowerCase();
      if (names.indexOf('footer') !== -1 && el.name !== 'body' && el.name !== 'html') result = !el.hasHeaderOrMain;
    }
    el.footerBox = result ? 2 : 1;
  }
  return el.footerBox === 2;
}

/** Is `el` or one of its ancestors below the root a footer box? (Memoized, so many links in a deep tree stay linear.) */
function inFooterBox(el: ElementNode | null, root: ElementNode): boolean {
  if (el === null || el === root) return false;
  if (el.footerAncestor === 0) el.footerAncestor = isFooterBox(el) || inFooterBox(el.parent, root) ? 2 : 1;
  return el.footerAncestor === 2;
}

// ---------------------------------------------------------------------------------------------
// Rendering: the approximation of innerText

interface InlineStyle {
  display?: string;
  visibility?: string;
  whiteSpace?: string;
  float?: string;
  position?: string;
  transform?: string;
  contentVisibility?: string;
}

function inlineStyleOf(el: ElementNode): InlineStyle | null {
  const css = attr(el, 'style');
  if (css === null || css.indexOf(':') === -1) return null;
  const style: InlineStyle = {};
  for (const declaration of css.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) continue;
    const property = trimAscii(declaration.slice(0, colon)).toLowerCase();
    let value = trimAscii(declaration.slice(colon + 1)).toLowerCase();
    const bang = value.lastIndexOf('!');
    if (bang !== -1 && trimAscii(value.slice(bang + 1)) === 'important') value = trimAscii(value.slice(0, bang));
    switch (property) {
      case 'display':
        style.display = value;
        break;
      case 'visibility':
        style.visibility = value;
        break;
      case 'white-space':
      case 'white-space-collapse':
        style.whiteSpace = value;
        break;
      case 'float':
        style.float = value;
        break;
      case 'position':
        style.position = value;
        break;
      case 'text-transform':
        style.transform = value;
        break;
      case 'content-visibility':
        style.contentVisibility = value;
        break;
      default:
    }
  }
  return style;
}

type Display = 'none' | 'contents' | 'inline' | 'block' | 'inline-block' | 'replaced' | 'replaced-block' | 'select' | 'row' | 'cell' | 'section' | 'br';

/** Elements the browser never renders, whatever the page's style says. */
const NEVER_RENDERED = new Set([
  'head', 'script', 'style', 'title', 'meta', 'link', 'base', 'template', 'noscript', 'noembed', 'noframes', 'area', 'datalist', 'param', 'rp',
  'source', 'track', 'col', 'colgroup', 'basefont', 'bgsound', 'frame', 'frameset',
]);
const DEFAULT_DISPLAY = new Map<string, Display>([
  ...[
    'html', 'body', 'address', 'blockquote', 'center', 'div', 'figure', 'figcaption', 'footer', 'form', 'header', 'hr', 'legend', 'listing',
    'main', 'p', 'plaintext', 'pre', 'xmp', 'search', 'article', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup', 'nav', 'section',
    'dd', 'dl', 'dt', 'menu', 'ol', 'ul', 'dir', 'fieldset', 'details', 'summary', 'li', 'optgroup', 'option', 'table', 'caption', 'dialog',
  ].map((name): [string, Display] => [name, 'block']),
  ...['img', 'iframe', 'embed', 'object', 'video', 'audio', 'canvas', 'textarea', 'input', 'meter', 'progress'].map((name): [string, Display] => [name, 'replaced']),
  ['tr', 'row'], ['td', 'cell'], ['th', 'cell'], ['thead', 'section'], ['tbody', 'section'], ['tfoot', 'section'],
  ['button', 'inline-block'], ['marquee', 'inline-block'], ['select', 'select'], ['br', 'br'],
]);
const FLEX_DISPLAYS = new Set(['flex', 'inline-flex', 'grid', 'inline-grid', '-webkit-box', '-webkit-inline-box', '-webkit-flex', '-webkit-inline-flex', '-ms-flexbox', '-ms-inline-flexbox']);
const BLOCK_DISPLAYS = new Set(['block', 'flow-root', 'flex', 'grid', 'table', 'list-item', 'flow', '-webkit-box', '-webkit-flex', '-ms-flexbox', 'table-caption']);
/** Floated elements are blockified like flex items. */
const FLOATS = new Set(['left', 'right', 'inline-start', 'inline-end']);
const INLINE_BLOCK_DISPLAYS = new Set(['inline-block', 'inline-flex', 'inline-grid', 'inline-table', '-webkit-inline-box', '-webkit-inline-flex', '-ms-inline-flexbox']);

/** `hidden="until-found"`: not `display: none` but `content-visibility: hidden` (Chromium's style sheet for HTML elements). */
function hiddenUntilFound(el: ElementNode): boolean {
  const hidden = attr(el, 'hidden');
  return hidden !== null && asciiLower(hidden) === 'until-found';
}

function blockified(style: InlineStyle | null, parentFlex: boolean): boolean {
  return parentFlex || (style !== null && (FLOATS.has(style.float ?? '') || style.position === 'absolute' || style.position === 'fixed'));
}

function displayOf(el: ElementNode, style: InlineStyle | null, parentFlex: boolean): Display {
  if (el.ns === SVG) {
    // The <svg> root is an image; the `hidden` attribute does not apply to it (Chromium checked), its style does.
    if (el.name !== 'svg' || style?.display === 'none') return 'none';
    const block = blockified(style, parentFlex) || (style?.display !== undefined && BLOCK_DISPLAYS.has(style.display));
    return block ? 'replaced-block' : 'replaced';
  }
  if (el.ns === MATH) return 'inline';
  if (NEVER_RENDERED.has(el.name)) return 'none';
  let display: Display = DEFAULT_DISPLAY.get(el.name) ?? 'inline';
  if (el.name === 'input' && asciiLower(attr(el, 'type') ?? '') === 'hidden') return 'none';
  if (el.name === 'audio' && attr(el, 'controls') === null) display = 'none';
  if (el.name === 'dialog' && attr(el, 'open') === null) display = 'none';
  // `hidden` is `display: none`; `hidden="until-found"` only skips the contents of a block (`skipsContents` in the renderer).
  if (attr(el, 'hidden') !== null && !hiddenUntilFound(el)) display = 'none';
  const set = style?.display;
  if (set !== undefined) {
    const special = display === 'replaced' || display === 'select' || display === 'br' ? display : null;
    if (set === 'none') return 'none';
    if (BLOCK_DISPLAYS.has(set)) display = special === 'replaced' ? 'replaced-block' : (special ?? 'block');
    else if (INLINE_BLOCK_DISPLAYS.has(set) || set === 'inline') display = special ?? (set === 'inline' ? 'inline' : 'inline-block');
    else if (set === 'contents') display = special === null ? 'contents' : 'none';
    else if (set === 'table-row') display = 'row';
    else if (set === 'table-cell') display = 'cell';
    else if (set === 'table-row-group' || set === 'table-header-group' || set === 'table-footer-group') display = 'section';
  }
  if (display === 'none' || display === 'br') return display;
  if (blockified(style, parentFlex)) {
    if (display === 'inline' || display === 'inline-block') return 'block';
    if (display === 'replaced') return 'replaced-block';
  }
  return display;
}

/** White space: 0 collapse, 1 preserve, 2 preserve line breaks only. Transform: 0 none, 1 upper case, 2 lower case. */
interface RenderContext {
  visible: boolean;
  whiteSpace: number;
  transform: number;
}

function contextOf(parent: RenderContext, el: ElementNode, style: InlineStyle | null): RenderContext {
  let { visible, whiteSpace, transform } = parent;
  if (el.ns === HTML && (el.name === 'pre' || el.name === 'listing' || el.name === 'xmp' || el.name === 'plaintext')) whiteSpace = 1;
  if (style !== null) {
    if (style.visibility === 'hidden' || style.visibility === 'collapse') visible = false;
    else if (style.visibility === 'visible') visible = true;
    const ws = style.whiteSpace;
    if (ws === 'normal' || ws === 'nowrap' || ws === 'collapse') whiteSpace = 0;
    else if (ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces' || ws === 'preserve' || ws === 'preserve-spaces') whiteSpace = 1;
    else if (ws === 'pre-line' || ws === 'preserve-breaks') whiteSpace = 2;
    if (style.transform === 'uppercase') transform = 1;
    else if (style.transform === 'lowercase') transform = 2;
    else if (style.transform === 'none') transform = 0;
  }
  return visible === parent.visible && whiteSpace === parent.whiteSpace && transform === parent.transform ? parent : { visible, whiteSpace, transform };
}

const ITEM_TEXT = 0;
const ITEM_BREAKS = 1;
const ITEM_NEWLINE = 2;
const ITEM_TAB = 3;

interface Item {
  kind: number;
  text: string;
  /** Required line break count of an `ITEM_BREAKS`. */
  count: number;
  visible: boolean;
}

/**
 * Walks the rendered tree in the order of Chromium's innerText collector (`element_inner_text.cc`):
 * text with the white space that layout keeps (runs collapsed to one space; removed at the start and end
 * of a block, around `<br>` and at a forced line break; kept next to images and other atomic inlines),
 * required line breaks around blocks (2 for `<p>`), a tab after a table cell that is not the last of its
 * row, a line feed after a row that is not the last of its table.
 */
class Renderer {
  readonly items: Item[] = [];
  /** Item ranges of the rendered `<a>` elements, for their innerText. */
  readonly ranges = new Map<ElementNode, [number, number]>();
  /**
   * `<a>` elements in contents that a rendered box skips with `content-visibility: hidden` (a closed `<details>`
   * apart from its summary, `hidden="until-found"`, the style attribute): Chromium's innerText of such a link is
   * empty, not its textContent (`element_inner_text.cc`: "If this element is locked … innerText should be empty").
   */
  readonly locked = new Set<ElementNode>();
  /** The table box of the rows of a parent (the parent itself, or the table around a row group), and the last row of each table box. */
  private readonly rowTables = new Map<ElementNode, ElementNode>();
  private readonly lastRows = new Map<ElementNode, ElementNode | null>();
  private atLineStart = true;
  private pending = -1;

  /** Skipped contents: nothing of them is text; their links are locked. Each subtree is walked once, so this stays linear. */
  private lock(root: ElementNode): void {
    const stack = [root];
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
      if (node.ns === HTML && node.name === 'a') this.locked.add(node);
      if (node.ns === HTML && node.name === 'template') continue;
      for (const child of node.children) if (child.t === 1) stack.push(child);
    }
  }

  private boundary(): void {
    if (this.pending >= 0) {
      const item = this.items[this.pending] as Item;
      item.text = item.text.slice(0, -1);
      this.pending = -1;
    }
    this.atLineStart = true;
  }

  private atomic(): void {
    this.pending = -1;
    this.atLineStart = false;
  }

  private breaks(count: number): void {
    this.items.push({ kind: ITEM_BREAKS, text: '', count, visible: true });
  }

  private push(kind: number, text: string, visible: boolean): void {
    this.items.push({ kind, text, count: 0, visible });
  }

  private text(raw: string, context: RenderContext): void {
    let out: string;
    if (context.whiteSpace === 1) {
      if (raw === '') return;
      if (raw.charCodeAt(0) === 0x0a && this.pending >= 0) this.boundary();
      out = raw;
      this.pending = -1;
      this.atLineStart = raw.charCodeAt(raw.length - 1) === 0x0a;
    } else {
      out = context.whiteSpace === 2 ? raw.replace(/[ \t\r\f]+/g, ' ').replace(/ ?\n ?/g, '\n') : raw.replace(/[ \t\n\r\f]+/g, ' ');
      if (this.atLineStart && out.charCodeAt(0) === 0x20) out = out.slice(1);
      if (out === '') return;
      if (out.charCodeAt(0) === 0x0a && this.pending >= 0) this.boundary();
      const last = out.charCodeAt(out.length - 1);
      this.atLineStart = last === 0x20 || last === 0x0a;
      this.pending = last === 0x20 ? this.items.length : -1;
    }
    if (context.transform === 1) out = out.toUpperCase();
    else if (context.transform === 2) out = out.toLowerCase();
    this.push(ITEM_TEXT, out, context.visible);
  }

  element(el: ElementNode, context: RenderContext, parentFlex: boolean, hasNextSibling = false): void {
    const style = inlineStyleOf(el);
    const display = displayOf(el, style, parentFlex);
    if (display === 'none') return;
    const own = contextOf(context, el, style);
    const start = this.items.length;
    const flex = style?.display !== undefined && FLEX_DISPLAYS.has(style.display);
    const isP = el.ns === HTML && el.name === 'p';
    // `content-visibility: hidden` applies to boxes with layout containment, not to inline boxes (Chromium checked).
    const skipsContents =
      (style?.contentVisibility === 'hidden' || (el.ns === HTML && hiddenUntilFound(el))) && (display === 'block' || display === 'inline-block' || display === 'cell');
    const contents = (): void => (skipsContents ? this.lock(el) : this.children(el, own, flex));
    switch (display) {
      case 'br':
        this.boundary();
        this.push(ITEM_NEWLINE, '\n', true);
        break;
      case 'replaced':
        this.atomic();
        break;
      case 'replaced-block':
        // A block-level image is a line of its own: "a<img style="display:block">b" is "a\nb".
        this.boundary();
        this.breaks(1);
        break;
      case 'select':
        this.atomic();
        this.select(el, own);
        this.atomic();
        break;
      case 'inline':
      case 'contents':
        if (isP && display === 'inline') this.breaks(2);
        this.children(el, own, flex);
        if (isP && display === 'inline') this.breaks(2);
        break;
      case 'block': {
        const count = isP ? 2 : 1;
        this.boundary();
        this.breaks(count);
        contents();
        this.boundary();
        this.breaks(count);
        break;
      }
      case 'inline-block':
        // A <p> has its two required line breaks whatever its display (Chromium checked for inline-block and inline-flex).
        if (isP) this.breaks(2);
        this.atomic();
        this.atLineStart = true;
        contents();
        this.boundary();
        this.atomic();
        if (isP) this.breaks(2);
        break;
      case 'cell':
        this.boundary();
        contents();
        this.boundary();
        // A cell that is not the last box of its row.
        if (hasNextSibling) this.push(ITEM_TAB, '\t', true);
        break;
      case 'row':
        this.boundary();
        this.children(el, own, false, true);
        this.boundary();
        if (!this.isLastRow(el)) this.push(ITEM_NEWLINE, '\n', true);
        break;
      case 'section':
        this.children(el, own, false);
        break;
    }
    if (el.ns === HTML && el.name === 'a') this.ranges.set(el, [start, this.items.length]);
  }

  /** `row`: tell each child whether a rendered element follows it (found once per row, from the end, so a long row stays linear). */
  children(el: ElementNode, context: RenderContext, flex: boolean, row = false): void {
    const tableContext = el.ns === HTML && TABLE_CONTEXT.has(el.name);
    const closedDetails = el.ns === HTML && el.name === 'details' && attr(el, 'open') === null;
    let lastRendered = -1;
    if (row) {
      for (let i = el.children.length - 1; i >= 0 && lastRendered === -1; i -= 1) {
        const child = el.children[i] as TreeNode;
        if (child.t === 1 && displayOf(child, inlineStyleOf(child), false) !== 'none') lastRendered = i;
      }
    }
    let summary = false;
    for (let i = 0; i < el.children.length; i += 1) {
      const child = el.children[i] as TreeNode;
      if (child.t === 3) {
        if (closedDetails || ((tableContext || flex) && isBlank(child.text))) continue;
        if (flex) this.boundary();
        this.text(child.text, context);
        if (flex) this.boundary();
        continue;
      }
      if (closedDetails) {
        if (summary || !(child.ns === HTML && child.name === 'summary')) {
          this.lock(child);
          continue;
        }
        summary = true;
      }
      this.element(child, context, flex, i < lastRendered);
    }
  }

  /**
   * `<select>`: every option on its own line (Chromium's innerText does this; the select is an atomic inline). The line is
   * the option's text, never its `label` attribute (Chromium checked: `<option label="AT">Österreich` gives "Österreich").
   */
  private select(el: ElementNode, context: RenderContext): void {
    const option = (o: ElementNode): void => {
      this.breaks(1);
      const label = stripAndCollapse(textContentOf(o, LINK_TEXT_READ));
      if (label !== '') this.push(ITEM_TEXT, label, context.visible);
      this.breaks(1);
    };
    for (const child of el.children) {
      if (child.t !== 1 || child.ns !== HTML) continue;
      if (child.name === 'option') option(child);
      else if (child.name === 'optgroup') {
        this.breaks(1);
        for (const inner of child.children) if (inner.t === 1 && inner.ns === HTML && inner.name === 'option') option(inner);
        this.breaks(1);
      }
    }
  }

  /**
   * Is `row` the last row box of its table box? By display, not by tag, so rows made with `display: table-row` in the
   * style attribute count too (Chromium checked: "Firma\tMuster GmbH\nHRB\t98765"). Cached per parent and per table, so linear.
   */
  private isLastRow(row: ElementNode): boolean {
    const parent = row.parent;
    if (parent === null) return true;
    let table = this.rowTables.get(parent);
    if (table === undefined) {
      table = parent.parent !== null && displayOf(parent, inlineStyleOf(parent), false) === 'section' ? parent.parent : parent;
      this.rowTables.set(parent, table);
    }
    let last = this.lastRows.get(table);
    if (last === undefined) {
      last = lastRowOf(table);
      this.lastRows.set(table, last);
    }
    return last === null || last === row;
  }
}

/** The last rendered row box of a table box (its rows and the rows of its row groups, in document order). */
function lastRowOf(table: ElementNode): ElementNode | null {
  let last: ElementNode | null = null;
  const isRow = (el: ElementNode): boolean => displayOf(el, inlineStyleOf(el), false) === 'row';
  for (const child of table.children) {
    if (child.t !== 1) continue;
    const display = displayOf(child, inlineStyleOf(child), false);
    if (display === 'row') last = child;
    else if (display === 'section') for (const row of child.children) if (row.t === 1 && isRow(row)) last = row;
  }
  return last;
}

/** `textContent`, read up to `cap` characters (template contents are not children). */
function textContentOf(el: ElementNode, cap: number): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (node: ElementNode): boolean => {
    if (node.ns === HTML && node.name === 'template') return true;
    for (const child of node.children) {
      if (child.t === 3) {
        parts.push(child.text);
        length += child.text.length;
        if (length >= cap) return false;
      } else if (!walk(child)) return false;
    }
    return true;
  };
  walk(el);
  const text = parts.join('');
  return text.length > cap ? text.slice(0, cap) : text;
}

function stripAndCollapse(s: string): string {
  return trimAscii(s.replace(/[\t\n\f\r ]+/g, ' '));
}

interface RenderedText {
  text: string;
  /** innerText of a rendered `<a>` (read up to `cap` characters), '' in skipped contents, or null when it is not rendered. */
  innerTextOf(el: ElementNode, cap: number): string | null;
}

/** Joins the items as Chromium's innerText result builder does and remembers where each item landed, so every link's innerText is a slice. */
function buildText(renderer: Renderer): RenderedText {
  const items = renderer.items;
  const starts = new Int32Array(items.length).fill(-1);
  const ends = new Int32Array(items.length).fill(-1);
  const parts: string[] = [];
  let length = 0;
  let pending = 0;
  let empty = true;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as Item;
    if (item.kind === ITEM_BREAKS) {
      if (!empty && item.count > pending) pending = item.count;
      continue;
    }
    if (!item.visible || item.text === '') continue;
    if (pending > 0) {
      parts.push(pending === 2 ? '\n\n' : '\n');
      length += pending;
      pending = 0;
    }
    starts[i] = length;
    parts.push(item.text);
    length += item.text.length;
    ends[i] = length;
    empty = false;
  }
  const text = parts.join('');
  // First content item at or after i, last content item before i.
  const next = new Int32Array(items.length + 1).fill(items.length);
  for (let i = items.length - 1; i >= 0; i -= 1) next[i] = (starts[i] as number) >= 0 ? i : (next[i + 1] as number);
  const previous = new Int32Array(items.length + 1).fill(-1);
  for (let i = 1; i <= items.length; i += 1) previous[i] = (starts[i - 1] as number) >= 0 ? i - 1 : (previous[i - 1] as number);
  return {
    text,
    innerTextOf(el: ElementNode, cap: number): string | null {
      if (renderer.locked.has(el)) return '';
      const range = renderer.ranges.get(el);
      if (range === undefined) return null;
      const first = next[range[0]] as number;
      const last = previous[range[1]] as number;
      if (first >= range[1] || last < range[0]) return '';
      const from = starts[first] as number;
      return text.slice(from, Math.min(ends[last] as number, from + cap));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The snapshot

function absoluteUrl(href: string, base: string | null): string {
  return base === null ? new URL(href).href : new URL(href, base).href;
}

/**
 * The page snapshot from the HTML of a page, as the in-page scripts of the browser adapters would return
 * it for the same document without running its scripts: `url` (the document address), `title`, `lang`,
 * the visible text (an approximation of `innerText`, at most 100,000 characters), the links (at most 1,500
 * plus up to 100 legal links, each with the text, the address resolved against `<base href>` and the
 * footer flag) and `securityMeta`. With `platform: true` (the homepage) also the system hints: generator
 * meta tags and the fingerprint selectors that match; `globals` is always empty, since no script runs.
 */
export function snapshotFromHtml(html: string, documentUrl: string, options: { platform?: boolean } = {}): PageSnapshot {
  const doc = parseDocument(html);
  const body = doc.body as ElementNode;
  const quirks = doc.quirks === true;
  const index = indexDocument(doc.html);
  const named = (name: string): ElementNode[] => index.byName.get(name) ?? [];

  let url: string | null;
  try {
    url = new URL(documentUrl).href;
  } catch {
    url = null;
  }
  let base = url;
  const baseElement = named('base').find((el) => el.ns === HTML && attr(el, 'href') !== null);
  if (baseElement !== undefined) {
    try {
      const resolved = new URL(attr(baseElement, 'href') ?? '', url ?? undefined);
      if (resolved.protocol !== 'data:' && resolved.protocol !== 'javascript:') base = resolved.href;
    } catch {
      // an invalid base keeps the document address
    }
  }

  const titleElement = named('title').find((el) => el.ns === HTML);
  const title = titleElement === undefined ? '' : stripAndCollapse(titleElement.children.map((c) => (c.t === 3 ? c.text : '')).join(''));
  const lang = attr(doc.html, 'lang');

  // document.body.innerText; when the body is not rendered at all, innerText is its textContent.
  const rootContext: RenderContext = { visible: true, whiteSpace: 0, transform: 0 };
  const bodyRendered = displayOf(doc.html, inlineStyleOf(doc.html), false) !== 'none' && displayOf(body, inlineStyleOf(body), false) !== 'none';
  const renderer = new Renderer();
  if (bodyRendered) renderer.element(body, contextOf(rootContext, doc.html, inlineStyleOf(doc.html)), false);
  const rendered = buildText(renderer);
  const textContent = (el: ElementNode, cap: number): string => index.text.slice(el.textStart, Math.min(el.textEnd, el.textStart + cap));
  const text = bodyRendered ? rendered.text : textContent(body, Number.POSITIVE_INFINITY);

  let linkTextLeft = LINK_TEXT_BUDGET;
  const innerText = (a: ElementNode): string | undefined => {
    if (a.ns !== HTML) return undefined; // SVG links have no innerText
    const cap = Math.max(LINK_TEXT_MIN, Math.min(LINK_TEXT_READ, linkTextLeft));
    const read = rendered.innerTextOf(a, cap) ?? textContent(a, cap);
    linkTextLeft -= read.length;
    return read;
  };
  const anchors = named('a').filter((a) => attr(a, 'href') !== null);
  const legal = new RegExp(SNAPSHOT_LEGAL_WORDS, 'i');
  // Session fix-a4, as in the in-page script: a link whose resolved address is longer than the limit is left
  // out, and all links share a budget of characters (a long `<base href>` is otherwise repeated in every
  // link); the last part of the budget is kept for links that name a legal page.
  let linkChars = 0;
  let linksLeftOut = false;
  const baseTooLong = base !== null && base.length > CAPTURE_LIMITS.urlLength;
  const linkOf = (a: ElementNode): PageLink | null => {
    const raw = attr(a, 'href') ?? '';
    // An address longer than the limit is not even resolved.
    if (raw.length > CAPTURE_LIMITS.urlLength) return null;
    let href = raw;
    try {
      // A base address over the limit is not parsed again for every link: only links that are absolute
      // themselves are kept, a relative one would be longer than the limit anyway.
      href = baseTooLong ? new URL(raw).href : absoluteUrl(raw, base);
    } catch {
      if (baseTooLong) return null;
      href = raw;
    }
    if (href.length > CAPTURE_LIMITS.urlLength) return null;
    const label = (innerText(a) || attr(a, 'aria-label') || attr(a, 'title') || '').replace(/\s+/g, ' ').trim().slice(0, SNAPSHOT_LINK_TEXT_LENGTH);
    const budget = legal.test(`${label} ${raw}`) ? CAPTURE_LIMITS.linkChars : CAPTURE_LIMITS.linkChars - LEGAL_LINK_RESERVE;
    if (linkChars + href.length > budget) return null;
    linkChars += href.length;
    return { href, text: label, footer: inFooterBox(a.parent, doc.html) };
  };
  const links: PageLink[] = [];
  let extra = 0;
  for (let i = 0; i < anchors.length && i < LINK_SCAN_MAX && links.length < SNAPSHOT_MAX_LINKS + SNAPSHOT_MAX_EXTRA_LINKS; i += 1) {
    const a = anchors[i] as ElementNode;
    if (i >= SNAPSHOT_MAX_LINKS) {
      if (extra >= SNAPSHOT_MAX_EXTRA_LINKS) break;
      const words = `${innerText(a) || ''} ${attr(a, 'aria-label') || ''} ${attr(a, 'title') || ''} ${(attr(a, 'href') || '').slice(0, CAPTURE_LIMITS.urlLength)}`;
      if (!legal.test(words)) continue;
    }
    const link = linkOf(a);
    if (link === null) {
      linksLeftOut = true;
      continue;
    }
    links.push(link);
    if (i >= SNAPSHOT_MAX_LINKS) extra += 1;
  }

  const metas = named('meta');
  const metaContent = (test: (el: ElementNode) => boolean, max: number): string | null => {
    const el = metas.find(test);
    return el === undefined ? null : (attr(el, 'content') || '').slice(0, max);
  };
  const securityMeta: SecurityMeta = {
    // Session fix-a6 (review finding 77): browsers apply a CSP meta element only as a child of <head>.
    csp: metaContent((el) => el.parent?.name === 'head' && asciiLower(attr(el, 'http-equiv') ?? '') === 'content-security-policy', SNAPSHOT_META_LENGTH),
    referrer: metaContent((el) => asciiLower(attr(el, 'name') ?? '') === 'referrer', SNAPSHOT_META_LENGTH),
  };

  const snapshot: PageSnapshot = {
    url: cutText(url ?? documentUrl, CAPTURE_LIMITS.urlLength),
    title: cutText(title, CAPTURE_LIMITS.titleLength),
    lang: lang === null ? null : cutText(lang, CAPTURE_LIMITS.langLength),
    text: text.slice(0, SNAPSHOT_MAX_TEXT),
    textTruncated: text.length > SNAPSHOT_MAX_TEXT,
    links,
    linksTruncated: anchors.length > SNAPSHOT_MAX_LINKS || linksLeftOut,
    securityMeta,
  };
  if (options.platform === true) {
    const generators = metas
      .filter((el) => asciiLower(attr(el, 'name') ?? '') === 'generator')
      .slice(0, SNAPSHOT_MAX_GENERATORS)
      .map((el) => (attr(el, 'content') || '').slice(0, SNAPSHOT_GENERATOR_LENGTH));
    const selectors = PLATFORM_SELECTORS.filter((selector) => {
      const compiled = compileSelector(selector);
      return compiled !== null && compiled.some((compound) => (compound.type === null ? index.all : named(compound.type)).some((el) => matchesCompound(el, compound, quirks)));
    });
    const platform: PlatformHints = { generators, globals: [], selectors };
    snapshot.platform = platform;
  }
  return snapshot;
}
