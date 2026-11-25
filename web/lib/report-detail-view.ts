// What the lower part of the report page shows (session B4 part 1: the Stückliste, the finding details with the system
// tabs, the title block), as pure functions of a report that passed `validateReport`. Tested without a browser
// (web/test/report-detail.test.tsx). Texts: web/lib/report-detail-texts.ts.

import type { Finding, MeasureId, Report } from '@website-check/scanner/report';
import type { Phrase } from '../components/scan/scan-data';
import {
  CATEGORY_WORDS,
  CONSENT_TAGS,
  countWords,
  DATA_LOCATION_TEXTS,
  DETAIL_TEXTS as T,
  FINDING_TEXTS,
  FIX_SYSTEM_NAMES,
  FIX_SYSTEMS,
  FIX_TEXTS,
  HELP_TASKS,
  secondsText,
  THIRD_PARTY_HAPPENS,
  THIRD_PARTY_TARGET,
  THIRD_PARTY_WHY,
  type FixSystem,
} from './report-detail-texts';
import { decimal, fill, lookup } from './report-texts';
import { countryName, findingTitle, measured, measureRows, ratioText, REPORT_TIME_ZONE } from './report-view';
import { documentOf } from './scan-view';

// ---------------------------------------------------------------------------------------------
// Stückliste

export interface ServiceRow {
  position: number;
  /** Our name of a known service; the name of an unknown one is a string of the page. */
  name: Phrase;
  small: string;
  provider: string;
  data: string;
  starts: string;
  /** "Land des Aufrufs: …" under "vor der Einwilligung", for a service whose finding has `beforeConsent` (B4 part 2). */
  country: string | null;
  tag: { text: string; tone: 'bad' | 'ok' | 'mid' };
}

/** The lower part (Stückliste, finding details, help block) only for a report whose homepage was checked (B3 part 2). */
export const showsLowerPart = (report: Report): boolean => report.pages.homepage === 'checked';

/**
 * The country of the visit, named next to every finding about data sent before consent (Fedor, 21.11.2026): the line,
 * or null for a hint or a manual check (a public CDN, an almost empty page), a finding that sent nothing before consent
 * or a report without a country.
 */
function countryLine(f: Finding | undefined, report: Report): string | null {
  if (f === undefined || f.kind !== 'finding' || !f.beforeConsent || report.visit.country === null) return null;
  const name = countryName(report.visit.country);
  return name === null ? null : T.countryLine(name);
}

/** The rows of the Stückliste, in the order of `services` (its `position`). */
export function serviceRows(report: Report): ServiceRow[] {
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  return report.services.map((s) => ({
    position: s.position,
    name: s.known ? s.name : [{ page: s.name }],
    small: CATEGORY_WORDS[s.category],
    provider: s.provider ?? T.providerUnknown,
    data: DATA_LOCATION_TEXTS[s.dataLocation],
    starts: T.startsBeforeConsent,
    country: s.findingId === null ? null : countryLine(byId.get(s.findingId), report),
    tag: CONSENT_TAGS[s.consent],
  }));
}

/** Bidirectional and other control characters of a string of the page, which plain text would act on. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const plain = (v: string): string => v.replace(CONTROLS, '');

/**
 * The text "Liste für die Datenschutzerklärung kopieren" puts on the clipboard, in the form of the reference's
 * script: "Externe Dienste auf {domain} (Prüfung vom {Datum}):", then one line per row of the Stückliste,
 * "{Pos.}. {Dienst} ({Anbieter}), {small line}", without the provider when it is the name itself ("5. jsDelivr,
 * Skripte") or unknown. Plain text: strings of the page lose their control characters; every line after the first
 * starts with its number or "…", so no line can start a formula when it is pasted into a spreadsheet.
 */
