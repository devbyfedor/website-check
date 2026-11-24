import { parse as parseDomain } from 'tldts';
import type { PageLink } from '../capture/types.ts';
import { siteOfHost } from '../domain/site.ts';
import { normalizeLinkText, stripInvisible } from './links.ts';

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
 *
 * Session fix-a3 (review findings 5 and 16, and 71 to 74): the list of labels can never be complete, so a
 * value also needs a tie to the operator. The first address on the page that carries no such label is
 * taken for the operator's. A field counts only up to the next address of someone else (a second firm with
 * its own register entry, VAT id and e-mail usually follows its address); an address counts only when it
 * is that first address; an e-mail after that point counts only on the site's own domain. When the
 * operator's own value is on the page in a form the templates do not read, the result is "nicht
 * gefunden, bitte manuell prüfen", not the value of the next block. Invisible characters (soft hyphen,
 * zero-width characters) are removed first, so a quote is a part of the text without them.
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

/** `ownSites`: registrable domains of the site; a mailto link whose text is not on the page counts only for them. */
export function extractImpressumFields(rawText: string, rawLinks: readonly PageLink[] = [], ownSites: ReadonlySet<string> = new Set()): ImpressumFields {
  // Generators write "Aufsichts&shy;behörde": without the invisible characters a label is a word again.
  const text = stripInvisible(rawText);
  const links = rawLinks.map((link) => ({ ...link, text: stripInvisible(link.text) }));
  const doc: Doc = { text, lines: linesOf(text), nav: new Set(links.map((link) => normalizeLinkText(link.text)).filter((t) => t !== '')) };
  const addresses = addressCandidates(doc);
  const first = addresses.find((c) => c.foreign === null);
  const regionEnd = operatorRegionEnd(doc, addresses, first);
  return {
    address: findAddress(doc, addresses, first, regionEnd),
    email: findEmail(doc, links, ownSites, regionEnd),
    handelsregister: findRegister(doc, regionEnd),
    ustId: findVatId(doc, regionEnd),
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

/** The page text without invisible characters, its lines, and the texts of the page's links (menu items). */
interface Doc {
  text: string;
  lines: Line[];
  nav: ReadonlySet<string>;
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
  /schlichtungsstelle|verbraucherschlichtung|streitbeilegung|streitschlichtung|universalschlichtung|aufsichtsbeh(?:ö|oe)rde|zust(?:ä|ae)ndige (?:kammer|beh(?:ö|oe)rde)|datenschutzbeauftragte|data protection officer|berufshaftpflicht|betriebshaftpflicht|haftpflichtversicher|versicherer|gewerbeaufsicht|(?:ü|ue)berwachungsbeh(?:ö|oe)rde|genehmigungsbeh(?:ö|oe)rde|landesbeauftragte|hosting-?provider|hosting-?partner|web-?hoster|hoster ist|wir hosten|zahlungsabwicklung|zahlungsdienstleister|r(?:ü|ue)cksendung|bildmaterial|(?:website|webseite|homepage|internetseite) wurde|unsere?[rn]? (?:web-?)?(?:hoster|hosting-?anbieter|provider)|online-?beilegung|os-plattform|fotos (?:stammen )?von|arbitration board|dispute resolution|supervisory authority|webdesign (?:by|von|durch)|website (?:by|von|erstellt|realisiert)|realisiert (?:von|durch)|erstellt (?:von|durch)|umgesetzt (?:von|durch)|gestaltet (?:von|durch)|design(?:ed)? by|made by|powered by|hosted by|gehostet (?:von|bei)|(?:zahn|tier)?(?:ä|ae)rztekammer|psychotherapeutenkammer|apothekerkammer|steuerberaterkammer|rechtsanwaltskammer|notarkammer|architektenkammer|ingenieurkammer|handwerkskammer|wirtschaftspr(?:ü|ue)ferkammer|landwirtschaftskammer|industrie- und handelskammer|handelskammer|kammerzugeh(?:ö|oe)rigkeit|berufsst(?:ä|ae)ndische kammer|kassen(?:zahn)?(?:ä|ae)rztliche vereinigung|zust(?:ä|ae)ndige aufsicht|(?:^|[^\p{L}])(?:ihk|hwk)(?![\p{L}])/iu;
/** For the register field: the general partner of a GmbH & Co. KG is another company with its own register entry. */
const GENERAL_PARTNER = /pers(?:ö|oe)nlich haftende|komplement(?:ä|ae)r(?:in)?|general partner/iu;
/** How far back a label is read on one line; a longer line is cut, so a page with one huge line stays fast. */
const LINE_WINDOW = 300;
const THIRD_PARTY_LINE_START =
  /^[\s ]*(?:web-?design|web design|design|gestaltung|grafik|layout|konzept(?:ion)?|umsetzung|technische umsetzung|realisierung|programmierung|entwicklung|technik|webentwicklung|hosting|webhosting|hoster|provider|serverstandort|bildnachweise?|bildquellen?|bildrechte|bilder|fotos?|fotografie|fotonachweise?|fotograf(?:in)?|quellen?(?:angaben)?|credits|copyright (?:der )?(?:bilder|fotos)|agentur|internetagentur|werbeagentur|webagentur|onlineagentur|seo|betreuung|kammer|berufskammer|handwerkskammer|ihk|aufsicht|versicherung|haftpflicht|schlichtung|datenschutzbeauftragte[rn]?|external dpo|wo|wann|veranstaltungsort|kursort|kursraum|treffpunkt|location|venue)(?:[\s ]*(?::|&|\+|\/|,|–|-[\s ]|\(|und\b|by\b|von\b|durch\b|bei\b)|[\s ]*$)/iu;

/**
 * Headings that mark someone else's block only as a whole line ("Datenschutz" above the external data
 * protection officer, "Unsere Partner"). The same words are menu items on most pages, so a line that is
 * also the text of a link of the page does not count.
 */
const THIRD_PARTY_HEADING = /^[\s\u00a0]*(?:datenschutz|unsere partner|partner|kooperationspartner|partnerunternehmen)[\s\u00a0]*:?[\s\u00a0]*$/iu;

/**
 * Labels of bodies that have no register entry, VAT id or e-mail of their own on an Impressum page: a
 * court, a chamber, an authority, the arbitration board, the insurer, the venue of a course. Their address
 * is skipped, but the operator's data may follow below it.
 */
const AUTHORITY_LABEL =
  /schlichtung|streitbeilegung|streitschlichtung|dispute|arbitration|aufsicht|beh(?:ö|oe)rde|authority|kammer|(?:^|[^\p{L}])(?:ihk|hwk)(?![\p{L}])|versicher|haftpflicht|vereinigung|amtsgericht|registergericht|handelsregister|court|landesbeauftragte|landratsamt|^[\s\u00a0]*(?:wo|wann|veranstaltungsort|kursort|kursraum|treffpunkt|location|venue)(?![\p{L}])/iu;

/** A line that starts with the word for another place of the operator's own ("Filiale Nord", "Hausanschrift:"). */
const OWN_LOCATION =
  /^[\s\u00a0]*(?:(?:unsere?|zweite[rs]?|weitere[rs]?)[\s\u00a0]+)?(?:filialen?|niederlassung(?:en)?|zweigstellen?|zweigniederlassung|zweigpraxis|zweigkanzlei|standorte?|b(?:ü|ue)ro|werk|hauptsitz|firmensitz|stammsitz|sitz|betriebsst(?:ä|ae)tte|ladengesch(?:ä|ae)ft|laden|showroom|ausstellung|werkstatt|postanschrift|hausanschrift|besucheradresse|besuchsadresse|besucheranschrift|lieferanschrift|lieferadresse|verwaltung|zentrale|gesch(?:ä|ae)ftsstelle|praxis|kanzlei|studio|atelier)(?![\p{L}])/iu;

/** A line that names a court or a register: an address right below it is the court's, not the operator's. */
const COURT_LINE = /^[\s ]*(?:amtsgerichts?|registergericht|handelsregister(?:gericht)?|local court|district court|regist(?:ry|er) court)(?![\p{L}])/iu;
/** Lines that start the operator's own data: the search for a third-party label stops there. */
const OPERATOR_LINE = /angaben gem(?:ä|ae)(?:ß|ss)|^[\s ]*(?:impressum|kontakt|inhaber(?:in)?|betreiber(?:in)?|anbieter(?:in)?|herausgeber(?:in)?|diensteanbieter|verantwortlich|vertreten durch|gesch(?:ä|ae)ftsf(?:ü|ue)hr|website operator|operator|provider|owner)(?![\p{L}])/iu;

/** Does a line (or the part of a line before a match) carry a label of someone else's data? */
function foreignLabel(doc: Doc, part: string, fromLineStart: boolean, extra?: RegExp): boolean {
  if (THIRD_PARTY_ANYWHERE.test(part) || (extra !== undefined && extra.test(part))) return true;
  if (!fromLineStart) return false;
  if (THIRD_PARTY_LINE_START.test(part)) return true;
  return THIRD_PARTY_HEADING.test(part) && !doc.nav.has(normalizeLinkText(part).replace(/[\s:]+$/u, ''));
}

/**
 * For addresses (site builders put every line in its own paragraph, so a label can sit two blocks
 * above): up to two non-empty lines above the block, across empty lines, that name a third party or a
 * court. Stops at a line that starts the operator's data. Returns the label line, or null.
 */
function thirdPartyAbove(doc: Doc, firstLine: number): string | null {
  const { lines } = doc;
  let seen = 0;
  for (let i = firstLine - 1; i >= 0 && seen < 2; i -= 1) {
    const line = (lines[i] as Line).text.slice(0, LINE_WINDOW);
    if (line.trim() === '') continue;
    if (OPERATOR_LINE.test(line)) return null;
    if (THIRD_PARTY_ANYWHERE.test(line) || THIRD_PARTY_LINE_START.test(line) || COURT_LINE.test(line)) return line;
    seen += 1;
  }
  return null;
}

/** The first line of the block that holds `lineIndex` (the block ends at an empty line). */
function blockStart(lines: readonly Line[], lineIndex: number): number {
  let i = lineIndex;
  while (i > 0 && (lines[i - 1] as Line).text.trim() !== '') i -= 1;
  return i;
}

/**
 * The lines that can carry a label for a match at `position`: the part of its own line before it, up to
 * three lines before it within the same block (a blank line ends the block), and the short heading line
 * right above the block, if the block starts within those lines.
 */
function labelParts(doc: Doc, position: number, firstLineOfMatch?: number): { part: string; fromLineStart: boolean }[] {
  const { text, lines } = doc;
  const index = firstLineOfMatch ?? lineIndexAt(lines, position);
  const current = lines[index] as Line;
  const parts = [{ part: text.slice(Math.max(current.start, position - LINE_WINDOW), position), fromLineStart: position - current.start <= LINE_WINDOW }];
  let i = index - 1;
  let seen = 0;
  while (i >= 0 && seen < 3) {
    const line = (lines[i] as Line).text.slice(0, LINE_WINDOW);
    if (line.trim() === '') break;
    parts.push({ part: line, fromLineStart: true });
    seen += 1;
    i -= 1;
  }
  if (i >= 0 && (lines[i] as Line).text.trim() === '') {
    let j = i - 1;
    while (j >= 0 && (lines[j] as Line).text.trim() === '') j -= 1;
    const heading = j >= 0 ? (lines[j] as Line).text.trim() : '';
    if (heading !== '' && heading.length <= 60) parts.push({ part: heading, fromLineStart: true });
  }
  return parts;
}

/** The label that marks the block of the match at `position` as someone else's, or null. */
function thirdPartyLabel(doc: Doc, position: number, firstLineOfMatch?: number, extra?: RegExp): string | null {
  for (const { part, fromLineStart } of labelParts(doc, position, firstLineOfMatch)) {
    if (foreignLabel(doc, part, fromLineStart, extra)) return part;
  }
  return null;
}

/** Is the match at `position` inside a block that the text marks as someone else's? */
function inThirdPartyContext(doc: Doc, position: number, firstLineOfMatch?: number, extra?: RegExp): boolean {
  return thirdPartyLabel(doc, position, firstLineOfMatch, extra) !== null;
}

// ---------------------------------------------------------------------------------------------
// Postal address

/**
 * A town: the rest of the segment after the postcode, read word by word in `readTown` (capitalised
 * words, with the usual small words and abbreviations in between: "Neumarkt i.d.OPf.", "Musterau a. Inn").
 * The pattern itself has no nested repetition, so a strange text cannot make it run for minutes (found
 * by the code review: the earlier pattern backtracked exponentially on repeated "i. d.").
 */
const TOWN = `\\p{Lu}[^\\n,;|·•\\t()]{0,80}`;
const TOWN_WORD_RE = /^\p{Lu}[\p{L}'’.\-]*$/u;
const TOWN_PARTICLE_RE = /^(?:a\.|am|an|auf|bei|b\.|d\.|der|dem|den|des|i\.|im|in|ob|o\.|v\.|vor|zum|zur|unterm|überm|(?:i|a)\.d\.\p{L}+\.?)$/u;
const PLAIN_PARTICLE_RE = /^(?:am|an|auf|bei|der|dem|den|des|im|in|ob|vor|zum|zur|unterm|überm)$/u;
/** First words of two-word town names. */
const TOWN_PREFIX = new Set([
  'Bad', 'Sankt', 'St.', 'Groß', 'Gross', 'Klein', 'Neu', 'Alt', 'Hohen', 'Markt', 'Schwäbisch', 'Bergisch', 'Lutherstadt', 'Hansestadt',
  'Ostseebad', 'Nordseebad', 'Seebad', 'Kurort', 'Ober', 'Unter', 'Nieder', 'Mittel', 'Hoch', 'Burg', 'Kloster', 'Hof', 'Schloss', 'Stadt', 'Freie',
]);

/** Words that end a town: labels that follow on the same line in tables or flat text. */
const TOWN_STOP = new Set(
  [
    'deutschland', 'germany', 'de', 'brd', 'tel', 'tel.', 'telefon', 'telephone', 'phone', 'fon', 'fax', 'telefax', 'mobil', 'mobile', 'handy',
    'e-mail', 'email', 'e-mail:', 'mail', 'mail:', 'web', 'www', 'internet', 'homepage', 'website', 'ust', 'ust-idnr', 'ust-idnr.', 'ust.-idnr.',
    'umsatzsteuer', 'steuernummer', 'steuer-nr', 'registergericht', 'amtsgericht', 'handelsregister', 'registernummer', 'hrb', 'hra',
    'geschäftsführer', 'geschäftsführerin', 'geschäftsführung', 'inhaber', 'inhaberin', 'vertreten', 'vertretungsberechtigt', 'kontakt',
    'öffnungszeiten', 'sitz', 'tel:', 'fax:', 'telefon:',
    // Session fix-a3 (review finding 72): labels and weekdays that follow a town in flat text.
    'rechtsform', 'gesellschaftsform', 'eingetragen', 'gesellschafter', 'vorstand', 'aufsichtsrat', 'vertretungsberechtigter', 'vertretungsberechtigte',
    'ansprechpartner', 'verantwortlich', 'ust-id', 'steuer-nr', 'steuer-nr.', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  ],
);

/** Words after five digits that are a quantity, not a town ("10000 Quadratmeter", "25000 Besucher", "12500 Euro"). */
const NOT_A_TOWN = new Set([
  'euro', 'eur', 'stück', 'stk', 'stk.', 'besucher', 'besucherinnen', 'gäste', 'mitarbeiter', 'mitarbeiterinnen', 'mitarbeitende', 'beschäftigte', 'quadratmeter', 'qm',
  'artikel', 'produkte', 'kunden', 'kundinnen', 'durchwahl', 'einwohner', 'jahre', 'kilometer', 'km', 'meter', 'liter', 'tonnen', 'teilnehmer', 'mitglieder',
  'follower', 'abonnenten', 'bewertungen', 'exemplare', 'stunden', 'bücher', 'titel', 'projekte', 'aufträge', 'pakete', 'sendungen',
]);

/**
 * Reads a town from the start of `raw`, word by word: the first word capitalised, then capitalised
 * words or small words, at most six, until a label, a country or anything else. Returns the town and
 * how many characters of `raw` it covers (for the exact quote), or null.
 */
function readTown(raw: string): { town: string; length: number } | null {
  const kept: { word: string; end: number; particle: boolean }[] = [];
  let sentence = false;
  for (const token of raw.matchAll(/[^ \t\u00a0\u2009\u202f]+/gu)) {
    const word = token[0];
    const key = word.toLowerCase().replace(/[:,;]+$/, '');
    if (TOWN_STOP.has(key) || TOWN_STOP.has(`${key}:`)) break;
    // A label ("Tel:", "T.", "F.") ends the town.
    if (word.endsWith(':') || /^\p{Lu}\.$/u.test(word)) break;
    const particle = TOWN_PARTICLE_RE.test(word);
    if (kept.length === 0 ? !TOWN_WORD_RE.test(word) : !(TOWN_WORD_RE.test(word) || particle)) {
      // A lower-case word that is no part of a town name: the sentence goes on ("… in der Nähe von …").
      sentence = kept.length > 0 && /^\p{Ll}/u.test(word);
      break;
    }
    // A second capitalised word right after the first only after a prefix such as "Bad" or "Sankt"
    // ("Bad T\u00f6lz", "Sankt Englmar"); otherwise it is the next word of the sentence ("Musterhausen Eingetragen").
    const previous = kept[kept.length - 1];
    if (previous !== undefined && !particle && !previous.particle && !(kept.length === 1 && TOWN_PREFIX.has(previous.word))) break;
    kept.push({ word, end: (token.index ?? 0) + word.length, particle });
    if (kept.length >= 6) break;
  }
  // In a running sentence the words after the first small word are the sentence, not the town
  // ("Musterhausen in der Nähe von …"); at the end of a line they are the name ("Neustadt an der Aisch").
  if (sentence) {
    const firstParticle = kept.findIndex((k) => k.particle);
    if (firstParticle > 0) kept.length = firstParticle;
  }
  while (kept.length > 1 && PLAIN_PARTICLE_RE.test(kept[kept.length - 1]?.word ?? '')) kept.pop();
  const last = kept[kept.length - 1];
  if (last === undefined) return null;
  let town = kept.map((k) => k.word).join(' ');
  let length = last.end;
  // A trailing sentence dot goes, a dot that belongs to an abbreviation ("i.d.OPf.", "a.", "Br.") stays.
  if (town.endsWith('.')) {
    const isAbbreviation = /\..+\.$/.test(last.word) || /^\p{Ll}{1,2}\.$/u.test(last.word) || /^\p{L}{1,3}\.$/u.test(last.word);
    if (!isAbbreviation) {
      town = town.slice(0, -1);
      length -= 1;
    }
  }
  return /\p{L}{2,}/u.test(town) ? { town, length } : null;
}

const PLZ_TOWN = new RegExp(
  `(?<![\\p{L}\\p{N}/+.\\-])((?:D|DE)${H}?[-–]${H}?)?(\\d{5})(?!\\p{N})${H}+(${TOWN})`,
  'gu',
);

/** Street with house number, the whole segment: "Erlenweg 12 a", "Industriestr. 12-14", "Hofmark 7", "Straße des 17. Juni 5". */
const STREET = new RegExp(
  `^(\\p{Lu}[\\p{L}\\p{N}.'’\\-]*(?:${H}+[\\p{L}\\p{N}.'’\\-]+)*?)${H}*(?<!\\p{N})(\\d{1,3}(?:${H}?[a-zA-Z](?![\\p{L}]))?(?:${H}?[-–/+]${H}?\\d{1,3}(?:${H}?[a-zA-Z](?![\\p{L}]))?)?)$`,
  'u',
);
/** A label of one to three words with a colon in front of the street ("Anschrift:", "Hauptsitz:", "Straße:"). */
const ADDRESS_LABEL = new RegExp(`^\\p{L}[\\p{L}.\\-]*(?:${H}\\p{L}[\\p{L}.\\-]*){0,2}${H}*:${H}*`, 'u');
const NOT_A_STREET =
  /^(?:postfach|postf\.|pf\.?|p\.\s?o\.\s?box|po box|tel|telefon|fax|telefax|mobil|handy|phone|fon|hrb|hra|hr|nr|ust|umsatzsteuer|steuer|steuernummer|amtsgericht|registergericht|handelsregister|registernummer|kundennummer|stammkapital|grundkapital|gegründet|gründung|seit|copyright|version|stand|öffnungszeiten|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so|mitglied|ausgabe|baujahr|artikel|art\.?-?nr|preis|bestseller|gebäude|halle|chronik|raum|etage)(?![\p{L}\p{N}])/iu;
const PHONE_BEFORE = /(?:tel|telefon|telephone|phone|fon|fax|telefax|mobil|mobile|handy|hotline|hrb|hra|nr|nummer|postfach|ust|steuer|kto|konto|blz|iban)\.?:?[\s ]*\(?[\d\s /()+-]*$/iu;

/** Splits a line part into segments at the separators people use between street and postcode. */
function lastSegment(part: string): { text: string; offset: number } | null {
  // Trimmed with a loop, not with an unanchored pattern, so a long line stays linear.
  let cut = part.length;
  while (cut > 0 && /[ \t   ,;|·•–-]/u.test(part[cut - 1] ?? '')) cut -= 1;
  const trimmedEnd = part.slice(0, cut);
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
  // A year or a date, not a street ("Meisterbetrieb seit 1985", "Jahrgang 2024").
  if (/(?:^|[^\p{L}])(?:seit|since|gegr(?:ü|ue)ndet|gegr\.|jahrgang|baujahr|est\.)(?![\p{L}])/iu.test(name)) return null;
  return { street: rest.trimEnd(), skip };
}

interface AddressCandidate {
  /** Position of the postcode and end of the town. */
  at: number;
  end: number;
  lineIndex: number;
  postcode: string;
  town: string;
  /** Null when no street was read: the address stands in a form the template does not take. */
  street: { street: string; start: number; lineIndex: number } | null;
  /** The label line that marks the address as someone else's, or null. */
  foreign: string | null;
}

/** At most this many postcodes are read: a page with more is no Impressum, and the work stays bounded. */
const MAX_ADDRESSES = 300;

/**
 * Every postcode with a town on the page, in reading order, with the street when the template reads it.
 * A postcode without a readable street still counts as an address (session fix-a3): it shows that an
 * address stands there, so a later address is not the first one on the page.
 */
function addressCandidates(doc: Doc): AddressCandidate[] {
  const { text, lines } = doc;
  const out: AddressCandidate[] = [];
  for (const match of text.matchAll(PLZ_TOWN)) {
    const at = match.index ?? 0;
    const postcode = match[2] ?? '';
    if (postcode.startsWith('00')) continue;
    const read = readTown(match[3] ?? '');
    if (read === null) continue;
    if (NOT_A_TOWN.has((read.town.split(' ')[0] ?? '').toLowerCase())) continue;
    const lineIndex = lineIndexAt(lines, at);
    const line = lines[lineIndex] as Line;
    // Only a bounded window before the postcode is read, so a page with one huge line stays fast.
    const windowStart = Math.max(line.start, at - LINE_WINDOW);
    const before = text.slice(windowStart, at);
    if (PHONE_BEFORE.test(before)) continue;
    // The street sits on the same line before the postcode, or alone at the end of the line above.
    let street: AddressCandidate['street'] = null;
    const sameLine = lastSegment(before);
    if (sameLine !== null) {
      const found = streetOf(sameLine.text);
      if (found !== null) street = { street: found.street, start: windowStart + sameLine.offset + found.skip, lineIndex };
      // Something else stands right before the postcode on this line. A label ("PLZ / Ort") or a street in
      // a form the template does not read still makes it an address; other digits (a phone number, an
      // amount) do not.
      else if (!/^\D*(?:\d{1,3}[\s\u00a0]?[a-zA-Z]?(?![\p{L}\p{N}])\D*)?$/u.test(sameLine.text)) continue;
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
    const streetLine = street?.lineIndex ?? lineIndex;
    const foreign = thirdPartyLabel(doc, street?.start ?? at, streetLine) ?? thirdPartyAbove(doc, blockStart(lines, streetLine));
    const townStart = at + match[0].length - (match[3] ?? '').length;
    out.push({ at, end: townStart + read.length, lineIndex, postcode, town: read.town, street, foreign });
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
}

/** The same place: the same postcode or the same town (a post box and the street address of one firm). */
function samePlace(a: AddressCandidate, b: AddressCandidate): boolean {
  return a.postcode === b.postcode || a.town.toLowerCase() === b.town.toLowerCase();
}

/** Does a label say that the address is another place of the operator ("Filiale", "Hausanschrift")? */
function ownLocation(doc: Doc, candidate: AddressCandidate): boolean {
  return labelParts(doc, candidate.street?.start ?? candidate.at, candidate.street?.lineIndex ?? candidate.lineIndex).some(({ part, fromLineStart }) => fromLineStart && OWN_LOCATION.test(part));
}

/** The address of the register court, written below or behind the court's name. */
function belowCourt(doc: Doc, candidate: AddressCandidate): boolean {
  return labelParts(doc, candidate.street?.start ?? candidate.at, candidate.street?.lineIndex ?? candidate.lineIndex).some(({ part, fromLineStart }) => fromLineStart && COURT_LINE.test(part));
}

/**
 * Where the operator's part of the page ends (session fix-a3, review finding 5): at the first address
 * after the operator's that belongs to someone else. That is an address in another place without a label
 * of the operator's own, or an address under a credit label (web agency, hoster, photographer). The
 * address of a court, a chamber, an authority or an insurer does not end it: such a block has no register
 * entry or VAT id that could be taken for the operator's, and the operator's data often follows below.
 */
function operatorRegionEnd(doc: Doc, candidates: readonly AddressCandidate[], first: AddressCandidate | undefined): number {
  const { text, lines } = doc;
  for (const c of candidates) {
    if (first !== undefined && c.at <= first.at) continue;
    if (c.foreign !== null) {
      if (AUTHORITY_LABEL.test(c.foreign)) continue;
    } else if (first === undefined || samePlace(c, first) || ownLocation(doc, c) || belowCourt(doc, c)) continue;
    const start = c.street?.start ?? c.at;
    let index = c.street?.lineIndex ?? c.lineIndex;
    // An address inside a line: the part of the line before it may still be the operator's.
    if (text.slice((lines[index] as Line).start, start).trim() !== '') return start;
    // The name line right above the street belongs to the block.
    const above = index > 0 ? (lines[index - 1] as Line).text : '';
    if (above.trim() !== '' && !/[\d@]/.test(above) && (first === undefined || index - 1 > first.lineIndex)) index -= 1;
    return (lines[index] as Line).start;
  }
  return Number.POSITIVE_INFINITY;
}

function findAddress(doc: Doc, candidates: readonly AddressCandidate[], first: AddressCandidate | undefined, regionEnd: number): FieldResult<AddressValue> {
  if (first === undefined) return NOT_ON_PAGE;
  // The operator's address is the first address on the page. When the template does not read its street,
  // a later address counts only in the same place (the footer repeats it in another form) or as another
  // place of the operator's own; an address in another place is the address of the next block (a hoster,
  // an agency, an authority without a known label).
  const found = candidates.find((c) => c.foreign === null && c.street !== null && (c === first || samePlace(c, first) || (c.at < regionEnd && ownLocation(doc, c))));
  if (found === undefined || found.street === null) return NOT_ON_PAGE;
  return { status: 'found', quote: doc.text.slice(found.street.start, found.end), source: 'text', value: { street: found.street.street, postcode: found.postcode, town: found.town } };
}

// ---------------------------------------------------------------------------------------------
// E-mail

const FILE_ENDINGS = /^(?:png|jpe?g|gif|svg|webp|avif|ico|bmp|js|css|pdf|mp4|webm|woff2?|ttf|otf|html?|php)$/i;
/** Top-level domains reserved for examples and tests (RFC 2606, RFC 6761); the synthetic fixtures use them. */
const RESERVED_TLDS = new Set(['example', 'test']);
const LOCAL = `[A-Za-z0-9](?:[A-Za-z0-9._%+\\-]*[A-Za-z0-9_%+\\-])?`;
const LABEL = `[A-Za-z0-9\\p{L}](?:[A-Za-z0-9\\p{L}\\-]*[A-Za-z0-9\\p{L}])?`;
const TLD = `[A-Za-z]{2,24}`;
// Not after "@": "@verein@social.example" is a fediverse handle, not an e-mail address.
const PLAIN_EMAIL = new RegExp(`(?<![\\p{L}\\p{N}._%+\\-@])(${LOCAL})@((?:${LABEL}\\.)+${TLD})(?![\\p{L}\\p{N}\\-@]|\\.[\\p{L}\\p{N}])`, 'gu');

const AT_TOKEN = `(?:at|ät|@)`;
const AT_BRACKET = `${H}*(?:\\[${H}*${AT_TOKEN}${H}*\\]|\\(${H}*${AT_TOKEN}${H}*\\)|\\{${H}*${AT_TOKEN}${H}*\\}|<${H}*at${H}*>)${H}*`;
const AT_SPACED = `${H}+@${H}*|${H}*@${H}+`;
const AT_WORD = `${H}+(?:at|ät)${H}+`;
const DOT_TOKEN = `(?:dot|punkt|\\.)`;
const DOT_BRACKET = `${H}*(?:\\[${H}*${DOT_TOKEN}${H}*\\]|\\(${H}*${DOT_TOKEN}${H}*\\)|\\{${H}*${DOT_TOKEN}${H}*\\})${H}*`;
const DOT_WORD = `${H}+(?:dot|punkt)${H}+`;
const DOT = `(?:${DOT_BRACKET}|${DOT_WORD}|\\.)`;
const OBFUSCATED_EMAIL = new RegExp(
  `(?<![\\p{L}\\p{N}._%+\\-@])(${LOCAL})(${AT_BRACKET}|${AT_SPACED}|${AT_WORD})((?:${LABEL}${DOT})+${TLD})(?![\\p{L}\\p{N}\\-/@])`,
  'giu',
);
const AT_WORD_ONLY = new RegExp(`^${AT_WORD}$`, 'iu');
const AT_SPACED_ONLY = new RegExp(`^(?:${AT_SPACED})$`, 'u');
const DOT_WORD_ANY = new RegExp(DOT_WORD, 'iu');
const EMAIL_LABEL_BEFORE = /(?:e-?mail|email|mail)\b[^\n]*$/iu;
/** "Instagram @cafe.muster" is a social handle, not "instagram@cafe.muster". */
const SOCIAL = /(?:^|[^\p{L}])(?:instagram|insta|twitter|x|tiktok|mastodon|threads|facebook|youtube|linkedin|pinterest|telegram|bluesky|snapchat|xing)(?![\p{L}])/iu;

interface EmailCandidate {
  index: number;
  quote: string;
  value: string;
  form: EmailForm;
  source: 'text' | 'link';
  /** Link candidates: the link text, to find the link's place in the page text. */
  linkText?: string;
}

/** A syntactically valid address whose top-level domain exists (Public Suffix List, ICANN part) or is reserved for examples. */
function plainValid(address: string): boolean {
  const match = new RegExp(`^(${LOCAL})@((?:${LABEL}\\.)+(${TLD}))$`, 'u').exec(address);
  if (match === null) return false;
  const tld = (match[3] ?? '').toLowerCase();
  if (FILE_ENDINGS.test(tld)) return false;
  return RESERVED_TLDS.has(tld) || parseDomain(match[2] ?? '').isIcann === true;
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
    const value = match[0].toLowerCase();
    if (!plainValid(value)) continue;
    found.push({ index: match.index ?? 0, quote: match[0], value, form: 'plain', source: 'text' });
  }
  for (const match of text.matchAll(OBFUSCATED_EMAIL)) {
    const at = match[2] ?? '';
    const domainRaw = match[3] ?? '';
    const index = match.index ?? 0;
    const lineStart = text.lastIndexOf('\n', index) + 1;
    const linePrefix = text.slice(Math.max(lineStart, index - LINE_WINDOW), index);
    const spaced = AT_SPACED_ONLY.test(at);
    const usesWords = AT_WORD_ONLY.test(at) || DOT_WORD_ANY.test(domainRaw);
    // " at ", " dot " and a spaced "@" also appear outside e-mail addresses: only with an e-mail label
    // on the same line, and never as a social handle.
    if (usesWords || spaced) {
      if (!EMAIL_LABEL_BEFORE.test(linePrefix)) continue;
      if (SOCIAL.test(`${linePrefix} ${match[1] ?? ''}`)) continue;
    }
    if (/^www\./i.test(domainRaw)) continue;
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
      if (plainValid(address)) found.push({ index, quote: href, value: address, form: 'mailto', source: 'link', linkText: link.text });
      return;
    }
    const cf = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)$/i.exec(href);
    if (cf !== null) {
      const address = decodeCloudflareEmail(cf[1] ?? '')?.toLowerCase() ?? null;
      if (address !== null && plainValid(address)) found.push({ index, quote: href, value: address, form: 'cloudflare', source: 'link', linkText: link.text });
    }
  });
  return found;
}

/** Finds `needle` in `text` from `from` on, whatever kind and number of spaces stand between its words (link texts are normalised, `innerText` keeps `&nbsp;`). */
function findLoose(text: string, needle: string, from: number): { index: number; end: number } | null {
  const words = needle.split(/[\s   ]+/u).filter((w) => w !== '').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return null;
  const pattern = new RegExp(words.join('[\\s\\u00a0\\u2009\\u202f]+'), 'gu');
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  return match === null ? null : { index: match.index, end: match.index + match[0].length };
}

function findEmail(doc: Doc, links: readonly PageLink[], ownSites: ReadonlySet<string>, regionEnd: number): FieldResult<EmailValue> {
  const { text } = doc;
  const own = (address: string): boolean => ownSites.has(siteOfHost(address.split('@')[1] ?? ''));
  const skipped = new Set<string>();
  for (const candidate of textEmails(text)) {
    // After the operator's part of the page an address counts only on the site's own domain.
    if (inThirdPartyContext(doc, candidate.index) || (candidate.index >= regionEnd && !own(candidate.value))) {
      skipped.add(candidate.value);
      continue;
    }
    return { status: 'found', quote: candidate.quote, source: 'text', value: { value: candidate.value, form: candidate.form } };
  }
  // A link counts where the page shows it: its text is found in the page text in reading order and does
  // not stand in someone else's block. That place is known only for a text that is the address itself
  // (or the placeholder of Cloudflare's protection): a text such as "E-Mail" or "Kontakt" also stands in
  // menus and labels (session fix-a3, review finding 71). A link without a known place counts only for an
  // address on the site's own domain.
  let searchFrom = 0;
  for (const candidate of linkEmails(links)) {
    if (skipped.has(candidate.value)) continue;
    const linkText = (candidate.linkText ?? '').trim();
    const showsAddress = candidate.form === 'cloudflare' || linkText.toLowerCase().replace(/[\s\u00a0]+/g, '').includes(candidate.value);
    const place = linkText === '' || !showsAddress ? null : findLoose(text, linkText, searchFrom);
    if (place === null) {
      if (!own(candidate.value)) continue;
    } else {
      searchFrom = place.end;
      if (inThirdPartyContext(doc, place.index)) continue;
      if (place.index >= regionEnd && !own(candidate.value)) continue;
    }
    return { status: 'found', quote: candidate.quote, source: 'link', value: { value: candidate.value, form: candidate.form } };
  }
  return NOT_ON_PAGE;
}

// ---------------------------------------------------------------------------------------------
// Handelsregister

const REGISTER = new RegExp(
  // Groups of three digits may be divided by a dot or a space ("HRB 12.345", "HRB 12 345"). A number that
  // goes on after a space or a hyphen ("HRB 2024-01", "HRB 5 80331 …") is not read at all (review finding 73).
  `(?<![\\p{L}\\p{N}])HR${H}?([AB])(?![\\p{L}])(?:${H}*[-–]?${H}*(?:Nr\\.?|Nummer)?)?${H}*[:.]?${H}*(\\d{1,3}(?:[. \\u00a0]\\d{3})+|\\d{1,7})(?![.,]?\\p{N})(?!${H}?[-–]${H}?\\d)(?!${H}\\d)`,
  'gu',
);
const COURT_TOWN = `(${TOWN})`;
const COURT = new RegExp(
  `(?:Amtsgerichts?|Registergericht|Handelsregistergericht|Registergericht${H}*:?${H}*(?:Amtsgericht|AG)|Local${H}+court|District${H}+court(?:${H}+of)?|Regist(?:ry|er)${H}+court|Court${H}+of${H}+registration)${H}*[:,]?${H}*(?:(?:Amtsgericht|AG)${H}+)?${COURT_TOWN}`,
  'gu',
);
// "AG" is the court only at the start of the line or after a separator ("Registergericht: AG X, HRB 1");
// after a name it is the legal form ("Muster AG Vorstand …").
const AG_BEFORE = new RegExp(`(?:^|[,;:|(])${H}*AG${H}+${COURT_TOWN}${H}*[,;]?${H}*$`, 'u');
const AG_AFTER = new RegExp(`^${H}*[,;(]?${H}*(?:beim${H}+)?AG${H}+${COURT_TOWN}`, 'u');
const COURT_STOP = new Set(['hrb', 'hra', 'hr', 'handelsregister', 'registernummer', 'unter', 'nr', 'nr.', 'nummer']);

/** The town of a court phrase: read like a town, but it also ends at "HRB", "Nr." and similar words. */
function readCourt(raw: string): { town: string; length: number } | null {
  let cut = raw.length;
  for (const token of raw.matchAll(/[^ \t\u00a0\u2009\u202f]+/gu)) {
    if (COURT_STOP.has(token[0].toLowerCase().replace(/[:,;]+$/, ''))) {
      cut = token.index ?? cut;
      break;
    }
  }
  return readTown(raw.slice(0, cut));
}

/**
 * Does the clause that holds a court phrase name a place of jurisdiction ("Gerichtsstand für alle
 * Streitigkeiten ist das Amtsgericht …")? The clause runs back to the last line break or sentence end.
 */
function jurisdictionClause(text: string, start: number): boolean {
  const from = Math.max(0, start - LINE_WINDOW);
  const before = text.slice(from, start);
  const cut = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('. '), before.lastIndexOf('; '));
  const clause = cut === -1 ? before : before.slice(cut + 1);
  return /gerichtsstand|jurisdiction|place of|erf(?:ü|ue)llungsort|streitigkeit/iu.test(clause);
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

/** A number written as an example of the form ("z. B. HRB 12345", "Format: DE123456789"), not as the firm's own. */
const EXAMPLE_BEFORE = /(?:^|[^\p{L}])(?:z\.\s?b\.|zum beispiel|beispielsweise|bspw\.|e\.g\.|for example|beispiel:|format(?: der nummer)?:)[\s\u00a0]*["„“”'‚‘»(]?[\s\u00a0]*$/iu;

/** A register number written without "HRA" or "HRB" ("Handelsregister A, Registernummer 1234"). */
const REGISTER_LOOSE = new RegExp(`(?:registernummer|register-?nr\\.?|handelsregisternummer|hr-?nr\\.?)${H}*[:.]?${H}*(\\d[\\d .]{0,10})`, 'giu');

/** What may stand between court and number in one quote: register labels, punctuation, line breaks. */
const REGISTER_GAP = /handelsregister(?:nummer)?|registernummer|registergericht|register-?nr\.?|registereintrag|eingetragen|nummer|unter|beim|im|nr\.?|[\s :,;.()\-–|·]+/giu;

/** A court phrase belongs to the number on the same line, or on a line that is about the register. */
function courtLineFits(text: string, courtStart: number, numberAt: number): boolean {
  const lineStart = text.lastIndexOf('\n', courtStart - 1) + 1;
  if (numberAt >= lineStart && text.indexOf('\n', courtStart) > numberAt) return true;
  if (text.lastIndexOf('\n', numberAt - 1) + 1 === lineStart) return true;
  const prefix = text.slice(Math.max(lineStart, courtStart - LINE_WINDOW), courtStart);
  return prefix.trim() === '' || /(?:register|gericht|eingetragen|eintrag|sitz der gesellschaft)[^\n]{0,60}$/iu.test(prefix);
}

function findRegister(doc: Doc, regionEnd: number): FieldResult<RegisterValue> {
  const { text, lines } = doc;
  for (const match of text.matchAll(REGISTER)) {
    const at = match.index ?? 0;
    const end = at + match[0].length;
    // After the operator's part of the page a register entry belongs to the firm of that block.
    if (at >= regionEnd) break;
    if (inThirdPartyContext(doc, at)) continue;
    const ownLineStart = text.lastIndexOf('\n', at - 1) + 1;
    const ownPrefix = text.slice(Math.max(ownLineStart, at - LINE_WINDOW), at);
    if (EXAMPLE_BEFORE.test(ownPrefix)) continue;
    // The general partner of a GmbH & Co. KG is another company with its own register entry: on the
    // same line, or on the line above when the number stands alone below it.
    if (GENERAL_PARTNER.test(ownPrefix)) continue;
    const lineIndex = lineIndexAt(lines, at);
    if (/^[\s\u00a0]*(?:[\p{L}.\-]+[\s\u00a0]*){0,2}:?[\s\u00a0]*$/u.test(ownPrefix)) {
      let i = lineIndex - 1;
      while (i >= 0 && (lines[i] as Line).text.trim() === '') i -= 1;
      if (i >= 0 && i >= lineIndex - 2 && GENERAL_PARTNER.test((lines[i] as Line).text.slice(0, LINE_WINDOW))) continue;
    }
    const register = match[1] === 'A' ? 'HRA' : 'HRB';
    // The general partner is a GmbH (HRB); its data can fill several lines below its label.
    if (register === 'HRB') {
      let partner = false;
      for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 6 && (lines[i] as Line).text.trim() !== ''; i -= 1) {
        if (GENERAL_PARTNER.test((lines[i] as Line).text.slice(0, LINE_WINDOW))) partner = true;
      }
      if (partner) continue;
    }
    const number = (match[2] ?? '').replace(/[^\d]/g, '');
    // An earlier register number without "HRA"/"HRB" that differs is the operator's own entry: this one
    // then belongs to another company (the general partner, a parent).
    let otherNumber = false;
    for (const loose of text.slice(0, at).matchAll(REGISTER_LOOSE)) {
      const digits = (loose[1] ?? '').replace(/[^\d]/g, '');
      if (digits !== '' && digits !== number && !inThirdPartyContext(doc, loose.index ?? 0)) otherNumber = true;
    }
    if (otherNumber) return NOT_ON_PAGE;
    // The court: "AG Town" right next to the number, else the nearest court phrase in the block.
    let court: { town: string; start: number; end: number } | null = null;
    const lineStart = ownLineStart;
    const lineEnd = text.indexOf('\n', end) === -1 ? text.length : text.indexOf('\n', end);
    const before = AG_BEFORE.exec(text.slice(lineStart, at));
    const after = AG_AFTER.exec(text.slice(end, lineEnd));
    if (before !== null) {
      const read = readCourt(before[1] ?? '');
      if (read !== null) court = { town: read.town, start: lineStart + (before.index ?? 0), end: at };
    } else if (after !== null) {
      const read = readCourt(after[1] ?? '');
      if (read !== null) {
        const townAt = end + after[0].length - (after[1] ?? '').length;
        court = { town: read.town, start: end, end: townAt + read.length };
      }
    }
    if (court === null) {
      const block = blockAround(text, at, end, 160);
      let best: { town: string; start: number; end: number; distance: number } | null = null;
      for (const phrase of text.slice(block.from, block.to).matchAll(COURT)) {
        const start = block.from + (phrase.index ?? 0);
        if (jurisdictionClause(text, start)) continue;
        // The court of another firm named in the same block is not the operator's register court.
        if (!courtLineFits(text, start, at)) continue;
        const read = readCourt(phrase[1] ?? '');
        if (read === null) continue;
        const town = read.town;
        const townAt = start + phrase[0].length - (phrase[1] ?? '').length;
        const phraseEnd = townAt + read.length;
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
        if (!courtLineFits(text, start, at)) continue;
        const read = readCourt(phrase[1] ?? '');
        if (read === null) continue;
        const town = read.town;
        const townAt = start + phrase[0].length - (phrase[1] ?? '').length;
        const phraseEnd = townAt + read.length;
        const distance = start > at ? start - end : at - phraseEnd;
        if (best === null || distance < best.distance) best = { town, start, end: phraseEnd, distance };
      }
      if (best !== null) court = best;
    }
    // The quote: number and court together when nothing but a register label stands between them
    // ("Amtsgericht X", then "Registernummer:", then "HRB 1"); otherwise only the number, so no line of
    // other data (a manager's name, a tax number) gets into the quote.
    let from = at;
    let to = end;
    if (court !== null) {
      const gap = court.start > at ? text.slice(end, court.start) : text.slice(court.end, at);
      if (gap.length <= 80 && gap.replace(REGISTER_GAP, '').trim() === '') {
        from = Math.min(at, court.start);
        to = Math.max(end, court.end);
      }
    }
    return { status: 'found', quote: text.slice(from, to), source: 'text', value: { register, number, court: court?.town ?? null } };
  }
  return NOT_ON_PAGE;
}

// ---------------------------------------------------------------------------------------------
// USt-IdNr

// Not followed by more digits, also not after a hyphen or a slash: "DE123456789-00001" is a W-IdNr.
const VAT_ID = new RegExp(`(?<![\\p{L}\\p{N}])DE${H}?-?${H}?(\\d(?:[ \\u00a0.]?\\d){8})(?![ \\u00a0.]?\\d)(?!${H}?[-–/]${H}?\\d)(?![\\p{L}])`, 'gu');
/** The label of a VAT id: "USt-IdNr.", "USt-ID", "UStID", "Umsatzsteuer-Identifikationsnummer", "VAT ID", "UID". */
const VAT_LABEL = /umsatzsteuer|mehrwertsteuer|turnover tax|sales tax|steuer-?(?:nummer|nr|id)|(?:^|[^\p{L}])(?:u\.?[\s\u00a0]?st|vat|uid|mwst)(?:[^\p{L}]|id|ident|nr|$)/giu;
/** Labels of other numbers of the form "DE" plus digits, and of numbers that are no id at all. */
const NOT_VAT = /iban|bic|swift|konto|bankverbindung|blz|w-?idnr|wirtschafts-?id|eori|zertifi|hotline|telefon|(?:^|[^\p{L}])(?:tel|fon|fax)(?![\p{L}])|mobil|handy|art\.?-?nr|artikel|weee|lucid|(?:ö|oe)ko|gl(?:ä|ae)ubiger/iu;

/**
 * Is the number at `at` named as a VAT id (session fix-a3, review finding 74)? The label stands before it
 * on the same line, with no label of another number between, or on one of the two lines above ("Umsatz-
 * steuer-ID" as a heading, then the legal sentence, then the number). "DE" plus nine digits alone can be a
 * W-IdNr, an EORI number, a certificate, a phone number or an example of the form. "Steuernummer" counts
 * as a label too: a German tax number never starts with "DE", so "Steuernummer: DE123456789" is a VAT id
 * under the wrong name.
 */
function namedVatId(doc: Doc, at: number): boolean {
  const { text, lines } = doc;
  const lineIndex = lineIndexAt(lines, at);
  const line = lines[lineIndex] as Line;
  const prefix = text.slice(Math.max(line.start, at - LINE_WINDOW), at);
  if (EXAMPLE_BEFORE.test(prefix)) return false;
  let lastLabelEnd = -1;
  for (const label of prefix.matchAll(VAT_LABEL)) lastLabelEnd = (label.index ?? 0) + label[0].length;
  if (lastLabelEnd !== -1) return !NOT_VAT.test(prefix.slice(lastLabelEnd));
  if (NOT_VAT.test(prefix.slice(-60))) return false;
  let seen = 0;
  for (let i = lineIndex - 1; i >= 0 && i >= lineIndex - 4 && seen < 2; i -= 1) {
    const above = (lines[i] as Line).text.slice(-LINE_WINDOW);
    if (above.trim() === '') continue;
    VAT_LABEL.lastIndex = 0;
    if (VAT_LABEL.test(above)) {
      VAT_LABEL.lastIndex = 0;
      return true;
    }
    seen += 1;
  }
  return false;
}

function findVatId(doc: Doc, regionEnd: number): FieldResult<string> {
  const { text } = doc;
  for (const match of text.matchAll(VAT_ID)) {
    const at = match.index ?? 0;
    // After the operator's part of the page a VAT id belongs to the firm of that block.
    if (at >= regionEnd) break;
    if (!namedVatId(doc, at)) continue;
    if (inThirdPartyContext(doc, at)) continue;
    const digits = (match[1] ?? '').replace(/\D/g, '');
    return { status: 'found', quote: match[0], source: 'text', value: `DE${digits}` };
  }
  return NOT_ON_PAGE;
}
