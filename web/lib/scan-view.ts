import type { Finding, Report } from '@website-check/scanner/report';
import type { MarkPlace, Phrase, PlotMark, ScanScreenData, ScanStep } from '../components/scan/scan-data';
import { SCAN_TEXTS as T, SYSTEM_NAMES } from './scan-texts';

// What the real scan screen shows (session B2 part 2, Fedor's answers 1 and 3): before the report no row with a
// result, no number and no mark; the frame is drawn and the time bar runs in real time. When the report is there,
// its rows light up at once, the marks of its priorities appear, then the summary and "Bericht öffnen". Every motion
// but the bar ends within 5 seconds. Pure functions of the API's answers, tested without a browser.

/** The drawing, the pen and the carriage run at this share of the reference's times: the pen stops at 4.96 s. */
export const LIVE_MOTION_SCALE = 0.68;

/**
 * Seconds after the page appeared when the marks of a report that is already there begin: as in the reference after
 * the drawing (5.3 s there, 3.6 s at the scale), a little earlier so that the panel too has risen before 5 s.
 */
export const MARKS_START = 3.4;

/** The marks of the reference after the first one starts (5.3, 5.85 and 6.4 s; numbers at 5.9, 6.35, 6.95 s). */
const MARK_TIMES = [
  { at: 0, duration: 0.6, number: 0.6 },
  { at: 0.55, duration: 0.5, number: 1.05 },
  { at: 1.1, duration: 0.5, number: 1.65 },
] as const;
/**
 * The marks of the design and the field of the plan each one stands in: bericht.html names them "Überschrift in Feld
 * B2, Quelltext am Seitenende in Feld A3, Unterzeile in Feld A2", and on the drawn page of pruefung.html (x 40 to 560,
 * y 84 to 400 below the browser bar) the same 4 × 3 grid puts the heading in B2, the subline in A2 and the code mark
 * in A3. Another field has no mark of the design.
 */
const FIELD_PLACES: Readonly<Record<string, MarkPlace>> = { B2: 'heading', A2: 'subline', A3: 'source' };
/** The language of the page is an attribute in the source; its "field" is the box of the whole page, no place. */
const PAGE_LANGUAGE = new Set(['a11y:page-language']);
/** "Bericht öffnen" rises this long after the first mark (0.4 s), so it stands before the last number is in. */
const PANEL_AFTER = 1.0;

export type LivePhase = 'loading' | 'queued' | 'running' | 'done' | 'error';

export interface LiveScanState {
  id: string;
  phase: LivePhase;
  displayHost: string | null;
  queuePosition: number | null;
  /** Running: how long the scan had run when the bar started to grow (fixed for the bar's life). */
  runningSince: number;
  report: Report | null;
  /** Done: seconds after the page appeared when the report was shown. */
  reportShownAt: number;
}

export const waitingSteps = (): ScanStep[] => T.waiting.map((title) => ({ title, delay: null }));

/** "1,4" for 1,400 ms. */
const secondsText = (ms: number): string => (Math.round(ms / 100) / 10).toFixed(1).replace('.', ',');