export function copyListText(report: Report, timeZone = REPORT_TIME_ZONE): string {
  const lines = [T.copyHeading(plain(report.site.displayHost), shortDate(report.scan.scannedAt ?? report.createdAt, timeZone))];
  for (const s of report.services) {
    const name = plain(s.name);
    const provider = s.provider === null ? null : plain(s.provider);
    const by = provider === null || provider === '' || provider.toLowerCase() === name.toLowerCase() ? '' : ` (${provider})`;
    lines.push(`${s.position}. ${name}${by}, ${CATEGORY_WORDS[s.category]}`);
  }
  const rest = report.truncated.services ? report.counts.services - report.services.length : 0;
  if (rest > 0) lines.push(T.copyMore(rest));
  return lines.join('\n');
}

/** The help block: what it offers, by the priorities shown in "Drei Dinge" (session B4 part 2). */
export function helpView(report: Report): { heading: string; text: string } {
  if (!measured(report) || report.priorities.length === 0) return { heading: T.helpHeadingNone, text: T.helpTextNone };
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const tasks: string[] = [];
  for (const id of report.priorities.slice(0, 3)) {
    const f = byId.get(id);
    if (f === undefined) continue;
    const task =
      f.area === 'privacy' && f.textId.startsWith('third-party-') ? (f.params.category === 'fonts' ? HELP_TASKS.fonts : HELP_TASKS.consent)
      : f.area === 'accessibility' ? HELP_TASKS.barriers
      : f.textId === 'security-https-missing' || f.textId === 'security-http-no-redirect' ? HELP_TASKS.https
      : f.textId === 'security-headers' ? HELP_TASKS.headers
      : f.textId === 'legal-impressum-no-link' ? HELP_TASKS.impressum
      : null;
    if (task !== null && !tasks.includes(task)) tasks.push(task);
  }
  return { heading: T.helpHeading, text: T.helpText(tasks) };
}

// ---------------------------------------------------------------------------------------------
// The finding details ("fund-1" of the reference: one card per priority, so that every link of "Drei Dinge" leads to
// its card)

export type FixView =
  | {
      kind: 'systems';
      /** The steps of each system; null where our texts have none for that system. */
      steps: Record<FixSystem, readonly string[] | null>;
      /** The system of the site, when the scan recognised one of the five ("erkannt"). */
      detected: FixSystem | null;
      /** The tab selected on load: the detected system, else the first. */
      selected: FixSystem;
      /** The steps without a system, for a tab without its own (null when there are none). */
      general: readonly string[] | null;
      /** The name of each system in the line of a tab without steps ("Shopware 5" for a detected Shopware 5). */
      names: Record<FixSystem, string>;
    }
  | { kind: 'general'; steps: readonly string[] }
  /** No fix text yet (session B4 part 2): the box says so; the texts are a session of their own after B4. */
  | { kind: 'missing' };

export interface FindingCard {
  number: number;
  /** "fund-1": the anchor of the link in "Drei Dinge". */
  id: string;
  title: Phrase;
  field: string | null;
  happens: Phrase | null;
  targetActual: { target: string; actual: string; bad: boolean } | null;
  why: string | null;
  /** "Gefunden im Quelltext": the addresses of the requests that stand in the source of the homepage (strings of the page). */
  source: string[];
  /** "Land des Aufrufs: …" for a finding about data sent before consent (B4 part 2). */
  country: string | null;
  fix: FixView;
}

const THIRD_PARTY_FILES = new Set(['third-party-precedent']);
const THIRD_PARTY_REQUESTS = new Set(['third-party-consent-required', 'third-party-usually-consent']);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** "Ihre Startseite lädt zwei Dateien direkt von Google-Servern, 0,3 Sekunden nach dem Aufruf. Google erhält …" */
function thirdPartyHappens(f: Finding): string | null {
  const count = num(f.params.count);
  const first = num(f.params.firstStartMs);
  const provider = str(f.params.provider);
  if (count === null || count < 1 || first === null || provider === null || !f.beforeConsent) return null;
  const seconds = secondsText(first);
  const fact = THIRD_PARTY_FILES.has(f.textId)
    ? THIRD_PARTY_HAPPENS.files(countWords(count, 'Datei', 'Dateien'), provider, seconds)
    : THIRD_PARTY_REQUESTS.has(f.textId)
      ? count === 1
        ? THIRD_PARTY_HAPPENS.request(provider, seconds)
        : THIRD_PARTY_HAPPENS.requests(countWords(count, 'Anfrage', 'Anfragen'), provider, seconds)
      : null;
  if (fact === null) return null;
  const consent = f.params.beforeBanner === true ? THIRD_PARTY_HAPPENS.beforeBanner(provider) : THIRD_PARTY_HAPPENS.noConsent(provider);
  return `${fact} ${consent}`;
}

