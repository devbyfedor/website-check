// German texts of the report page, upper part (session B3 part 1: head, Prüfmaße, "Drei Dinge" with the plan,
// Zeitschnitt A–A). Texts marked "reference" are the final texts of design/reference/bericht.html; every other text
// is a DRAFT (docs/content-drafts.md, "Session B3 part 1"), or a title taken over from an earlier draft of that file.
// A value of the scanned page is never put into a template string here: titles are phrases whose page values stay
// text nodes of their own (<bdi>), and every template is filled in one pass (`fill`).

import type { FileType, FindingArea, FindingRisk, MeasureId, MeasureResult } from '@website-check/scanner/report';
import type { Phrase } from '../components/scan/scan-data';

/** German decimal comma: 2.9 → "2,9", 4.5 → "4,5", 21 → "21". */
export const decimal = (n: number): string => String(n).replace('.', ',');

/** Seconds with one decimal: 1,400 ms → "1,4", 3,000 ms → "3". The Zeitschnitt writes whole seconds without ",0". */
export const seconds = (ms: number): string => decimal(Math.round(ms / 100) / 10);

export const REPORT_TEXTS = {
  title: 'Prüfbericht, Website-Check DE', // draft; the reference: "Prüfbericht, Bauplan"
  newScan: 'Neue Prüfung', // reference
  navMethod: 'So prüfen wir', // reference
  navBfsg: 'BFSG-Check', // reference

  // Head (reference).
  headingFor: 'Prüfbericht für',
  savePdf: 'Als PDF speichern',
  copyLink: 'Link kopieren',
  forDeveloper: 'An Entwickler weitergeben',
  scannedAt: 'Geprüft am',
  system: 'System',
  pages: 'Geprüfte Seiten',
  revision: 'Revision',
  /** Reference: "19. November 2026, 18:42 Uhr". */
  dateTime: (date: string, time: string) => `${date}, ${time} Uhr`,
  /** Reference: "WordPress mit WooCommerce". */
  withWoocommerce: (system: string) => `${system} mit WooCommerce`,
  systemUnknown: 'unbekannt', // the brief: "otherwise unbekannt"
  pagesBoth: 'Startseite und Impressum', // reference
  pagesHomepage: 'Startseite', // draft
  revisionInitial: (letter: string) => `${letter}, Erstprüfung`, // reference: "A, Erstprüfung"

  // Prüfmaße (reference, except the drafts marked).
  measuresHeading: 'Prüfmaße',
  measuresLead: 'Soll nach Gesetz und Richtlinie, Ist auf Ihrer Startseite',
  columns: ['Merkmal', 'Soll', 'Ist', 'Ergebnis'] as const,
  bfsgBefore: 'Ob das Barrierefreiheitsstärkungsgesetz für Sie überhaupt gilt, klären Sie im ',
  bfsgLink: 'BFSG-Prüfschema',
  bfsgAfter: '.',

  // "Drei Dinge" (reference).
  prioritiesHeading: 'Drei Dinge sollten Sie zuerst beheben',
  field: (field: string) => `Feld ${field}`,

  // Zeitschnitt A–A (reference, except the drafts marked).
  timelineHeading: 'Zeitschnitt A–A: die ersten drei Sekunden',
  timelineLead:
    'Jede Zeile ist eine Anfrage Ihrer Startseite. Die Schnittlinie A–A markiert den Moment, in dem das Einwilligungsbanner erscheint. Schraffiert sind Anfragen an fremde Server, die vorher starten.',
  timelineAxis: 'Anfrage',
  /** Reference: "0 s", "0,5 s", …, "3 s". */
  tick: (ms: number) => `${seconds(ms)} s`,
  cutLetter: 'A',
  /** Reference: "Einwilligungsbanner erscheint nach 1,4 s". */
  bannerAfter: (ms: number) => `Einwilligungsbanner erscheint nach ${seconds(ms)} s`,
  ownPage: 'Ihre Seite', // reference
  /** Without the types of the files (a report made before B3 part 2, or files of other types only): a draft. */
  ownFiles: 'Ihre Dateien',
  /** Reference: "Ihre Dateien: Design und Skripte", only when the files of the row are of these types (Fedor, B3 part 2). */
  ownFilesOf: (kinds: string) => `Ihre Dateien: ${kinds}`,
  consentTool: 'Einwilligungstool', // reference
  ownServer: 'Ihr Server', // reference
  /** Reference: "Google, fremder Server". */
  thirdServer: 'fremder Server',
  legendThird: 'Fremder Server',
  legendOwn: 'Ihr eigener Server',
  legendCut: 'Schnitt A–A, Banner wird sichtbar',

  /** Reference: the accessible name of the plan, before the list of the marks. */
  planLabel: 'Plan der Startseite mit Feldern A bis D und 1 bis 3.',
  planMarked: (parts: readonly string[]) => ` Rot markiert: ${parts.join(', ')}.`,

  // The last line of every report (product rule 4, reference).
  disclaimer: 'Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.',
} as const;

