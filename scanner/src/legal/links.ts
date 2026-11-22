import type { PageLink } from '../capture/types.ts';

/**
 * Links to the legal pages on the homepage (session A4): Impressum, Datenschutzerklärung and the
 * Erklärung zur Barrierefreiheit. Only links that are on the page count; the scanner never guesses an
 * address such as /impressum (that would be probing paths, which the brief forbids).
 *
 * A link counts when its text names the page (German and English texts). The footer comes first, then
 * the rest of the page in document order. Only when no link text matches, a link whose address names
 * the page counts (for example an icon link without text). Only http(s) links and anchors on the page
 * itself count, never `javascript:`, `mailto:` or a bare `#`.
 */

export type LegalLinkKind = 'impressum' | 'datenschutz' | 'accessibilityStatement';

export interface LegalLinkMatch {
  /** Absolute address as the browser resolved it. */
  href: string;
  text: string;
  footer: boolean;
  matchedBy: 'text' | 'href';
  /**
   * Accessibility statement only: false when the link names only the topic ("Barrierefreiheit",
   * "Digitale Barrierefreiheit"). Such a link can lead to a statement or to any page about the topic (an
   * agency's service page, for example), so the report says "bitte manuell prüfen", never "vorhanden".
   * True when the text or the address says statement ("Erklärung zur Barrierefreiheit", "…-erklaerung").
   * Always true for the other kinds.
   */
  certain: boolean;
}

export type LegalLinks = Record<LegalLinkKind, LegalLinkMatch | null>;

interface KindRules {
  /** Tested against the normalized link text. */
  text: (text: string) => 'exact' | 'contains' | null;
  /** Tested against the decoded path and fragment of the address. */
  href: RegExp;
}

/** Lower case, umlauts kept, every run of whitespace and dash-like characters made a single space. */
export function normalizeLinkText(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text without punctuation, for "is the whole text just this word" checks. */
function bare(text: string): string {
  return text.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/ +/g, ' ').trim();
}

const IMPRESSUM_WORDS = /(?:^|[^\p{L}])(?:impressum|imprint|anbieterkennzeichnung|anbieterkennung|legal notice|site notice)(?![\p{L}])/u;
const IMPRESSUM_EXACT = /^(?:impressum|imprint|anbieterkennzeichnung|anbieterkennung|legal notice|site notice)$/;

const PRIVACY_WORDS = /(?:^|[^\p{L}])(?:datenschutz\p{L}*|privacy(?: policy| notice| statement)?|data protection(?: policy| notice| statement)?|data privacy)(?![\p{L}])/u;
const PRIVACY_EXACT = /^(?:datenschutz|datenschutzerklärung|datenschutzerklaerung|datenschutzhinweise|datenschutzinformationen|datenschutzbestimmungen|privacy|privacy policy|privacy notice|data protection|data privacy)$/;
/** Consent settings and similar links are not the privacy policy. */
const PRIVACY_NOT = /einstellung|settings|präferenz|praeferenz|preferences|verwalten|manage|widerruf|opt.?out|do not sell|anpassen|beauftragte|officer/u;

const A11Y_STATEMENT = /barrierefreiheitserkl|erkl(?:ä|ae)rung (?:zur|der|über die|zu) barrierefreiheit|accessibility statement|statement on accessibility|(?:hinweise|informationen|angaben) zur barrierefreiheit/u;
const A11Y_PLAIN = /^(?:barrierefreiheit|accessibility|digitale barrierefreiheit|barrierefreiheit bfsg|barrierefreiheit nach bfsg|bfsg barrierefreiheit)$/;
/** Links of accessibility toolbars and overlays: they open a widget, not a statement. */
const A11Y_NOT = /anpassen|einstellung|settings|menü|menu|tool|widget|modus|mode|leiste|bar\b|öffnen|open|aktivieren|activate|hilfe|help|leichte sprache|gebärden/u;

/** "Contains the word" counts only for a short label ("Kontakt / Impressum"), never for an article title. */
function shortLabel(text: string): boolean {
  return bare(text).split(' ').length <= 4;
}