/** "4.5:1" of the report as the design writes it: "4,5 : 1". Null for another form. */
function expectedText(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{1,2}(?:\.\d{1,2})?):1$/.exec(v) : null;
  return m === null ? null : `${decimal(Number(m[1]))} : 1`;
}

/** "Was passiert" of the other findings: the draft with its values, or null when a value it names is missing. */
function otherHappens(f: Finding): Phrase | null {
  const t = lookup(FINDING_TEXTS, f.textId);
  if (t === undefined) return null;
  const values: Record<string, string | number> = {};
  const count = num(f.params.count);
  if (count !== null) values.count = count;
  const ratio = num(f.params.ratio);
  if (ratio !== null) values.ratio = `${ratioText(ratio)} : 1`;
  const expected = expectedText(f.params.expected);
  if (expected !== null) values.expected = expected;
  const value = str(f.params.value);
  if (value !== null) values.value = value;
  const template = count === 1 && t.happensOne !== undefined ? t.happensOne : t.happens;
  for (const m of template.matchAll(/\{([a-zA-Z]+)\}/g)) if (!((m[1] as string) in values)) return null;
  return fill(template, values, ['value']);
}

/** The Prüfmaß that measures the same thing as a finding: its Soll and Ist stand in the card too. */
const MEASURE_OF: Record<string, MeasureId> = {
  'a11y-color-contrast': 'lowest-contrast',
  'a11y-image-alt': 'images-described',
  'security-https-missing': 'https',
  'security-headers': 'security-headers',
};

function targetActual(f: Finding, report: Report): FindingCard['targetActual'] {
  if (f.area === 'privacy' && (THIRD_PARTY_FILES.has(f.textId) || THIRD_PARTY_REQUESTS.has(f.textId))) {
    const provider = str(f.params.provider);
    const count = num(f.params.count);
    if (provider === null || count === null || !f.beforeConsent) return null;
    // `beforeBanner` says it of the first request (review of B4 part 1): "vor dem Banner" for all of them only when the
    // report keeps every request of the count and each one started before the banner.
    const requests = f.evidence.filter((e) => e.type === 'request');
    const all = requests.length === count && requests.every((e) => e.beforeBanner === true);
    const after = f.params.beforeBanner !== true ? THIRD_PARTY_TARGET.noConsent : all ? THIRD_PARTY_TARGET.beforeBanner : THIRD_PARTY_TARGET.firstBeforeBanner;
    return { target: THIRD_PARTY_TARGET.target(provider), actual: `${THIRD_PARTY_TARGET.requests(count)}${after}`, bad: true };
  }
  // A ratio stays on one line in the narrow box ("4,5 : 1"); the table of the Prüfmaße does not wrap its values at all.
  const keep = (v: string) => v.replace(/ : /g, ' : ');
  // The contrast card names the values of its own text ("2,9 : 1 statt mindestens 3 : 1" for large text), not the 4,5 : 1
  // of the Prüfmaß (review of B4 part 1).
  if (f.textId === 'a11y-color-contrast') {
    const ratio = num(f.params.ratio);
    const expected = expectedText(f.params.expected);
    if (ratio !== null && expected !== null) return { target: keep(`mind. ${expected}`), actual: keep(`${ratioText(ratio)} : 1`), bad: true };
  }
  const id = lookup(MEASURE_OF, f.textId);
  const row = id === undefined ? undefined : measureRows(report).find((r) => r.id === id);
  return row === undefined ? null : { target: keep(row.target), actual: keep(row.actual), bad: row.bad };
}

