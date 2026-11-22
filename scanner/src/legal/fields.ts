import type { PageLink } from '../capture/types.ts';

/**
 * Fields of the Impressum found with templates (session A4; the owner decided on 19.11.2026 that
 * templates come first, the Claude API only later if the templates miss often on live sites).
 *
 * Input is the visible text of the Impressum page (`innerText`) and its links. Every field is either
 * found, with the exact quote from the text (or the link address for a mailto or Cloudflare link), or
 * not found. "Not found" means "nicht gefunden, bitte manuell prüfen", never "fehlt": an e-mail shown
 * as an image is on the page, but the scan cannot read it.
 *
 * The operator's data comes first in reading order. Data that the text marks as belonging to someone
 * else is skipped: web agency and hosting credits, photo credits, the consumer arbitration board, the
 * chamber, the supervisory authority, the liability insurer, an external data protection officer.
 */

export interface AddressValue {
  street: string;
  postcode: string;
  town: string;
}

export type EmailForm = 'plain' | 'mailto' | 'obfuscated' | 'cloudflare';

export interface EmailValue {
  value: string;
  form: EmailForm;
}

export interface RegisterValue {
  register: 'HRA' | 'HRB';
  number: string;
  /** Town of the register court, or null when the page names no court near the number. */
  court: string | null;
}

export interface FoundField<T> {
  status: 'found';
  /** Exact quote: a part of the page text, or the link address for a mailto or Cloudflare link. */
  quote: string;
  source: 'text' | 'link';
  value: T;
}

export interface MissingField {
  status: 'not-found';
  /** `not-on-page`: the template found nothing; `impressum-not-checked`: there was no Impressum text to search. */
  reason: 'not-on-page' | 'impressum-not-checked';
}

export type FieldResult<T> = FoundField<T> | MissingField;

export interface ImpressumFields {
  address: FieldResult<AddressValue>;
  email: FieldResult<EmailValue>;
  handelsregister: FieldResult<RegisterValue>;
  ustId: FieldResult<string>;
}

export const IMPRESSUM_FIELDS = ['address', 'email', 'handelsregister', 'ustId'] as const;
export type ImpressumFieldId = (typeof IMPRESSUM_FIELDS)[number];

const NOT_ON_PAGE: MissingField = { status: 'not-found', reason: 'not-on-page' };

export function fieldsNotChecked(): ImpressumFields {
  const missing: MissingField = { status: 'not-found', reason: 'impressum-not-checked' };
  return { address: missing, email: missing, handelsregister: missing, ustId: missing };
}

export function extractImpressumFields(text: string, links: readonly PageLink[] = []): ImpressumFields {
  const email = findEmail(text, links);
  return {
    address: findAddress(text),
    email,
    handelsregister: findRegister(text),
    ustId: findVatId(text),
  };
}

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Horizontal whitespace as `innerText` gives it (tables give tabs, `&nbsp;` gives U+00A0). */
const H = '[ \\t\\u00a0\\u2009\\u202f]';

interface Line {
  start: number;
  end: number;
  text: string;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (;;) {
    const end = text.indexOf('\n', start);
    const stop = end === -1 ? text.length : end;
    lines.push({ start, end: stop, text: text.slice(start, stop) });
    if (end === -1) break;
    start = end + 1;
  }
  return lines;
}

function lineIndexAt(lines: readonly Line[], position: number): number {
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lines[mid] as Line).start <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Labels that mark someone else's data. "Anywhere" words are specific enough to count anywhere in a
 * line; the general words count only at the start of a line, followed by a separator or nothing
 * (so a company called "Webdesign Huber GmbH" is not taken for a credit line).
 */
const THIRD_PARTY_ANYWHERE =
  /schlichtungsstelle|verbraucherschlichtung|streitbeilegung|streitschlichtung|universalschlichtung|aufsichtsbeh(?:ö|oe)rde|zust(?:ä|ae)ndige (?:kammer|beh(?:ö|oe)rde)|datenschutzbeauftragte|data protection officer|berufshaftpflicht|haftpflichtversicher|versicherer|arbitration board|dispute resolution|supervisory authority|webdesign (?:by|von|durch)|website (?:by|von|erstellt|realisiert)|realisiert (?:von|durch)|erstellt (?:von|durch)|umgesetzt (?:von|durch)|gestaltet (?:von|durch)|design(?:ed)? by|made by|powered by|hosted by|gehostet (?:von|bei)/iu;
