import type { PageLink } from '../capture/types.ts';
import { siteOfUrl } from '../domain/site.ts';

/**
 * Links to the legal pages on the homepage (session A4): Impressum, Datenschutzerklärung and the
 * Erklärung zur Barrierefreiheit. Only links that are on the page count; the scanner never guesses an
 * address such as /impressum (that would be probing paths, which the brief forbids).
 *
 * A link counts when its text names the page (German and English texts). A link of the site itself comes
 * before a link to another site, an exact text before a combined label, the footer before the rest of the
 * page in document order. Only when no link text matches, a link whose address names the page counts
 * (for example an icon link without text). Only http(s) links and anchors on the page itself count,
 * never `javascript:`, `mailto:` or a bare `#`.
 *
 * Session fix-a3 (review findings 7, 14, 15 and 16):
 * - a text that only contains the word counts only as a combined label of legal pages ("Impressum &
 *   Datenschutz", "Zum Impressum"), never with other words ("Impressum erstellen", "Datenschutz im Verein");
 * - a Datenschutz or accessibility link to another site, or to an anchor of the homepage itself, is never
 *   certain: it can be the policy of a captcha or payment provider, or the button of a consent tool;
 * - an accessibility link is certain only when its whole text is the name of the statement, or when the
 *   last part of its address is, and the text does not say something else;
 * - characters that are invisible on the page (soft hyphen, zero-width characters) do not break a word.
 */

export type LegalLinkKind = 'impressum' | 'datenschutz' | 'accessibilityStatement';

export interface LegalLinkMatch {
  /** Absolute address as the browser resolved it. */
  href: string;
  text: string;
  footer: boolean;
  matchedBy: 'text' | 'href';
  /**
   * False when the report must not say "vorhanden" but "bitte manuell prüfen" (`uncertain` says why).
   * Always true for the Impressum link (an Impressum on another site is `crossSite` in the analysis, an
   * anchor is the state `same-page`).
   */
  certain: boolean;
  /**
   * Why the link is not certain, else null. `topic`: an accessibility link that names only the topic or
   * says more than the name of the statement ("Barrierefreiheit", "Informationen zur Barrierefreiheit",
   * "Erklärung zur Barrierefreiheit erstellen lassen"); it can lead to a statement or to any page about
   * the topic. `other-site`: the link leads to another site. `same-page`: an anchor of the homepage itself.
   */
  uncertain: 'topic' | 'other-site' | 'same-page' | null;
}

export type LegalLinks = Record<LegalLinkKind, LegalLinkMatch | null>;

interface KindRules {
  /** Tested against the normalized link text. */
  text: (text: string) => 'exact' | 'contains' | null;
  /** Tested against the decoded path and fragment of the address. */
  href: RegExp;
}

/**
 * Characters that take no space on the page and stand inside words: the soft hyphen (generators and
 * site builders write "Daten&shy;schutz&shy;erklärung"), zero-width space and joiners, the word joiner
 * and the byte order mark.
 */
const INVISIBLE = /[­​-‍⁠﻿]/g;

/** Text without the invisible characters; a no-op (the same string) for a text without them. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, '');
}

/** Lower case, umlauts kept, invisible characters removed, every run of whitespace made a single space. */
export function normalizeLinkText(text: string): string {
  return stripInvisible(text.normalize('NFC'))
    .toLowerCase()
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text without punctuation, for "is the whole text just this word" checks. */
function bare(text: string): string {
  return text.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/ +/g, ' ').trim();
}

const IMPRESSUM_WORDS = /(?:^|[^\p{L}])(?:impressum|imprint|anbieterkennzeichnung|anbieterkennung|legal notice|site notice)(?![\p{L}])/u;
const IMPRESSUM_EXACT = /^(?:impressum|imprint|anbieterkennzeichnung|anbieterkennung|legal notice|site notice)$/;

/**
 * Whole words only: "Datenschutzberatung" is a service and "Datenschutzfolie" a product, not the policy.
 */