const RULES: Record<LegalLinkKind, KindRules> = {
  impressum: {
    text: (t) => (IMPRESSUM_EXACT.test(bare(t)) ? 'exact' : IMPRESSUM_WORDS.test(t) && shortLabel(t) ? 'contains' : null),
    href: /impressum|imprint|legal-notice|legal_notice|legalnotice|anbieterkennzeichnung/,
  },
  datenschutz: {
    text: (t) => (PRIVACY_NOT.test(t) ? null : PRIVACY_EXACT.test(bare(t)) ? 'exact' : PRIVACY_WORDS.test(t) && shortLabel(t) ? 'contains' : null),
    href: /datenschutz|privacy/,
  },
  accessibilityStatement: {
    text: (t) => {
      if (A11Y_NOT.test(t)) return null;
      // A text that says statement ranks before a text that names only the topic.
      if (A11Y_STATEMENT.test(t) && bare(t).split(' ').length <= 6) return 'exact';
      return A11Y_PLAIN.test(bare(t)) ? 'contains' : null;
    },
    href: /barrierefreiheit|accessibility-statement|accessibility_statement|barrierefreiheitserklaerung|erklaerung-zur-barrierefreiheit/,
  },
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

/** Finds one link per kind. `pageUrl` is the final URL of the page the links come from. */
export function findLegalLinks(links: readonly PageLink[], pageUrl: string | null): LegalLinks {
  const result = {} as LegalLinks;
  for (const kind of Object.keys(RULES) as LegalLinkKind[]) result[kind] = findLink(kind, links, pageUrl);
  return result;
}

export function findLink(kind: LegalLinkKind, links: readonly PageLink[], pageUrl: string | null): LegalLinkMatch | null {
  const rules = RULES[kind];
  const usable = links.filter((link) => usableHref(link.href, pageUrl));
  // 1. by text: footer first, an exact text before a text that only contains the word, then document order.
  let best: { link: PageLink; rank: number; index: number } | null = null;
  usable.forEach((link, index) => {
    const how = rules.text(normalizeLinkText(link.text));
    if (how === null) return;
    // An exact text wins over the footer position: a footer widget with an article title that only
    // contains the word must not beat a plain "Impressum" link in the header.
    const rank = (how === 'exact' ? 0 : 2) + (link.footer === true ? 0 : 1);
    if (best === null || rank < best.rank) best = { link, rank, index };
  });
  const byText = best as { link: PageLink } | null;
  if (byText !== null) return toMatch(kind, byText.link, 'text');
  // 2. by address, only links whose text names nothing else: footer first, then document order.
  const not = HREF_NOT[kind];
  const byHref = usable.filter((link) => {
    const part = hrefPart(link.href);
    return HREF_WORDS[kind].some((word) => hrefTokens(part).includes(word)) && rules.href.test(part) && (not === null || !not.test(part)) && hrefFallbackText(kind, normalizeLinkText(link.text));
  });
  const chosen = byHref.find((link) => link.footer === true) ?? byHref[0];
  return chosen === undefined ? null : toMatch(kind, chosen, 'href');
}

/**
 * The address counts only when the link text does not say that the link is something else: not a
 * consent setting or an accessibility toolbar, and not the text of another legal page.
 */
function hrefFallbackText(kind: LegalLinkKind, text: string): boolean {
  if (text === '') return true;
  // A long text is an article title or a sentence, not a label of a legal page.
  if (!shortLabel(text)) return false;
  if (kind === 'datenschutz' && PRIVACY_NOT.test(text)) return false;
  if (kind === 'accessibilityStatement' && A11Y_NOT.test(text)) return false;
  for (const other of Object.keys(RULES) as LegalLinkKind[]) {
    if (other !== kind && RULES[other].text(text) !== null) return false;
  }
  return true;
}

/** Addresses that say statement, not only the topic. */
const A11Y_STATEMENT_HREF = /barrierefreiheitserkl|erklaerung-zur-barrierefreiheit|erklarung-zur-barrierefreiheit|accessibility-statement|accessibility_statement/;

function toMatch(kind: LegalLinkKind, link: PageLink, matchedBy: 'text' | 'href'): LegalLinkMatch {
  const certain = kind !== 'accessibilityStatement' || A11Y_STATEMENT.test(normalizeLinkText(link.text)) || A11Y_STATEMENT_HREF.test(hrefPart(link.href));
  return { href: link.href, text: link.text, footer: link.footer === true, matchedBy, certain };
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
