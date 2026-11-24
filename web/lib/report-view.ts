// What the upper part of the report page shows (session B3 part 1: head, Prüfmaße, "Drei Dinge" with the plan,
// Zeitschnitt A–A), as pure functions of a report that passed `validateReport`. Tested without a browser
// (web/test/report-view.test.ts). The states the design does not show (another state than `complete`, no banner,
// fewer than three priorities, the country of the visit) are B3 part 2.

import type { Finding, Measure, MeasureValue, Report, TimelineRow } from '@website-check/scanner/report';
import type { MarkPlace, Phrase } from '../components/scan/scan-data';
import {
  AREA_TEXTS,
  decimal,
  fill,
  GENERAL_TITLE,
  MEASURE_NAMES,
  MEASURE_VALUE_TEXTS as V,
  REPORT_TEXTS as T,
  RESULT_TEXTS,
  RISK_TEXTS,
  SERVICE_TITLE,
  SERVICE_TITLES,
  STATE_TEXTS,
  TITLE_TEMPLATES,
} from './report-texts';
import { SYSTEM_NAMES } from './scan-texts';
import { priorityPlaces } from './scan-view';

export const REPORT_TIME_ZONE = 'Europe/Berlin';

// ---------------------------------------------------------------------------------------------
// Head

export interface HeadFact {
  label: string;
  value: string;
}

/** "19. November 2026, 18:42 Uhr" in Berlin, from `scan.scannedAt` (UTC). */
export function scannedAtText(iso: string, timeZone = REPORT_TIME_ZONE): string {
  const at = new Date(iso);
  const date = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(at);
  const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at);
  return T.dateTime(date, time);
}

export function systemText(platform: Report['platform']): string {
  if (platform === null || platform.system === 'unknown') return T.systemUnknown;
  const name = platform.system === 'shopware' && platform.shopwareVersion !== null ? `Shopware ${platform.shopwareVersion}` : SYSTEM_NAMES[platform.system];
  return platform.system === 'wordpress' && platform.woocommerce ? T.withWoocommerce(name) : name;
}

/** The four facts under the heading, in the order of the reference. */
export function headFacts(report: Report, timeZone = REPORT_TIME_ZONE): HeadFact[] {
  const facts: HeadFact[] = [];
  if (report.scan.scannedAt !== null) facts.push({ label: T.scannedAt, value: scannedAtText(report.scan.scannedAt, timeZone) });
  facts.push({ label: T.system, value: systemText(report.platform) });
  facts.push({ label: T.pages, value: report.pages.impressum === 'checked' ? T.pagesBoth : T.pagesHomepage });
  facts.push({ label: T.revision, value: T.revisionInitial(report.revision.letter) });
  return facts;
}

// ---------------------------------------------------------------------------------------------
// Prüfmaße

export interface MeasureRow {
  id: Measure['id'];
  name: string;
  target: string;
  actual: string;
  /** The "Ist" value in red: the row is not met. */
  bad: boolean;
  result: { label: string; tone: 'bad' | 'ok' | 'mid' };
}

/**
 * A contrast ratio with one decimal, rounded down: a failing 4.47 : 1 never reads as the required 4,5 : 1.
 * (The scaled value is rounded to 9 places first, so 2.9 stays 2,9.)
 */
export const ratioText = (ratio: number): string => decimal(Math.floor(Math.round(ratio * 1e9) / 1e8) / 10);

function valueText(value: MeasureValue | null, role: 'target' | 'actual'): string {
  if (value === null) return V.notChecked;
  switch (value.type) {
    case 'count':
      return String(value.count);
    case 'of':
      return V.of(value.count, value.total);
    case 'ratio':
      return role === 'target' ? V.atLeast(decimal(value.ratio)) : V.ratio(ratioText(value.ratio));
    case 'all':
      return V.all;
    case 'state':
      return STATE_TEXTS[value.state];
  }
}

export const measureRows = (report: Report): MeasureRow[] =>
  report.measures.map((m) => ({
    id: m.id,
    name: MEASURE_NAMES[m.id],
    target: valueText(m.target, 'target'),
    actual: valueText(m.actual, 'actual'),
    bad: m.result === 'fail',
    result: RESULT_TEXTS[m.result],
  }));

// ---------------------------------------------------------------------------------------------
// "Drei Dinge" and the plan

/** The title of a finding: its text id with its parameters; values of the page stay parts of their own. */
export function findingTitle(finding: Finding): Phrase {
  const p = finding.params;
  if (finding.area === 'privacy' && finding.serviceKey !== null && finding.textId.startsWith('third-party-')) {
    const own = SERVICE_TITLES[finding.serviceKey];
    if (own !== undefined) return own;
    return typeof p.service === 'string' ? fill(SERVICE_TITLE, { service: p.service }, ['service']) : GENERAL_TITLE;
  }
  const template = TITLE_TEMPLATES[finding.textId];
  if (template === undefined) return GENERAL_TITLE;
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' || typeof v === 'number') values[k] = v;
  const count = typeof p.count === 'number' ? p.count : null;
  const text = count === 1 ? template.one : template.many;
  // A template with a placeholder the report does not fill gets the general title, never a "{name}".
  for (const m of text.matchAll(/\{([a-zA-Z]+)\}/g)) if (!((m[1] as string) in values)) return GENERAL_TITLE;
  return fill(text, values, ['value', 'service']);
}