/**
 * States of the upper part of the report that the design does not show (session B3 part 2; every text a DRAFT,
 * docs/content-drafts.md, "Session B3 part 2", or a draft of an earlier session named there).
 */
export const STATE_DRAFTS = {
  /** The fifth fact of the head: the country the browser visited the site from (Fedor, 21.11.2026). */
  visitedFrom: 'Aufgerufen aus',
  /** "System" when the part was not checked (the page did not load). */
  systemNotChecked: 'nicht geprüft',
  /** "Geprüfte Seiten" when the homepage was not checked. */
  pagesNone: 'keine',
  /** "Ist" of "Bilder mit Beschreibung" on a page without images (Fedor, 24.11.2026). */
  noImages: 'keine Bilder',
  /** "Ist" of a row that was checked but has no value (an unsure result, or a capture of older code). */
  notDetermined: 'nicht ermittelt',
  /** The label of the notes of the report (the dashed box of the "Revisionen"). */
  noteLabel: 'Hinweis',
  quick:
    'Schnellprüfung ohne Browser: Wir haben nur den Quelltext Ihrer Startseite gelesen, so wie Ihr Server ihn ausliefert. Fremde Dienste und Barrierefreiheit sind deshalb nicht geprüft. Die vollständige Prüfung ist morgen wieder möglich.',
  blocked: (status: number | null, quick: boolean) =>
    `Ihre Website hat ${quick ? 'unsere Abfrage' : 'unseren Browser'} nicht durchgelassen${status === null ? '' : ` (Antwort ${status})`}. Deshalb zeigt der Bericht keine Funde.${quick ? ' Die vollständige Prüfung ist morgen wieder möglich.' : ''}`,
  failed: (reason: string) => `Ihre Startseite ließ sich nicht prüfen: ${reason}. Deshalb zeigt der Bericht keine Funde.`,
  notAllowed: (reason: string) => `Diese Adresse dürfen wir nicht prüfen: ${reason}. Deshalb zeigt der Bericht keine Funde.`,
  /** `report-page-almost-empty` (fix-a1, fix-a2). */
  almostEmpty:
    'Die Seite hat bei unserem Besuch fast keinen Inhalt gezeigt. Möglicherweise hat ein Schutz vor automatischen Zugriffen unsere Prüfung nicht durchgelassen. Was wir gesehen haben, kann zu diesem Schutz gehören und nicht zu Ihrer Website. Deshalb zeigen wir keine Befunde, sondern nur Punkte, die Sie bitte manuell prüfen.',
  /** `report-page-still-loading` (fix-a6). */
  stillLoading: 'Ihre Startseite lud nach 15 Sekunden noch weitere Inhalte. Der Bericht zeigt, was bis dahin geladen war; später geladene Inhalte und Dienste sind nicht enthalten.',
  /** A notice of a text id this page does not know (B2 part 3). */
  otherNotice: 'Der Bericht zeigt, was wir prüfen konnten.',
  /** `report-truncated-findings`, `report-truncated-services`, `report-truncated-page` (fix-a4). */
  truncatedFindings: (shown: number, total: number) => `Die Liste zeigt die wichtigsten ${shown} von ${total} Einträgen.`,
  truncatedServices: (shown: number, total: number) => `Die Stückliste zeigt ${shown} von ${total} Diensten.`,
  truncatedPage: {
    'homepage-text': 'Die Startseite hat mehr Text, als die Prüfung liest (100 000 Zeichen). Der Rest wurde nicht gelesen.',
    'homepage-links': 'Die Startseite hat Links, die die Prüfung nicht gelesen hat (mehr als 1 500 Links oder ungewöhnlich lange Adressen).',
    'impressum-text': 'Das Impressum hat mehr Text, als die Prüfung liest (100 000 Zeichen). Der Rest wurde nicht gelesen.',
    'impressum-links': 'Das Impressum hat Links, die die Prüfung nicht gelesen hat.',
    headers: 'Ein Header der Startseite hat einen Wert, der für die Prüfung zu lang ist. Er wurde nicht ausgewertet.',
  } as const,
  /** The heading of "Drei Dinge" with fewer than three priorities, and without any. */
  prioritiesTwo: 'Zwei Dinge sollten Sie zuerst beheben',
  prioritiesOne: 'Das sollten Sie zuerst beheben',
  prioritiesNone: 'Keine vorrangigen Punkte',
  prioritiesNoneText: 'In den geprüften Teilen hat die automatische Prüfung keinen Punkt mit Risiko gefunden.',
  /** The Zeitschnitt without the cut A–A, and without a third-party request in its window. */
  bannerNotSeen: 'Kein Einwilligungsbanner erkannt.',
  bannerLater: (seconds: string) => `Einwilligungsbanner erscheint nach ${seconds} s, nach diesem Ausschnitt.`,
  noThirdParty: 'In den ersten drei Sekunden keine Anfrage an fremde Server.',
} as const;