const PRIVACY_NAMES = 'datenschutz|datenschutzerklärung|datenschutzerklaerung|datenschutzhinweise?|datenschutzinformation(?:en)?|datenschutzinfos?|datenschutzbestimmungen|datenschutzrichtlinien?';
const PRIVACY_WORDS = new RegExp(`(?:^|[^\\p{L}])(?:${PRIVACY_NAMES}|privacy(?: policy| notice| statement)?|data protection(?: policy| notice| statement)?|data privacy)(?![\\p{L}])`, 'u');
const PRIVACY_EXACT = new RegExp(`^(?:${PRIVACY_NAMES}|privacy|privacy policy|privacy notice|privacy statement|data protection|data protection policy|data privacy)$`, 'u');
/** Consent settings and similar links are not the privacy policy. */
const PRIVACY_NOT = /einstellung|settings|präferenz|praeferenz|preferences|verwalten|manage|widerruf|opt.?out|do not sell|anpassen|auswahl|beauftragte|officer/u;

/** The name of the statement, as the whole link text. */
const A11Y_STATEMENT_EXACT =
  /^(?:erkl(?:ä|ae)rung (?:zur|der|über die|zu) (?:digitalen )?barrierefreiheit|barrierefreiheitserkl(?:ä|ae)rung|accessibility statement|statement on accessibility)$/u;
/** The topic anywhere in a text: such a link is found, but never certain. */
const A11Y_TOPIC = /(?:^|[^\p{L}])(?:barrierefreiheit|barrierefreiheitserkl(?:ä|ae)rung|accessibility)(?![\p{L}])/u;
/** Links of accessibility toolbars and overlays: they open a widget, not a statement. */
const A11Y_NOT = /anpassen|einstellung|settings|menü|menu|tool|widget|modus|mode|leiste|bar\b|öffnen|open|aktivieren|activate|hilfe|help|leichte sprache|gebärden/u;

/** "Contains the word" counts only for a short label ("Kontakt / Impressum"), never for an article title. */
function shortLabel(text: string, words = 4): boolean {
  return bare(text).split(' ').length <= words;
}

/**
 * Words a combined label of legal pages is made of ("Impressum & Datenschutz", "Zum Impressum",
 * "Kontakt und Impressum", "Rechtliche Hinweise / Impressum"). A label with any other word ("Impressum
 * Pflicht", "Impressum erstellen", "Impressum Generator", "Datenschutz im Verein") is a teaser, a service
 * or an article, not the legal page of this site.
 */
const LABEL_WORDS = new Set([
  'und', 'and', 'oder', 'or', 'zum', 'zur', 'unser', 'unsere', 'das', 'die', 'der', 'the', 'our', 'link', 'hier', 'seite',
  'impressum', 'imprint', 'anbieterkennzeichnung', 'anbieterkennung', 'legal', 'notice', 'site', 'kontakt', 'contact',
  'datenschutz', 'datenschutzerklärung', 'datenschutzerklaerung', 'datenschutzhinweis', 'datenschutzhinweise', 'datenschutzinformation',
  'datenschutzinformationen', 'datenschutzinfo', 'datenschutzinfos', 'datenschutzbestimmungen', 'datenschutzrichtlinie', 'datenschutzrichtlinien',
  'privacy', 'policy', 'statement', 'data', 'protection', 'agb', 'terms', 'rechtliches', 'rechtliche', 'rechtlicher', 'rechtsangaben', 'hinweis', 'hinweise',
  'information', 'informationen', 'info', 'infos', 'angaben', 'haftungsausschluss', 'disclaimer', 'nutzungsbedingungen', 'cookie', 'cookies',
  'cookierichtlinie', 'richtlinie', 'widerrufsrecht', 'widerrufsbelehrung', 'copyright', 'urheberrecht', 'bildnachweis', 'bildnachweise',
]);

function combinedLabel(text: string): boolean {
  const words = bare(text).split(' ');
  return words.length <= 4 && words.every((word) => LABEL_WORDS.has(word));
}