/** The addresses of the finding's requests that the HTML parser found in the homepage itself (B3 part 2), each once. */
export function sourceAddresses(f: Finding, report: Report): string[] {
  const page = documentOf(report.site.finalUrl);
  if (page === null) return [];
  const out: string[] = [];
  for (const e of f.evidence) {
    if (e.type === 'request' && e.initiatorType === 'parser' && documentOf(e.via) === page && !out.includes(e.url)) out.push(e.url);
  }
  return out;
}

/** The system of the site among the five tabs, when the scan recognised it. */
export function detectedSystem(report: Report): FixSystem | null {
  if (report.sections.platform.status !== 'checked' || report.platform === null) return null;
  const s = report.platform.system;
  return (FIX_SYSTEMS as readonly string[]).includes(s) ? (s as FixSystem) : null;
}

function fixView(f: Finding, report: Report): FixView {
  const general = lookup(FINDING_TEXTS, f.textId)?.fix ?? null;
  const bySystem = f.fixTextId === null ? undefined : lookup(FIX_TEXTS, f.fixTextId);
  if (bySystem !== undefined) {
    const steps = Object.fromEntries(FIX_SYSTEMS.map((s) => [s, bySystem[s] ?? null])) as Record<FixSystem, readonly string[] | null>;
    const names = { ...FIX_SYSTEM_NAMES };
    const detected = detectedSystem(report);
    // The Shopware steps are for Shopware 6 (the reference: "In Shopware 6 bindet das Theme die Schriften ein."); a
    // detected Shopware 5 gets none of them (review of B4 part 1).
    if (detected === 'shopware' && report.platform?.shopwareVersion === 5) {
      steps.shopware = null;
      names.shopware = 'Shopware 5';
    }
    return { kind: 'systems', steps, detected, selected: detected ?? FIX_SYSTEMS[0], general, names };
  }
  return general === null ? { kind: 'missing' } : { kind: 'general', steps: general };
}

/** One card per priority of "Drei Dinge" (at most three), numbered as there. */
export function findingCards(report: Report): FindingCard[] {
  if (!measured(report)) return [];
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  return report.priorities.slice(0, 3).flatMap((id, i) => {
    const f = byId.get(id);
    if (f === undefined) return [];
    const thirdParty = f.area === 'privacy' && f.serviceKey !== null && f.textId.startsWith('third-party-');
    const happens = thirdParty ? thirdPartyHappens(f) : otherHappens(f);
    const ta = targetActual(f, report);
    const why = thirdParty ? (lookup(THIRD_PARTY_WHY, f.textId) ?? null) : (lookup(FINDING_TEXTS, f.textId)?.why ?? null);
    const source = thirdParty ? sourceAddresses(f, report) : [];
    // A card is never empty (Fedor, B4 part 2): without any text or value it says that the scan found the point.
    const empty = happens === null && ta === null && why === null && source.length === 0;
    return [
      {
        number: i + 1,
        id: `fund-${i + 1}`,
        title: findingTitle(f),
        field: f.field,
        happens: empty ? T.factOnly : happens,
        targetActual: ta,
        why,
        source,
        country: countryLine(f, report),
        fix: fixView(f, report),
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Title block

/** "19.11.2026" in Berlin. */
export function shortDate(iso: string, timeZone = REPORT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(new Date(iso));
}

export interface StampCell {
  label: string;
  value: Phrase;
}

/** "Benennung Prüfbericht", "Objekt" (the domain, a string of the visitor), "Datum", "Revision", "Blatt", "Geprüft". */
export function titleBlock(report: Report, timeZone = REPORT_TIME_ZONE): StampCell[] {
  return [
    { label: T.stampName, value: T.stampNameValue },
    { label: T.stampObject, value: [{ page: report.site.displayHost }] },
    // The date of the check; a check whose homepage did not load has no `scannedAt`, then the date it was started.
    { label: T.stampDate, value: shortDate(report.scan.scannedAt ?? report.createdAt, timeZone) },
    { label: T.stampRevision, value: report.revision.letter },
    { label: T.stampSheet, value: T.stampSheetValue },
    { label: T.stampChecked, value: T.stampCheckedValue },
  ];
}