/**
 * The report page of a real scan without a report to show (session B3 part 2; every text a DRAFT, docs/content-drafts.md,
 * "Session B3 part 2"). Built from elements of bericht.html: the heading of a section, a paragraph and the outlined
 * link of the sheet (`.gl`, "Arbeitsauftrag für Ihren Entwickler").
 */
export const PAGE_TEXTS = {
  loading: 'Der Bericht wird geladen.',
  notReady: {
    title: 'Der Bericht ist noch nicht fertig.',
    text: 'Die Prüfung läuft noch. Auf der Seite der Prüfung sehen Sie, wie weit sie ist, und öffnen den Bericht, sobald er fertig ist.',
    action: 'Zur Prüfung',
  },
  ended: {
    cancelled: { title: 'Zu dieser Prüfung gibt es keinen Bericht.', text: 'Sie wurde aus der Warteschlange genommen, bevor sie begann.' },
    'daily-limit': { title: 'Zu dieser Prüfung gibt es keinen Bericht.', text: 'Sie konnte nicht beginnen, weil an diesem Tag alle Prüfungen vergeben waren.' },
    other: { title: 'Die Prüfung ist bei uns fehlgeschlagen.', text: 'Deshalb gibt es keinen Bericht. Bitte starten Sie eine neue Prüfung.' },
  },
  notFound: { title: 'Diesen Bericht finden wir nicht.', text: 'Der Link ist unvollständig, oder der Bericht ist nicht mehr gespeichert.' },
  error: { title: 'Den Bericht können wir gerade nicht anzeigen.', text: 'Bitte laden Sie diese Seite in einigen Minuten neu.' },
  newScan: 'Neue Prüfung', // reference
  reload: 'Neu laden', // draft of B2 part 3
} as const;

/**
 * The words for the types of the site's own files in the Zeitschnitt (session B3 part 2, Fedor's answer 1): "Design"
 * (style sheets and fonts) and "Skripte" are the reference's words, the others drafts. Each word once, in this order.
 */
export const FILE_TYPE_WORDS: readonly { word: string; types: readonly FileType[] }[] = [
  { word: 'Design', types: ['stylesheet', 'font'] },
  { word: 'Skripte', types: ['script'] },
  { word: 'Bilder', types: ['image'] },
  { word: 'Medien', types: ['media'] },
  { word: 'Daten', types: ['data'] },
  { word: 'Weiteres', types: ['other'] },
];

/** "Merkmal" of each Prüfmaß (reference). */
export const MEASURE_NAMES: Record<MeasureId, string> = {
  'third-party-before-consent': 'Fremde Dienste vor der Einwilligung',
  'impressum-fields': 'Pflichtangaben im Impressum',
  'lowest-contrast': 'Kleinster Textkontrast',
  'images-described': 'Bilder mit Beschreibung',
  'accessibility-statement': 'Erklärung zur Barrierefreiheit',
  https: 'Verschlüsselung',
  'security-headers': 'Sicherheits-Header',
};

/**
 * "Ergebnis" of a Prüfmaß: the three of the reference, and two drafts. "bitte manuell prüfen" follows product rule 3:
 * an accessibility statement the scan did not find is never "fehlt" (docs/report-schema.md, conflict 14, Fedor 23.11.2026).
 */
export const RESULT_TEXTS: Record<MeasureResult, { label: string; tone: 'bad' | 'ok' | 'mid' }> = {
  pass: { label: 'erfüllt', tone: 'ok' },
  fail: { label: 'nicht erfüllt', tone: 'bad' },
  partial: { label: 'teilweise', tone: 'mid' },
  manual: { label: 'bitte manuell prüfen', tone: 'mid' }, // draft
  'not-checked': { label: 'nicht geprüft', tone: 'mid' }, // draft
};

/** States of "Soll" and "Ist": "vorhanden" and "HTTPS" are the reference; the others are drafts. */
export const STATE_TEXTS = {
  present: 'vorhanden',
  found: 'vorhanden',
  uncertain: 'Link gefunden, bitte prüfen',
  'not-found': 'nicht gefunden',
  https: 'HTTPS',
  http: 'HTTP',
  unknown: 'unbekannt',
} as const;