export interface PriorityItem {
  number: number;
  title: Phrase;
  /** "Datenschutz, hohes Risiko". */
  meta: string;
  /** "Feld B2", only when the report names the field (Fedor, B3 part 1, answer 3). */
  field: string | null;
  href: string;
}

export function priorityItems(report: Report): PriorityItem[] {
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  return report.priorities.slice(0, 3).flatMap((id, i) => {
    const f = byId.get(id);
    if (f === undefined) return [];
    const meta = f.risk === null ? AREA_TEXTS[f.area] : `${AREA_TEXTS[f.area]}, ${RISK_TEXTS[f.risk]}`;
    return [{ number: i + 1, title: findingTitle(f), meta, field: f.field === null ? null : T.field(f.field), href: `#fund-${i + 1}` }];
  });
}

/** The names of the marks of the design, for the accessible name of the plan (reference). */
const PLACE_NAMES: Record<MarkPlace, string> = { heading: 'Überschrift', source: 'Quelltext am Seitenende', subline: 'Unterzeile' };

export interface PlanMark {
  place: MarkPlace;
  /** "1", or "1, 2" when two priorities share the place. */
  text: string;
}

/**
 * The red marks of the plan: the same places as on the scan screen (Fedor, B2 part 3, answer 1, and B3 part 1, answer
 * 3): a mark only where the design has one (the heading in B2, the subline in A2, the source code in A3, or the source
 * code by meaning); another field is shown only by its "Feld" caption in the list.
 */
export function planMarks(report: Report): PlanMark[] {
  const byPlace = new Map<MarkPlace, number[]>();
  for (const p of priorityPlaces(report)) {
    if (p.where === null) continue;
    byPlace.set(p.where.place, [...(byPlace.get(p.where.place) ?? []), p.number]);
  }
  return [...byPlace.entries()].map(([place, numbers]) => ({ place, text: numbers.join(', ') }));
}

/** "Plan der Startseite mit Feldern A bis D und 1 bis 3. Rot markiert: Überschrift in Feld B2, …" */
export function planLabel(report: Report): string {
  const named = new Set<string>();
  for (const p of priorityPlaces(report)) {
    if (p.where === null) continue;
    named.add(p.where.field === null ? PLACE_NAMES[p.where.place] : `${PLACE_NAMES[p.where.place]} in Feld ${p.where.field}`);
  }
  return named.size === 0 ? T.planLabel : T.planLabel + T.planMarked([...named]);
}

// ---------------------------------------------------------------------------------------------
// Zeitschnitt A–A

/** A percentage of the window for CSS, with at most 4 decimals ("46.6667%"), as the reference writes it. */
export const percentOf = (ms: number, windowMs: number): string => `${Math.round((ms / windowMs) * 100 * 1e4) / 1e4}%`;

export interface TimelineRowView {
  label: Phrase;
  small: Phrase;
  party: TimelineRow['party'];
  left: string;
  width: string;
}

export interface TimelineTick {
  text: string;
  /** null for the first (left edge) and the last (right edge) tick. */
  left: string | null;
  edge: 'start' | 'end' | null;
}

export interface TimelineView {
  rows: TimelineRowView[];
  ticks: TimelineTick[];
  cut: { left: string; text: string } | null;
}

/**
 * Tick labels every 0.5 s. A label closer than this to the cut A–A is left out, so it never meets the cut's letter
 * box (26 px wide) on the narrowest track (470 px at 390 px width): the reference leaves out "1,5 s" next to the cut
 * at 1,4 s.
 */
export const TICK_CLEARANCE_MS = 200;

// `provider` comes from our rules data (known services only; docs/report-schema.md does not list it among the strings of
// the page), so "Google, fremder Server" is one text, as in the reference; the host is a string of the page (<bdi>).
function rowView(row: TimelineRow, windowMs: number): TimelineRowView {
  const start = Math.min(Math.max(row.startMs, 0), windowMs);
  // A request still open at the end (endMs null) or after the window runs to its edge.
  const end = Math.min(row.endMs ?? windowMs, windowMs);
  const own = row.party === 'own';
  let label: Phrase = [{ page: row.label }];
  let small: Phrase;
  if (row.kind === 'consent-tool') {
    if (own) label = T.consentTool;
    small = own ? T.ownServer : row.provider === null ? T.thirdServer : `${row.provider}, ${T.thirdServer}`;
  } else if (own) {
    small = row.kind === 'document' ? T.ownPage : T.ownFiles;
  } else {
    small = row.provider === null ? T.thirdServer : `${row.provider}, ${T.thirdServer}`;
  }
  return { label, small, party: row.party, left: percentOf(start, windowMs), width: percentOf(Math.max(0, end - start), windowMs) };
}

export function timelineView(report: Report): TimelineView | null {
  const t = report.timeline;
  if (t === null) return null;
  const banner = t.bannerVisibleAtMs !== null && t.bannerVisibleAtMs <= t.windowMs ? t.bannerVisibleAtMs : null;
  const ticks: TimelineTick[] = [];
  for (let ms = 0; ms <= t.windowMs; ms += 500) {
    if (banner !== null && Math.abs(ms - banner) < TICK_CLEARANCE_MS) continue;
    const edge = ms === 0 ? 'start' : ms === t.windowMs ? 'end' : null;
    ticks.push({ text: T.tick(ms), left: edge === null ? percentOf(ms, t.windowMs) : null, edge });
  }
  return {
    rows: t.rows.map((r) => rowView(r, t.windowMs)),
    ticks,
    cut: banner === null ? null : { left: percentOf(banner, t.windowMs), text: T.bannerAfter(banner) },
  };
}