const RULES: Record<LegalLinkKind, KindRules> = {
  impressum: {
    text: (t) => (IMPRESSUM_EXACT.test(bare(t)) ? 'exact' : IMPRESSUM_WORDS.test(t) && combinedLabel(t) ? 'contains' : null),
    href: /impressum|imprint|legal-notice|legal_notice|legalnotice|anbieterkennzeichnung/,
  },
  datenschutz: {
    text: (t) => (PRIVACY_NOT.test(t) ? null : PRIVACY_EXACT.test(bare(t)) ? 'exact' : PRIVACY_WORDS.test(t) && combinedLabel(t) ? 'contains' : null),
    href: /datenschutz|privacy/,
  },
  accessibilityStatement: {
    text: (t) => {
      if (A11Y_NOT.test(t)) return null;
      // The name of the statement ranks before a text that names the topic or says more than the name.
      if (A11Y_STATEMENT_EXACT.test(bare(t))) return 'exact';
      return A11Y_TOPIC.test(t) && shortLabel(t, 6) ? 'contains' : null;
    },
    href: /barrierefreiheit|accessibility-statement|accessibility_statement|barrierefreiheitserklaerung|erklaerung-zur-barrierefreiheit/,
  },
};

/** The word of each kind anywhere in a text, also inside a longer word: such a text talks about the topic. */
const STEM: Record<LegalLinkKind, RegExp> = {
  impressum: /impressum|imprint|anbieterkenn|legal notice|site notice/u,
  datenschutz: /datenschutz|privacy|data protection/u,
  accessibilityStatement: /barrierefrei|accessib/u,
};

const HREF_NOT: Record<LegalLinkKind, RegExp | null> = {
  impressum: null,
  datenschutz: /einstellung|settings|preferences|opt-?out/,
  accessibilityStatement: /widget|toolbar|menu/,
};

/** Is the address something the scanner may follow: http(s), or an anchor with a name on the page itself? */
export function usableHref(href: string, pageUrl: string | null): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  // A link to the page itself counts only with a fragment that names an element ("#impressum"); a bare
  // "#", "#!", "#0" or an empty href (often the trigger of a modal) opens nothing.
  if (pageUrl !== null && sameDocument(href, pageUrl)) return /^#[A-Za-z][\w:.-]*$/.test(url.hash);
  return true;
}

/** Same document, ignoring the fragment. */
export function sameDocument(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return false;
  }
}

function hrefPart(href: string): string {
  try {
    const url = new URL(href);
    return decodeURIComponent(`${url.pathname}${url.hash}`).toLowerCase();
  } catch {
    return href.toLowerCase();
  }
}