function parsed(href: string | null): URL | null {
  if (href === null) return null;
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** Where the Impressum is: its path on the site's own host, otherwise host and path (a string of the page). */
function impressumPlace(report: Report): string | null {
  const url = parsed(report.legal?.impressum.url ?? report.legal?.impressumLink?.href ?? null);
  if (url === null) return null;
  const own = [report.site.host, parsed(report.site.finalUrl)?.hostname];
  return own.includes(url.hostname) ? url.pathname : `${url.hostname}${url.pathname}`;
}

/** The rows of a complete report; a row whose part was not checked keeps waiting (part 3 gives it a state). */
export function reportSteps(report: Report): ScanStep[] {
  const steps = waitingSteps();
  const set = (i: number, step: Omit<ScanStep, 'delay'>): void => {
    steps[i] = { ...step, delay: 0 };
  };
  const checked = (part: keyof Report['sections']): boolean => report.sections[part].status === 'checked';

  if (report.pages.homepage === 'checked') set(0, { title: T.pageOpened, detail: T.pageOpenedDetail });

  if (checked('thirdParty')) {
    const requests = report.scan.requests ?? null;
    set(1, requests === null ? { title: T.requestsWithoutCount } : { title: T.requests(requests.total), detail: T.requestsThirdParty(requests.thirdParty) });
    const banner = report.timeline?.bannerVisibleAtMs ?? null;
    set(2, banner === null ? { title: T.bannerNotSeen } : { title: T.bannerSeen, detail: T.bannerSeenAfter(secondsText(banner)) });
    const services = report.services.filter((s) => s.severity === 'finding');
    if (services.length === 0) set(3, { title: T.servicesNone });
    else {
      const shown = services.slice(0, 3);
      const names: (string | { page: string })[] = [];
      shown.forEach((s, i) => {
        if (i > 0) names.push(', ');
        names.push(s.known ? s.name : { page: s.name });
      });
      if (services.length > shown.length) names.push(` ${T.servicesMore(services.length - shown.length)}`);
      set(3, { title: T.servicesBefore(services.length), detail: names, finding: true });
    }
  }

  if (checked('legal') && report.legal !== null) {
    const legal = report.legal;
    if (legal.impressumLink === null) set(4, { title: T.impressumNotFound, detail: T.manualCheck, finding: true });
    else {
      const place = impressumPlace(report);
      set(4, place === null ? { title: T.impressumFound } : { title: T.impressumFound, detail: [T.impressumAt, { page: place }] });
    }
    if (legal.impressum.state === 'analyzed') {
      const found = (Object.keys(T.fieldNames) as (keyof typeof T.fieldNames)[]).filter((f) => legal.fields[f].status === 'found').map((f) => T.fieldNames[f]);
      set(5, { title: T.fieldsRead, detail: found.length === 0 ? T.fieldsNone : found.join(', ') });
    }
  }

  if (checked('accessibility')) set(6, { title: T.accessibility, detail: T.accessibilityDetail });
  if (checked('security') && report.security !== null) set(7, { title: T.security });
  return steps;
}

/** A report the rows and marks can show: the complete check without a notice. Part 3 builds the others. */
export const isPlainComplete = (report: Report): boolean => report.state === 'complete' && report.notice === null;

/** The line under "Fertig. Ihr Bericht ist gezeichnet." (reference: "7 Funde, davon 3 vorrangig. Zu jedem …"). */
export function summaryOf(report: Report): Phrase {
  if (!isPlainComplete(report)) return T.summaryOther;
  const n = report.counts.findings;
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  const p = report.priorities.filter((id) => byId.get(id)?.kind === 'finding').length;
  let text = `${T.findings(n)}${n > 0 && p > 0 ? T.priorities(p) : ''}.`;
  if (report.counts.manual > 0) text += ` ${T.manual(report.counts.manual)}`;
  const system = report.platform?.system ?? 'unknown';
  const findings = report.findings.filter((f) => f.kind === 'finding');
  // Only when every finding names its instructions (B4 writes them for every system).
  if (n > 0 && system !== 'unknown' && !report.truncated.findings && findings.length === n && findings.every((f) => f.fixTextId !== null)) {
    text += ` ${T.instructions(n, SYSTEM_NAMES[system])}`;
  }
  return text;
}

/** Where a priority stands on the drawing, and why: its measured field, or the page's source code. */
export type MarkWhere = { place: MarkPlace; field: string } | { place: 'source'; field: null };

/** The host without a leading "www.": a host equal to it or below it belongs to the site itself. */
const baseHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** True when a request of the finding was made by the page's own code: the homepage or a file of the site's hosts. */
function fromPageCode(finding: Finding, report: Report): boolean {
  const own = [report.site.host, parsed(report.site.finalUrl)?.hostname].filter((h): h is string => typeof h === 'string' && h.length > 0).map(baseHost);
  return finding.evidence.some((e) => {
    if (e.type !== 'request') return false;
    const host = parsed(e.via)?.hostname.toLowerCase();
    return host !== undefined && own.some((base) => host === base || host.endsWith(`.${base}`));
  });
}

/**
 * The place of one priority on the drawing (Fedor, B2 part 3, answer 1): a mark stands only where it shows the place
 * of the finding truly. That is its measured field ("Feld"), when the design has a mark in that field; otherwise the
 * place of the drawing that is the place of the finding by its meaning: the source code, for a third party whose
 * request the page's own code made, and for the language of the page. Anything else gets no mark.
 */
export function markWhere(finding: Finding, report: Report): MarkWhere | null {
  if (PAGE_LANGUAGE.has(finding.id)) return { place: 'source', field: null };
  if (finding.field !== null) {
    const place = FIELD_PLACES[finding.field];
    return place === undefined ? null : { place, field: finding.field };
  }
  if (finding.area === 'privacy' && finding.serviceKey !== null && fromPageCode(finding, report)) return { place: 'source', field: null };
  return null;
}

/** Each priority ("Drei Dinge", numbered as in the report) with its place on the drawing, or null. */
export function priorityPlaces(report: Report): { number: number; where: MarkWhere | null }[] {
  if (report.state !== 'complete' && report.state !== 'quick') return [];
  const byId = new Map(report.findings.map((f) => [f.id, f]));
  return report.priorities.slice(0, 3).map((id, i) => {
    const finding = byId.get(id);
    return { number: i + 1, where: finding === undefined ? null : markWhere(finding, report) };
  });
}

/**
 * The marks of the priorities, one per place of the drawing (two priorities at one place share it: "1, 2"), in the
 * order of their first number, starting `base` seconds after they appear. The order of the priorities never chooses
 * a place.
 */
export function marksOf(report: Report, base: number, scale = LIVE_MOTION_SCALE): PlotMark[] {
  const byPlace = new Map<MarkPlace, number[]>();
  for (const p of priorityPlaces(report)) {
    if (p.where === null) continue;
    const list = byPlace.get(p.where.place) ?? [];
    list.push(p.number);
    byPlace.set(p.where.place, list);
  }
  return [...byPlace.entries()].map(([place, numbers], i) => {
    const t = MARK_TIMES[i]!;
    return {
      place,
      numbers,
      draw: { delay: base + t.at * scale, duration: t.duration * scale },
      numberDelay: base + t.number * scale,
    };
  });
}

/** The text description of the marks: each placed priority with its field or "im Quelltext". */
export function marksLabel(report: Report): string {
  const placed = priorityPlaces(report).filter((p): p is { number: number; where: MarkWhere } => p.where !== null);
  return T.drawingDone(placed.map((p) => T.markAt(p.number, p.where.field)));
}

export function statusOf(state: Pick<LiveScanState, 'phase' | 'queuePosition'>): string {
  switch (state.phase) {
    case 'loading':
      return '';
    case 'queued':
      return T.statusQueued(state.queuePosition);
    case 'running':
      return T.statusRunning;
    case 'done':
      return T.statusDone;
    case 'error':
      return T.statusError;
  }
}

/** The whole screen of the real scan for one state. */
export function liveScreen(state: LiveScanState): ScanScreenData {
  const base: Omit<ScanScreenData, 'steps' | 'progress' | 'marks' | 'report' | 'drawingLabel'> = {
    domain: state.displayHost,
    domainFromApi: true,
    motionScale: LIVE_MOTION_SCALE,
    status: statusOf(state),
  };
  if (state.phase !== 'done' || state.report === null) {
    return {
      ...base,
      drawingLabel: T.drawingWaiting,
      marks: [],
      steps: waitingSteps(),
      progress: { kind: 'live', phase: state.phase === 'running' ? 'running' : 'waiting', since: state.runningSince },
      report: null,
    };
  }
  const report = state.report;
  const start = Math.max(0, MARKS_START - state.reportShownAt);
  const marks = marksOf(report, start);
  return {
    ...base,
    domain: report.site.displayHost,
    drawingLabel: isPlainComplete(report) ? marksLabel(report) : T.drawingWaiting,
    marks,
    steps: isPlainComplete(report) ? reportSteps(report) : waitingSteps(),
    progress: { kind: 'live', phase: 'done', since: 0 },
    report: { summary: summaryOf(report), href: `/bericht?id=${state.id}`, delay: start + (marks.length > 0 ? PANEL_AFTER : 0) },
  };
}