export const MEASURE_VALUE_TEXTS = {
  all: 'alle', // reference
  of: (count: number, total: number) => `${count} von ${total}`, // reference
  atLeast: (ratio: string) => `mind. ${ratio} : 1`, // reference: "mind. 4,5 : 1"
  ratio: (ratio: string) => `${ratio} : 1`, // reference: "2,9 : 1"
  notChecked: 'nicht geprüft', // draft
};

/** "Datenschutz, hohes Risiko" (reference); "Pflichtangaben", "Sicherheit" and "niedriges Risiko" are drafts. */
export const AREA_TEXTS: Record<FindingArea, string> = {
  privacy: 'Datenschutz',
  'mandatory-information': 'Pflichtangaben',
  accessibility: 'Barrierefreiheit',
  security: 'Sicherheit',
};
export const RISK_TEXTS: Record<FindingRisk, string> = { high: 'hohes Risiko', medium: 'mittleres Risiko', low: 'niedriges Risiko' };

/**
 * Fills a template in one pass: each `{name}` is replaced once by its value, so a value that looks like a placeholder
 * is never filled a second time. A value of the scanned page (`page` names it) becomes a part of its own ({ page }),
 * which the page shows as a text node in <bdi>; our own values (numbers) become plain text.
 */
export function fill(template: string, values: Record<string, string | number>, page: readonly string[] = []): Phrase {
  const parts: (string | { page: string })[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{([a-zA-Z]+)\}/g)) {
    const name = m[1] as string;
    if (!(name in values)) continue;
    parts.push(template.slice(last, m.index));
    const value = values[name] as string | number;
    parts.push(page.includes(name) ? { page: String(value) } : String(value));
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(template.slice(last));
  const merged: (string | { page: string })[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    if (typeof p === 'string' && p === '') continue;
    if (typeof p === 'string' && typeof prev === 'string') merged[merged.length - 1] = prev + p;
    else merged.push(p);
  }
  return merged.length === 1 && typeof merged[0] === 'string' ? merged[0] : merged;
}

/**
 * Titles of the findings that can be among "Drei Dinge" (findings with a risk): `one` with a count of 1, `many`
 * otherwise. The contrast title and the two service titles are the reference; the others come from the drafts of
 * docs/content-drafts.md (`a11y-*`, `security-*`, `legal-impressum-no-link`), and the general service title and the
 * title of the security headers are new drafts of this session.
 */
export const TITLE_TEMPLATES: Record<string, { one: string; many: string }> = {
  'a11y-color-contrast': { one: 'Zu schwacher Kontrast an einer Stelle', many: 'Zu schwacher Kontrast an {count} Stellen' },
  'a11y-image-alt': { one: 'Ein Bild ohne Beschreibung', many: '{count} Bilder ohne Beschreibung' },
  'a11y-label': { one: 'Ein Formularfeld ohne Beschriftung', many: '{count} Formularfelder ohne Beschriftung' },
  'a11y-link-name': { one: 'Ein Link ohne Text', many: '{count} Links ohne Text' },
  'a11y-button-name': { one: 'Eine Schaltfläche ohne Text', many: '{count} Schaltflächen ohne Text' },
  'a11y-html-has-lang': { one: 'Seitensprache nicht angegeben', many: 'Seitensprache nicht angegeben' },
  'a11y-html-lang-valid': { one: 'Ungültige Seitensprache: {value}', many: 'Ungültige Seitensprache: {value}' },
  'security-https-missing': { one: 'Seite ohne HTTPS', many: 'Seite ohne HTTPS' },
  'security-http-no-redirect': { one: 'Keine Weiterleitung von http:// auf https://', many: 'Keine Weiterleitung von http:// auf https://' },
  'security-headers': { one: '{present} von {total} Sicherheits-Headern gesetzt', many: '{present} von {total} Sicherheits-Headern gesetzt' },
  'legal-impressum-no-link': { one: 'Impressum-Link nicht gefunden, bitte manuell prüfen', many: 'Impressum-Link nicht gefunden, bitte manuell prüfen' },
};

/** Titles of a third-party finding: the two of the reference by service, else the general draft. */
export const SERVICE_TITLES: Record<string, string> = {
  'google-fonts': 'Google Fonts laden vor der Einwilligung',
  'google-analytics': 'Google Analytics startet vor der Einwilligung',
};
export const SERVICE_TITLE = '{service} startet vor der Einwilligung';
/** A text id without a title here: a general title, never the id itself ("Strings of the scanned page"). */
export const GENERAL_TITLE = 'Vorrangiger Punkt';
