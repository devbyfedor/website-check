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
  FIX_SYSTEMS,
  FIX_TEXTS,
  secondsText,
  THIRD_PARTY_HAPPENS,
  THIRD_PARTY_TARGET,
  THIRD_PARTY_WHY,
  type FixSystem,
} from './report-detail-texts';
import { decimal, fill, lookup } from './report-texts';
import { findingTitle, measured, measureRows, ratioText, REPORT_TIME_ZONE } from './report-view';
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
  tag: { text: string; tone: 'bad' | 'ok' | 'mid' };
}

/** The rows of the Stückliste, in the order of `services` (its `position`). */
export const serviceRows = (report: Report): ServiceRow[] =>
  report.services.map((s) => ({
    position: s.position,
    name: s.known ? s.name : [{ page: s.name }],
    small: CATEGORY_WORDS[s.category],
    provider: s.provider ?? T.providerUnknown,
    data: DATA_LOCATION_TEXTS[s.dataLocation],
    starts: T.startsBeforeConsent,
    tag: CONSENT_TAGS[s.consent],
  }));

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
    }
  | { kind: 'general'; steps: readonly string[] };

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
  fix: FixView | null;
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
      ? THIRD_PARTY_HAPPENS.requests(countWords(count, 'Anfrage', 'Anfragen'), provider, seconds)
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
    const after = f.params.beforeBanner === true ? THIRD_PARTY_TARGET.beforeBanner : THIRD_PARTY_TARGET.noConsent;
    return { target: THIRD_PARTY_TARGET.target(provider), actual: `${THIRD_PARTY_TARGET.requests(count)}${after}`, bad: true };
  }
  const id = lookup(MEASURE_OF, f.textId);
  const row = id === undefined ? undefined : measureRows(report).find((r) => r.id === id);
  return row === undefined ? null : { target: row.target, actual: row.actual, bad: row.bad };
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

function fixView(f: Finding, report: Report): FixView | null {
  const general = lookup(FINDING_TEXTS, f.textId)?.fix ?? null;
  const bySystem = f.fixTextId === null ? undefined : lookup(FIX_TEXTS, f.fixTextId);
  if (bySystem !== undefined) {
    const steps = Object.fromEntries(FIX_SYSTEMS.map((s) => [s, bySystem[s] ?? null])) as Record<FixSystem, readonly string[] | null>;
    const detected = detectedSystem(report);
    return { kind: 'systems', steps, detected, selected: detected ?? FIX_SYSTEMS[0], general };
  }
  return general === null ? null : { kind: 'general', steps: general };
}

/** One card per priority of "Drei Dinge" (at most three), numbered as there. */
export function findingCards(report: Report): FindingCard[] {
  if (!measured(report)) return [];
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  return report.priorities.slice(0, 3).flatMap((id, i) => {
    const f = byId.get(id);
    if (f === undefined) return [];
    const thirdParty = f.area === 'privacy' && f.serviceKey !== null && f.textId.startsWith('third-party-');
    return [
      {
        number: i + 1,
        id: `fund-${i + 1}`,
        title: findingTitle(f),
        field: f.field,
        happens: thirdParty ? thirdPartyHappens(f) : otherHappens(f),
        targetActual: targetActual(f, report),
        why: thirdParty ? (lookup(THIRD_PARTY_WHY, f.textId) ?? null) : (lookup(FINDING_TEXTS, f.textId)?.why ?? null),
        source: thirdParty ? sourceAddresses(f, report) : [],
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