/** Whole words of the address path and fragment: "/rechtliches/impressum.html" gives rechtliches, impressum, html. */
function hrefTokens(part: string): string[] {
  return part.split(/[/#?._-]+/).filter((t) => t !== '');
}

/**
 * The address fallback needs a whole word of the path ("/impressum", "/kontakt-impressum"), not a part
 * of a longer word ("/blog/impressumspflicht-auf-instagram").
 */
const HREF_WORDS: Record<LegalLinkKind, readonly string[]> = {
  impressum: ['impressum', 'imprint', 'anbieterkennzeichnung', 'notice'],
  datenschutz: ['datenschutz', 'datenschutzerklaerung', 'datenschutzerklarung', 'datenschutzerklärung', 'privacy'],
  accessibilityStatement: ['barrierefreiheit', 'barrierefreiheitserklaerung', 'barrierefreiheitserklarung', 'accessibility', 'statement', 'erklaerung'],
};

const FILE_ENDING = /\.(?:html?|php|aspx?|jsp)$/;
/** Words an address of a legal page is made of, next to the word of the page itself. */
const SLUG_WORDS = new Set([...LABEL_WORDS, 'erklaerung', 'erklarung', 'erklärung', 'digitale', 'digitalen', 'legal', 'page', 'pages', 'policies']);

/**
 * Does the last part of the address name the page itself ("/impressum/", "/kontakt-impressum.html",
 * "#impressum"), and nothing else ("/blog/impressum-pflicht/", "/leistungen/impressum-erstellen/")?
 */
function lastPartNamesPage(kind: LegalLinkKind, href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  let last: string;
  try {
    last = decodeURIComponent(url.hash !== '' ? url.hash.slice(1) : (url.pathname.split('/').filter((s) => s !== '').at(-1) ?? '')).toLowerCase();
  } catch {
    return false;
  }
  const tokens = last.replace(FILE_ENDING, '').split(/[._-]+/).filter((t) => t !== '');
  return tokens.length > 0 && tokens.length <= 5 && tokens.some((t) => HREF_WORDS[kind].includes(t)) && tokens.every((t) => HREF_WORDS[kind].includes(t) || SLUG_WORDS.has(t));
}

/** The last part of the address is the name of the statement, whole: "/barrierefreiheitserklaerung", "/erklaerung-zur-barrierefreiheit/". */
const A11Y_STATEMENT_SLUG = /^(?:barrierefreiheitserkl(?:ae|a|ä)rung|erkl(?:ae|a|ä)rung-zur-(?:digitalen-)?barrierefreiheit|accessibility[-_]statement)$/u;

function a11ySlugIsStatement(href: string): boolean {
  try {
    const last = decodeURIComponent(new URL(href).pathname.split('/').filter((s) => s !== '').at(-1) ?? '').toLowerCase();
    return A11Y_STATEMENT_SLUG.test(last.replace(FILE_ENDING, ''));
  } catch {
    return false;
  }
}

/** Finds one link per kind. `pageUrl` is the final URL of the page the links come from. */
export function findLegalLinks(links: readonly PageLink[], pageUrl: string | null): LegalLinks {
  const result = {} as LegalLinks;
  for (const kind of Object.keys(RULES) as LegalLinkKind[]) result[kind] = findLink(kind, links, pageUrl);
  return result;
}

export function findLink(kind: LegalLinkKind, links: readonly PageLink[], pageUrl: string | null): LegalLinkMatch | null {
  const rules = RULES[kind];
  const site = pageUrl === null ? null : siteOfUrl(pageUrl);
  // A link to another registrable domain; unknown (no page address) counts as the site's own.
  const otherSite = (link: PageLink): boolean => site !== null && siteOfUrl(link.href) !== site;
  const anchor = (link: PageLink): boolean => pageUrl !== null && sameDocument(link.href, pageUrl);
  // The Impressum may be an anchor (one-page sites: the state `same-page`); a Datenschutz or accessibility
  // "link" to the homepage itself is often the button of a consent tool.
  const weak = (link: PageLink): boolean => otherSite(link) || (kind !== 'impressum' && anchor(link));
  const usable = links.filter((link) => usableHref(link.href, pageUrl));

  // 1. by text: a link of the site itself first, then an exact text before a combined label, then the
  // footer, then document order.
  let best: { link: PageLink; rank: number } | null = null;
  for (const link of usable) {
    const how = rules.text(normalizeLinkText(link.text));
    if (how === null) continue;
    // An exact text wins over the footer position: a footer widget with a label that only contains the
    // word must not beat a plain "Impressum" link in the header.
    const rank = (weak(link) ? 4 : 0) + (how === 'exact' ? 0 : 2) + (link.footer === true ? 0 : 1);
    if (best === null || rank < best.rank) best = { link, rank };
  }
  const byText = best as { link: PageLink; rank: number } | null;
  if (byText !== null && byText.rank < 4) return toMatch(kind, byText.link, 'text', false, false);

  // 2. by address, only links whose text names nothing else: the site itself first, the footer first,
  // then document order.
  const not = HREF_NOT[kind];
  const byHref = usable.filter((link) => {
    if (kind !== 'impressum' && weak(link)) return false;
    const part = hrefPart(link.href);
    return HREF_WORDS[kind].some((word) => hrefTokens(part).includes(word)) && rules.href.test(part) && (not === null || !not.test(part)) && hrefFallbackText(kind, normalizeLinkText(link.text), link.href);
  });
  const ownByHref = byHref.filter((link) => !otherSite(link));
  const chosen = ownByHref.find((link) => link.footer === true) ?? ownByHref[0];
  if (chosen !== undefined) return toMatch(kind, chosen, 'href', false, false);

  // 3. a link to another site, or (Datenschutz, accessibility) an anchor of the homepage.
  if (byText !== null) return toMatch(kind, byText.link, 'text', otherSite(byText.link), anchor(byText.link));
  const foreign = byHref.find((link) => link.footer === true) ?? byHref[0];
  return foreign === undefined ? null : toMatch(kind, foreign, 'href', true, false);
}

/**
 * The address counts only when the link text does not say that the link is something else: not a
 * consent setting or an accessibility toolbar, not the text of another legal page, and not a text about
 * the page ("Impressum Pflicht", "Datenschutzberatung") unless the address ends in the name of the page.
 */
function hrefFallbackText(kind: LegalLinkKind, text: string, href: string): boolean {
  if (text === '') return true;
  // A long text is an article title or a sentence, not a label of a legal page.
  if (!shortLabel(text)) return false;
  if (kind === 'datenschutz' && PRIVACY_NOT.test(text)) return false;
  if (kind === 'accessibilityStatement' && A11Y_NOT.test(text)) return false;
  for (const other of Object.keys(RULES) as LegalLinkKind[]) {
    if (other !== kind && RULES[other].text(text) !== null) return false;
  }
  if (STEM[kind].test(text)) return lastPartNamesPage(kind, href);
  return true;
}

function toMatch(kind: LegalLinkKind, link: PageLink, matchedBy: 'text' | 'href', otherSite: boolean, anchor: boolean): LegalLinkMatch {
  let uncertain: LegalLinkMatch['uncertain'] = null;
  if (kind !== 'impressum') {
    if (otherSite) uncertain = 'other-site';
    else if (anchor) uncertain = 'same-page';
  }
  if (uncertain === null && kind === 'accessibilityStatement') {
    const text = normalizeLinkText(link.text);
    const named = A11Y_STATEMENT_EXACT.test(bare(text));
    // The address alone says "statement" only for a text that says nothing else about the topic: the
    // topic itself ("Barrierefreiheit") or no word of it (an icon link).
    const neutral = text === '' || !STEM.accessibilityStatement.test(text) || /^(?:digitale )?barrierefreiheit$|^accessibility$/u.test(bare(text));
    if (!named && !(neutral && a11ySlugIsStatement(link.href))) uncertain = 'topic';
  }
  return { href: link.href, text: link.text, footer: link.footer === true, matchedBy, certain: uncertain === null, uncertain };
}

/** What the adapter does with the Impressum link of the homepage. */
export type ImpressumTarget =
  | { action: 'open'; url: string; link: LegalLinkMatch }
  /**
   * The link is an anchor on the homepage itself (one-page sites). The fields are not searched: the
   * homepage text holds more than the Impressum section (client projects, partners), so they are
   * "bitte manuell prüfen" (reading only the section is in the backlog).
   */
  | { action: 'same-page'; link: LegalLinkMatch }
  /** The link leads to a PDF: the scan does not read PDF files. */
  | { action: 'skip'; reason: 'pdf'; link: LegalLinkMatch }
  | { action: 'none' };

export function chooseImpressumTarget(links: readonly PageLink[], pageUrl: string | null): ImpressumTarget {
  const link = findLink('impressum', links, pageUrl);
  if (link === null) return { action: 'none' };
  if (pageUrl !== null && sameDocument(link.href, pageUrl)) return { action: 'same-page', link };
  if (/\.pdf$/i.test(new URL(link.href).pathname)) return { action: 'skip', reason: 'pdf', link };
  return { action: 'open', url: link.href, link };
}