const THIRD_PARTY_LINE_START =
  /^[\s ]*(?:web-?design|web design|design|gestaltung|grafik|layout|konzept(?:ion)?|umsetzung|technische umsetzung|realisierung|programmierung|entwicklung|technik|webentwicklung|hosting|webhosting|hoster|provider|serverstandort|bildnachweise?|bildquellen?|bildrechte|bilder|fotos?|fotografie|fotonachweise?|fotograf(?:in)?|quellen?(?:angaben)?|credits|copyright (?:der )?(?:bilder|fotos)|agentur|seo|betreuung|kammer|berufskammer|handwerkskammer|ihk|aufsicht|versicherung|haftpflicht|schlichtung|datenschutzbeauftragte[rn]?|external dpo|wo|wann|veranstaltungsort|kursort|kursraum|treffpunkt|location|venue)(?:[\s ]*(?::|&|\+|\/|,|–|-[\s ]|\(|und\b|by\b|von\b|durch\b|bei\b)|[\s ]*$)/iu;

/** A line that names a court or a register: an address right below it is the court's, not the operator's. */
const COURT_LINE = /^[\s ]*(?:amtsgerichts?|registergericht|handelsregister(?:gericht)?|local court|district court|regist(?:ry|er) court)(?![\p{L}])/iu;
/** Lines that start the operator's own data: the search for a third-party label stops there. */
const OPERATOR_LINE = /angaben gem(?:ä|ae)(?:ß|ss)|^[\s ]*(?:impressum|kontakt|inhaber(?:in)?|betreiber(?:in)?|anbieter(?:in)?|herausgeber(?:in)?|diensteanbieter|verantwortlich|vertreten durch|gesch(?:ä|ae)ftsf(?:ü|ue)hr|website operator|operator|provider|owner)(?![\p{L}])/iu;

/**
 * For addresses (site builders put every line in its own paragraph, so a label can sit two blocks
 * above): up to two non-empty lines above the block, across empty lines, that name a third party or a
 * court. Stops at a line that starts the operator's data.
 */
function thirdPartyAbove(lines: readonly Line[], firstLine: number): boolean {
  let seen = 0;
  for (let i = firstLine - 1; i >= 0 && seen < 2; i -= 1) {
    const line = (lines[i] as Line).text;
    if (line.trim() === '') continue;
    if (OPERATOR_LINE.test(line)) return false;
    if (THIRD_PARTY_ANYWHERE.test(line) || THIRD_PARTY_LINE_START.test(line) || COURT_LINE.test(line)) return true;
    seen += 1;
  }
  return false;
}

/** The first line of the block that holds `lineIndex` (the block ends at an empty line). */
function blockStart(lines: readonly Line[], lineIndex: number): number {
  let i = lineIndex;
  while (i > 0 && (lines[i - 1] as Line).text.trim() !== '') i -= 1;
  return i;
}

/** Is the match at `position` inside a block that the text marks as someone else's? */
function inThirdPartyContext(text: string, lines: readonly Line[], position: number, firstLineOfMatch?: number): boolean {
  const index = firstLineOfMatch ?? lineIndexAt(lines, position);
  const current = lines[index] as Line;
  const prefix = text.slice(current.start, position);
  if (THIRD_PARTY_ANYWHERE.test(prefix) || THIRD_PARTY_LINE_START.test(prefix)) return true;
  // Up to three lines before, within the same block (a blank line ends the block) …
  let i = index - 1;
  let seen = 0;
  while (i >= 0 && seen < 3) {
    const line = (lines[i] as Line).text;
    if (line.trim() === '') break;
    if (THIRD_PARTY_ANYWHERE.test(line) || THIRD_PARTY_LINE_START.test(line)) return true;
    seen += 1;
    i -= 1;
  }
  // … and the short heading line right above the block, if the block starts within those lines.
  if (i >= 0 && (lines[i] as Line).text.trim() === '') {
    let j = i - 1;
    while (j >= 0 && (lines[j] as Line).text.trim() === '') j -= 1;
    const heading = j >= 0 ? (lines[j] as Line).text.trim() : '';
    if (heading !== '' && heading.length <= 60 && (THIRD_PARTY_ANYWHERE.test(heading) || THIRD_PARTY_LINE_START.test(heading))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Postal address

/** A town: capitalised words, with the usual small words and abbreviations in between ("Neumarkt i.d.OPf.", "Musterau a. Inn"). */
const TOWN_WORD = `\\p{Lu}[\\p{L}'’.\\-]*`;
const TOWN_PARTICLE = `(?:a\\.|am|an|auf|bei|b\\.|d\\.|der|dem|den|des|i\\.|im|in|ob|o\\.|v\\.|vor|zum|zur|unterm|überm|i\\.\\s?d\\.\\s?[\\p{L}]+\\.?|a\\.\\s?d\\.\\s?[\\p{L}]+\\.?)`;
const TOWN = `${TOWN_WORD}(?:${H}(?:${TOWN_PARTICLE}${H}?)*${TOWN_WORD}|${H}${TOWN_PARTICLE})*`;

/** Words that end a town: labels that follow on the same line in tables or flat text. */
const TOWN_STOP = new Set(
  [
    'deutschland', 'germany', 'de', 'brd', 'tel', 'tel.', 'telefon', 'telephone', 'phone', 'fon', 'fax', 'telefax', 'mobil', 'mobile', 'handy',
    'e-mail', 'email', 'e-mail:', 'mail', 'mail:', 'web', 'www', 'internet', 'homepage', 'website', 'ust', 'ust-idnr', 'ust-idnr.', 'ust.-idnr.',
    'umsatzsteuer', 'steuernummer', 'steuer-nr', 'registergericht', 'amtsgericht', 'handelsregister', 'registernummer', 'hrb', 'hra',
    'geschäftsführer', 'geschäftsführerin', 'geschäftsführung', 'inhaber', 'inhaberin', 'vertreten', 'vertretungsberechtigt', 'kontakt',
    'öffnungszeiten', 'sitz', 'tel:', 'fax:', 'telefon:',
  ],
);

function cleanTown(raw: string): string | null {
  const words = raw.split(new RegExp(`${H}+`, 'u'));
  const kept: string[] = [];
  for (const word of words) {
    const key = word.toLowerCase().replace(/[:,;]+$/, '');
    if (TOWN_STOP.has(key) || TOWN_STOP.has(`${key}:`)) break;
    kept.push(word);
    if (kept.length >= 6) break;
  }
  let town = kept.join(' ');
  // A trailing sentence dot goes, a dot that belongs to an abbreviation ("i.d.OPf.", "a.") stays.
  if (/\.$/.test(town)) {
    const last = kept[kept.length - 1] ?? '';
    const isAbbreviation = /\..+\.$/.test(last) || /^\p{Ll}{1,2}\.$/u.test(last) || /^\p{L}{1,3}\.$/u.test(last);
    if (!isAbbreviation) town = town.slice(0, -1);
  }
  town = town.replace(/[,;:]+$/, '');
  return /\p{L}{2,}/u.test(town) ? town : null;
}

const PLZ_TOWN = new RegExp(
  `(?<![\\p{L}\\p{N}/+.\\-])((?:D|DE)${H}?[-–]${H}?)?(\\d{5})(?!\\p{N})${H}+(${TOWN})`,
  'gu',
);

/** Street with house number, the whole segment: "Erlenweg 12 a", "Industriestr. 12-14", "Hofmark 7", "Straße des 17. Juni 5". */
const STREET = new RegExp(
  `^(\\p{Lu}[\\p{L}\\p{N}.'’\\-]*(?:${H}+[\\p{L}\\p{N}.'’\\-]+)*?)${H}*(\\d{1,3}(?:${H}?[a-zA-Z](?![\\p{L}]))?(?:${H}?[-–/+]${H}?\\d{1,3}(?:${H}?[a-zA-Z](?![\\p{L}]))?)?)$`,
  'u',
);
/** A label of one to three words with a colon in front of the street ("Anschrift:", "Hauptsitz:", "Straße:"). */
const ADDRESS_LABEL = new RegExp(`^\\p{L}[\\p{L}.\\-]*(?:${H}\\p{L}[\\p{L}.\\-]*){0,2}${H}*:${H}*`, 'u');
const NOT_A_STREET =
  /^(?:postfach|postf\.|pf\.?|p\.\s?o\.\s?box|po box|tel|telefon|fax|telefax|mobil|handy|phone|fon|hrb|hra|hr|nr|ust|umsatzsteuer|steuer|steuernummer|amtsgericht|registergericht|handelsregister|registernummer|kundennummer|stammkapital|grundkapital|gegründet|gründung|seit|copyright|version|stand|öffnungszeiten|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so|mitglied|ausgabe|baujahr)(?![\p{L}\p{N}])/iu;
const PHONE_BEFORE = /(?:tel|telefon|telephone|phone|fon|fax|telefax|mobil|mobile|handy|hotline|hrb|hra|nr|nummer|postfach|ust|steuer|kto|konto|blz|iban)\.?:?[\s ]*\(?[\d\s /()+-]*$/iu;

/** Splits a line part into segments at the separators people use between street and postcode. */
function lastSegment(part: string): { text: string; offset: number } | null {
  const trimmedEnd = part.replace(new RegExp(`(?:${H}|[,;|·•–\\-])*$`, 'u'), '');
  if (trimmedEnd.trim() === '') return null;
  const separator = new RegExp(`[,;|·•\\t]|${H}[–\\-]${H}(?!\\d)`, 'gu');
  let offset = 0;
  for (const match of trimmedEnd.matchAll(separator)) offset = (match.index ?? 0) + match[0].length;
  const segment = trimmedEnd.slice(offset);
  const lead = segment.length - segment.replace(new RegExp(`^${H}+`, 'u'), '').length;
  return { text: segment.slice(lead), offset: offset + lead };
}

/** A company name in front of the street on the same segment ("Muster GmbH Erlenweg 3"): the street starts after the legal form. */
const LEGAL_FORM = new RegExp(`(?:^|${H})(?:GmbH(?:${H}?&${H}?Co\\.?${H}?KG)?|mbH|AG|UG(?:${H}?\\(haftungsbeschränkt\\))?|KG|OHG|GbR|e\\.${H}?K\\.|e\\.${H}?Kfm\\.|e\\.${H}?V\\.|Ltd\\.?|SE|KGaA|PartG(?:${H}?mbB)?|eG)(?=${H})`, 'gu');

function streetOf(segment: string): { street: string; skip: number } | null {
  const label = ADDRESS_LABEL.exec(segment);
  let skip = label === null ? 0 : label[0].length;
  const lastForm = [...segment.slice(skip).matchAll(LEGAL_FORM)].at(-1);
  if (lastForm !== undefined) skip += (lastForm.index ?? 0) + lastForm[0].length;
  const rest = segment.slice(skip).replace(new RegExp(`^${H}+`, 'u'), (lead) => {
    skip += lead.length;
    return '';
  });
  if (NOT_A_STREET.test(rest)) return null;
  const match = STREET.exec(rest);
  if (match === null) return null;
  const name = match[1] ?? '';
  if ((name.match(/\p{L}/gu) ?? []).length < 3) return null;
  return { street: rest.trimEnd(), skip };
}

function findAddress(text: string): FieldResult<AddressValue> {
  const lines = linesOf(text);
  for (const match of text.matchAll(PLZ_TOWN)) {
    const at = match.index ?? 0;
    const postcode = match[2] ?? '';
    if (postcode.startsWith('00')) continue;
    const town = cleanTown(match[3] ?? '');
    if (town === null) continue;
    const lineIndex = lineIndexAt(lines, at);
    const line = lines[lineIndex] as Line;
    const before = text.slice(line.start, at);
    if (PHONE_BEFORE.test(before)) continue;
    // The street sits on the same line before the postcode, or alone at the end of the line above.
    let street: { street: string; start: number; lineIndex: number } | null = null;
    const sameLine = lastSegment(before);
    if (sameLine !== null) {
      const found = streetOf(sameLine.text);
      if (found !== null) street = { street: found.street, start: line.start + sameLine.offset + found.skip, lineIndex };
      else continue; // something else stands right before the postcode on this line
    } else {
      // The line above; site builders put empty paragraphs between the lines, so up to four lines of
      // only whitespace may stand in between.
      let index = lineIndex - 1;
      let skipped = 0;
      while (index >= 0 && skipped < 4 && (lines[index] as Line).text.trim() === '') {
        index -= 1;
        skipped += 1;
      }
      const above = index >= 0 ? (lines[index] as Line) : null;
      const segment = above === null ? null : lastSegment(above.text);
      if (above !== null && segment !== null) {
        const found = streetOf(segment.text);
        if (found !== null) street = { street: found.street, start: above.start + segment.offset + found.skip, lineIndex: index };
      }
    }
    if (street === null) continue;
    if (inThirdPartyContext(text, lines, street.start, street.lineIndex)) continue;
    if (thirdPartyAbove(lines, blockStart(lines, street.lineIndex))) continue;
    const townStart = at + match[0].length - (match[3] ?? '').length;
    const end = townStart + town.length;
    return { status: 'found', quote: text.slice(street.start, end), source: 'text', value: { street: street.street, postcode, town } };
  }
  return NOT_ON_PAGE;
}

// ---------------------------------------------------------------------------------------------
// E-mail

const FILE_ENDINGS = /^(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|js|css|pdf|mp4|webm|woff2?|ttf|otf|html?|php)$/i;
const LOCAL = `[A-Za-z0-9](?:[A-Za-z0-9._%+\\-]*[A-Za-z0-9_%+\\-])?`;
const LABEL = `[A-Za-z0-9\\p{L}](?:[A-Za-z0-9\\p{L}\\-]*[A-Za-z0-9\\p{L}])?`;
const TLD = `[A-Za-z]{2,24}`;
const PLAIN_EMAIL = new RegExp(`(?<![\\p{L}\\p{N}._%+\\-])(${LOCAL})@((?:${LABEL}\\.)+${TLD})(?![\\p{L}\\p{N}\\-]|\\.[\\p{L}\\p{N}])`, 'gu');

const AT_TOKEN = `(?:at|ät|@)`;
const AT_BRACKET = `${H}*(?:\\[${H}*${AT_TOKEN}${H}*\\]|\\(${H}*${AT_TOKEN}${H}*\\)|\\{${H}*${AT_TOKEN}${H}*\\}|<${H}*at${H}*>)${H}*`;
const AT_SPACED = `${H}+@${H}*|${H}*@${H}+`;
const AT_WORD = `${H}+(?:at|ät)${H}+`;
const DOT_TOKEN = `(?:dot|punkt|\\.)`;
const DOT_BRACKET = `${H}*(?:\\[${H}*${DOT_TOKEN}${H}*\\]|\\(${H}*${DOT_TOKEN}${H}*\\)|\\{${H}*${DOT_TOKEN}${H}*\\})${H}*`;
const DOT_WORD = `${H}+(?:dot|punkt)${H}+`;
const DOT = `(?:${DOT_BRACKET}|${DOT_WORD}|\\.)`;
const OBFUSCATED_EMAIL = new RegExp(
  `(?<![\\p{L}\\p{N}._%+\\-])(${LOCAL})(${AT_BRACKET}|${AT_SPACED}|${AT_WORD})((?:${LABEL}${DOT})+${TLD})(?![\\p{L}\\p{N}\\-])`,
  'giu',
);
const EMAIL_LABEL_BEFORE = /(?:e-?mail|email|mail)\b[^\n]*$/iu;

interface EmailCandidate {
  index: number;
  quote: string;
  value: string;
  form: EmailForm;
  source: 'text' | 'link';
}

function plainValid(address: string): boolean {
  const match = new RegExp(`^(${LOCAL})@((?:${LABEL}\\.)+(${TLD}))$`, 'u').exec(address);
  return match !== null && !FILE_ENDINGS.test(match[3] ?? '');
}

/** Cloudflare's e-mail protection: the first byte is the key, every following byte is a character XOR the key. */
export function decodeCloudflareEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

function textEmails(text: string): EmailCandidate[] {
  const found: EmailCandidate[] = [];
  for (const match of text.matchAll(PLAIN_EMAIL)) {
    const tld = (match[2] ?? '').split('.').at(-1) ?? '';
    if (FILE_ENDINGS.test(tld)) continue;
    found.push({ index: match.index ?? 0, quote: match[0], value: match[0].toLowerCase(), form: 'plain', source: 'text' });
  }
  for (const match of text.matchAll(OBFUSCATED_EMAIL)) {
    const at = match[2] ?? '';
    const domainRaw = match[3] ?? '';
    const index = match.index ?? 0;
    const usesWords = new RegExp(`^${AT_WORD}$`, 'iu').test(at) || new RegExp(DOT_WORD, 'iu').test(domainRaw);
    if (usesWords) {
      // " at " and " dot " are ordinary words: only with an e-mail label on the same line.
      const lineStart = text.lastIndexOf('\n', index) + 1;
      if (!EMAIL_LABEL_BEFORE.test(text.slice(lineStart, index))) continue;
    }
    const domain = domainRaw.replace(new RegExp(DOT_BRACKET, 'giu'), '.').replace(new RegExp(DOT_WORD, 'giu'), '.');
    const value = `${match[1] ?? ''}@${domain}`.toLowerCase();
    if (!plainValid(value)) continue;
    if (found.some((c) => c.index === index)) continue;
    found.push({ index, quote: match[0], value, form: 'obfuscated', source: 'text' });
  }
  return found.sort((a, b) => a.index - b.index);
}

function linkEmails(links: readonly PageLink[]): EmailCandidate[] {
  const found: EmailCandidate[] = [];
  links.forEach((link, index) => {
    const href = link.href;
    if (/^mailto:/i.test(href)) {
      let address = href.slice(7).split('?')[0] ?? '';
      try {
        address = decodeURIComponent(address);
      } catch {
        // keep as is
      }
      address = (address.split(/[,;]/)[0] ?? '').trim().toLowerCase();
      if (plainValid(address)) found.push({ index, quote: href, value: address, form: 'mailto', source: 'link' });
      return;
    }
    const cf = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)$/i.exec(href);
    if (cf !== null) {
      const address = decodeCloudflareEmail(cf[1] ?? '')?.toLowerCase() ?? null;
      if (address !== null && plainValid(address)) found.push({ index, quote: href, value: address, form: 'cloudflare', source: 'link' });
    }
  });
  return found;
}

function findEmail(text: string, links: readonly PageLink[]): FieldResult<EmailValue> {
  const lines = linesOf(text);
  const skipped = new Set<string>();
  for (const candidate of textEmails(text)) {
    if (inThirdPartyContext(text, lines, candidate.index)) {
      skipped.add(candidate.value);
      continue;
    }
    return { status: 'found', quote: candidate.quote, source: 'text', value: { value: candidate.value, form: candidate.form } };
  }
  for (const candidate of linkEmails(links)) {
    if (skipped.has(candidate.value)) continue;
    return { status: 'found', quote: candidate.quote, source: 'link', value: { value: candidate.value, form: candidate.form } };
  }
  return NOT_ON_PAGE;
}

// ---------------------------------------------------------------------------------------------
// Handelsregister

const REGISTER = new RegExp(
  `(?<![\\p{L}\\p{N}])HR${H}?([AB])(?![\\p{L}])(?:${H}*[-–]?${H}*(?:Nr\\.?|Nummer)?)?${H}*[:.]?${H}*(\\d{1,7})(?!\\p{N})`,
  'gu',
);
const COURT_TOWN = `(${TOWN})`;
const COURT = new RegExp(
  `(?:Amtsgerichts?|Registergericht|Handelsregistergericht|Registergericht${H}*:?${H}*(?:Amtsgericht|AG)|Local${H}+court|District${H}+court(?:${H}+of)?|Regist(?:ry|er)${H}+court|Court${H}+of${H}+registration)${H}*[:,]?${H}*(?:(?:Amtsgericht|AG)${H}+)?${COURT_TOWN}`,
  'gu',
);
const AG_BEFORE = new RegExp(`(?<![\\p{L}])AG${H}+${COURT_TOWN}${H}*[,;]?${H}*$`, 'u');
const AG_AFTER = new RegExp(`^${H}*[,;(]?${H}*(?:beim${H}+)?AG${H}+${COURT_TOWN}`, 'u');
const COURT_STOP = new Set(['hrb', 'hra', 'hr', 'handelsregister', 'registernummer', 'unter', 'nr', 'nr.', 'nummer']);

function cleanCourt(raw: string): string | null {
  const words = raw.split(new RegExp(`${H}+`, 'u'));
  const kept: string[] = [];
  for (const word of words) {
    if (COURT_STOP.has(word.toLowerCase().replace(/[:,;]+$/, ''))) break;
    kept.push(word);
  }
  return cleanTown(kept.join(' '));
}

/** The block around a position: up to `reach` characters, not across a blank line. */
function blockAround(text: string, start: number, end: number, reach: number): { from: number; to: number } {
  let from = Math.max(0, start - reach);
  let to = Math.min(text.length, end + reach);
  const before = text.slice(from, start);
  const blankBefore = before.search(/\n[ \t ]*\n(?![\s\S]*\n[ \t ]*\n)/);
  if (blankBefore !== -1) from += blankBefore + 1;
  const after = text.slice(end, to);
  const blankAfter = after.search(/\n[ \t ]*\n/);
  if (blankAfter !== -1) to = end + blankAfter;
  return { from, to };
}

function findRegister(text: string): FieldResult<RegisterValue> {
  const lines = linesOf(text);
  for (const match of text.matchAll(REGISTER)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    if (inThirdPartyContext(text, lines, at)) continue;
    const register = match[1] === 'A' ? 'HRA' : 'HRB';
    const number = match[2] ?? '';
    // The court: "AG Town" right next to the number, else the nearest court phrase in the block.
    let court: { town: string; start: number; end: number } | null = null;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
    const before = AG_BEFORE.exec(text.slice(lineStart, at));
    const after = AG_AFTER.exec(text.slice(end, lineEnd));
    if (before !== null) {
      const town = cleanCourt(before[1] ?? '');
      if (town !== null) court = { town, start: lineStart + (before.index ?? 0), end: at };
    } else if (after !== null) {
      const town = cleanCourt(after[1] ?? '');
      if (town !== null) {
        const townAt = end + after[0].length - (after[1] ?? '').length;
        court = { town, start: end, end: townAt + town.length };
      }
    }
    if (court === null) {
      const block = blockAround(text, at, end, 160);
      let best: { town: string; start: number; end: number; distance: number } | null = null;
      for (const phrase of text.slice(block.from, block.to).matchAll(COURT)) {
        const start = block.from + (phrase.index ?? 0);
        const lead = text.slice(Math.max(0, start - 25), start);
        if (/gerichtsstand|jurisdiction|place of/i.test(lead)) continue;
        const town = cleanCourt(phrase[1] ?? '');
        if (town === null) continue;
        const townAt = start + phrase[0].length - (phrase[1] ?? '').length;
        const phraseEnd = townAt + town.length;
        const distance = start > at ? start - end : at - phraseEnd;
        if (best === null || distance < best.distance) best = { town, start, end: phraseEnd, distance };
      }
      if (best !== null) court = best;
    }
    if (court === null) {
      // A court named as the register court ("Registergericht: …") may stand in the block next to it.
      const from = Math.max(0, at - 200);
      const to = Math.min(text.length, end + 200);
      let best: { town: string; start: number; end: number; distance: number } | null = null;
      for (const phrase of text.slice(from, to).matchAll(COURT)) {
        if (!/^(?:Registergericht|Handelsregistergericht|Regist(?:ry|er)|Court)/u.test(phrase[0])) continue;
        const start = from + (phrase.index ?? 0);
        const town = cleanCourt(phrase[1] ?? '');
        if (town === null) continue;
        const townAt = start + phrase[0].length - (phrase[1] ?? '').length;
        const phraseEnd = townAt + town.length;
        const distance = start > at ? start - end : at - phraseEnd;
        if (best === null || distance < best.distance) best = { town, start, end: phraseEnd, distance };
      }
      if (best !== null) court = best;
    }
    const from = court === null ? at : Math.min(at, court.start);
    const to = court === null ? end : Math.max(end, court.end);
    return { status: 'found', quote: text.slice(from, to), source: 'text', value: { register, number, court: court?.town ?? null } };
  }
  return NOT_ON_PAGE;
}

// ---------------------------------------------------------------------------------------------
// USt-IdNr

const VAT_ID = new RegExp(`(?<![\\p{L}\\p{N}])DE${H}?-?${H}?(\\d(?:[ \\u00a0.]?\\d){8})(?![ \\u00a0.]?\\d)(?![\\p{L}])`, 'gu');

function findVatId(text: string): FieldResult<string> {
  const lines = linesOf(text);
  for (const match of text.matchAll(VAT_ID)) {
    const at = match.index ?? 0;
    const lead = text.slice(Math.max(0, at - 40), at);
    if (/iban|bic|swift|konto|bankverbindung|blz/i.test(lead)) continue;
    if (inThirdPartyContext(text, lines, at)) continue;
    const digits = (match[1] ?? '').replace(/\D/g, '');
    return { status: 'found', quote: match[0], source: 'text', value: `DE${digits}` };
  }
  return NOT_ON_PAGE;
}
