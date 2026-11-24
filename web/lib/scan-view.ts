import type { Finding, Report } from '@website-check/scanner/report';
import type { MarkPlace, Phrase, PlotMark, ScanScreenData, ScanStep } from '../components/scan/scan-data';
import { nextUtcDay, SCAN_TEXTS as T, SYSTEM_NAMES, whenText } from './scan-texts';

// What the real scan screen shows (session B2 part 2, Fedor's answers 1 and 3; the states without design of part 3): before the report no row with a
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

/**
 * Why a scan ended without a report (session B2 part 3): its last visitor cancelled it, the day's cap of the service
 * was reached at its start, our own error, an id the API does not know (or a broken link), a report that could not
 * be read.
 */
export type EndReason = 'cancelled' | 'daily-limit' | 'other' | 'unknown' | 'unreadable';

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
  /** Error: why the scan ended without a report. */
  ended?: EndReason | null;
  /** Error: when the page learned it (ms since 1970), for the time of the next scan after the day's cap. */
  endedAt?: number;
  /** Several status requests in a row got no answer; the page keeps asking (session B2 part 3). */
  offline?: boolean;
  /** The example pages only: the time zone of their texts, so building and running give the same text. */
  timeZone?: string;
}

export const waitingSteps = (): ScanStep[] => T.waiting.map((title) => ({ title, delay: null }));

/** Every row of a scan that ended without a report: lit, no tick, "nicht geprüft". */
const uncheckedSteps = (): ScanStep[] => T.waiting.map((title) => ({ title, detail: T.notChecked(null), unchecked: true, delay: 0 }));

/** The host without a leading "www.": a host equal to it or below it belongs to the site itself. */
const baseHost = (host: string): string => host.toLowerCase().replace(/^www\./, '');

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

/**
 * Where the Impressum is: its path and query on the site's own host (with or without "www."), otherwise host, path and
 * query (a string of the page).
 */
function impressumPlace(report: Report): string | null {
  const url = parsed(report.legal?.impressum.url ?? report.legal?.impressumLink?.href ?? null);
  if (url === null) return null;
  const own = [report.site.host, parsed(report.site.finalUrl)?.hostname].filter((h): h is string => typeof h === 'string').map((h) => baseHost(h));
  const path = `${url.pathname}${url.search}`;
  return own.includes(baseHost(url.hostname)) ? path : `${url.hostname}${path}`;
}

/** "Google Fonts, Google Tag Manager, Google Analytics", after three "und 2 weitere"; unknown names are strings of the page. */
function serviceNames(services: readonly Report['services'][number][]): Phrase {
  const shown = services.slice(0, 3);
  const names: (string | { page: string })[] = [];
  shown.forEach((s, i) => {
    if (i > 0) names.push(', ');
    names.push(s.known ? s.name : { page: s.name });
  });
  if (services.length > shown.length) names.push(` ${T.servicesMore(services.length - shown.length)}`);
  return names;
}

/** The first row for a report whose homepage was not checked: blocked, refused or failed, with the reason. */
function notLoadedRow(report: Report): Omit<ScanStep, 'delay'> {
  if (report.state === 'blocked') return { title: T.blockedPage, detail: T.blockedPageDetail(report.failure?.status ?? null, report.scan.mode === 'quick'), unchecked: true };
  if (report.state === 'not-allowed') {
    const rejection = typeof report.notice?.params.rejection === 'string' ? report.notice.params.rejection : 'other';
    return { title: T.notAllowedPage, detail: T.notAllowedReason[rejection] ?? T.notAllowedReason.other!, unchecked: true };
  }
  const reason = report.failure?.reason ?? 'other';
  const detail = reason === 'http-error' ? T.failedHttp(report.failure?.status ?? null) : (T.failedReason[reason] ?? T.failedReason.other!);
  return { title: T.failedPage, detail, unchecked: true };
}

/**
 * The rows of a report (sessions B2 part 2 and 3): every row lights at once. A part the report checked shows its
 * result; a part it did not check says so ("nicht geprüft", with the reason when there is one), without a tick.
 */
export function reportSteps(report: Report): ScanStep[] {
  const why = report.state === 'quick' ? T.whyQuick : null;
  const steps: ScanStep[] = T.waiting.map((title) => ({ title, detail: T.notChecked(why), unchecked: true, delay: 0 }));
  const set = (i: number, step: Omit<ScanStep, 'delay'>): void => {
    steps[i] = { ...step, delay: 0 };
  };
  const checked = (part: keyof Report['sections']): boolean => report.sections[part].status === 'checked';
  const byId = new Map(report.findings.map((f) => [f.id, f]));

  if (report.pages.homepage !== 'checked') set(0, notLoadedRow(report));
  else if (report.state === 'quick') set(0, { title: T.quickPage, detail: T.quickPageDetail });
  else set(0, { title: T.pageOpened, detail: T.pageOpenedDetail });

  if (checked('thirdParty')) {
    const requests = report.scan.requests ?? null;
    set(1, requests === null ? { title: T.requestsWithoutCount } : { title: T.requests(requests.total), detail: T.requestsThirdParty(requests.thirdParty) });
    const banner = report.timeline?.bannerVisibleAtMs ?? null;
    set(2, banner === null ? { title: T.bannerNotSeen } : { title: T.bannerSeen, detail: T.bannerSeenAfter(secondsText(banner)) });
    // A service is a finding when the report lists it as one (or, cut from a long list of findings, by its tag "fehlt");
    // on an almost empty page they are "manuell prüfen".
    const isFinding = (s: Report['services'][number]): boolean => {
      if (s.findingId === null) return false;
      const finding = byId.get(s.findingId);
      return finding === undefined ? report.truncated.findings && s.consent === 'missing' : finding.kind === 'finding';
    };
    const findings = report.services.filter(isFinding);
    const manual = report.services.filter((s) => s.consent === 'manual');
    if (findings.length > 0) set(3, { title: T.servicesBefore(findings.length), detail: serviceNames(findings), finding: true });
    else if (manual.length > 0) set(3, { title: T.servicesManual(manual.length), detail: serviceNames(manual) });
    else set(3, { title: T.servicesNone });
  }

  if (checked('legal') && report.legal !== null) {
    const legal = report.legal;
    const impressum = legal.impressum.state;
    if (legal.impressumLink === null) {
      // Red with a risk (no Impressum link on a page that loaded); without a risk (quick check, almost empty page) a tick.
      const risky = report.findings.some((f) => f.textId === 'legal-impressum-no-link' && f.risk !== null);
      set(4, { title: T.impressumNotFound, detail: T.manualCheck, ...(risky ? { finding: true } : {}) });
    } else if (impressum === 'same-page') set(4, { title: T.impressumSamePage, detail: T.impressumSamePageDetail });
    else {
      const place = impressumPlace(report);
      const where: Phrase | undefined = place === null ? undefined : [T.impressumAt, { page: place }];
      const detail = impressum === 'pdf' ? T.impressumPdf : impressum === 'failed' ? T.impressumFailed : impressum === 'not-captured' ? T.impressumNotOpened : where;
      set(4, detail === undefined ? { title: T.impressumFound } : { title: T.impressumFound, detail });
    }
    if (impressum === 'analyzed') {
      const found = (Object.keys(T.fieldNames) as (keyof typeof T.fieldNames)[]).filter((f) => legal.fields[f].status === 'found').map((f) => T.fieldNames[f]);
      set(5, { title: T.fieldsRead, detail: found.length === 0 ? T.fieldsNone : found.join(', ') });
    } else set(5, { title: T.waiting[5], detail: T.notChecked(legal.impressumLink === null ? T.whyNoImpressum : T.whyManual), unchecked: true });
  }

  if (checked('accessibility')) {
    // A type whose rule failed is a finding of kind "not-checked": then not all six types were checked.
    const partly = report.findings.some((f) => f.area === 'accessibility' && f.kind === 'not-checked');
    set(6, partly ? { title: T.waiting[6], detail: T.notChecked(T.whyNotAllTypes), unchecked: true } : { title: T.accessibility, detail: T.accessibilityDetail });
  }
  if (checked('security') && report.security !== null) set(7, { title: T.security });
  return steps;
}

/** A report the rows and marks can show: the complete check without a notice. */
export const isPlainComplete = (report: Report): boolean => report.state === 'complete' && report.notice === null;

/** "7 Funde, davon 3 vorrangig. 2 Punkte bitte manuell prüfen. Zu jedem gibt es eine Anleitung für WordPress." */
function countsText(report: Report): string {
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

/** The line under "Fertig. Ihr Bericht ist gezeichnet." (reference: "7 Funde, davon 3 vorrangig. Zu jedem …"). */
export function summaryOf(report: Report): Phrase {
  switch (report.state) {
    case 'complete':
      return report.notice === null ? countsText(report) : T.summaryAlmostEmpty;
    case 'quick':
      return `${countsText(report)} ${T.summaryQuick}`;
    case 'blocked':
      return T.summaryBlocked;
    case 'not-allowed':
      return T.summaryNotAllowed;
    case 'failed':
      return T.summaryFailed;
  }
}

/** Where a priority stands on the drawing, and why: its measured field, or the page's source code. */
export type MarkWhere = { place: MarkPlace; field: string } | { place: 'source'; field: null };


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

/** The panel of a scan that ended without a report: heading and line (session B2 part 3). */
function endedPanel(state: Pick<LiveScanState, 'ended' | 'endedAt' | 'timeZone'>): { title: string; text: string } {
  const reason = state.ended ?? 'other';
  if (reason === 'daily-limit') {
    const now = state.endedAt ?? 0;
    return { title: T.endedDailyLimit.title, text: T.endedDailyLimit.text(whenText(nextUtcDay(now), now, state.timeZone)) };
  }
  return T.ended[reason];
}

/** The text of the status line: a function of the state, so it changes only when the state does. */
export function statusOf(state: Pick<LiveScanState, 'phase' | 'queuePosition'> & Partial<Pick<LiveScanState, 'report' | 'ended' | 'offline' | 'endedAt' | 'timeZone'>>): string {
  if (state.offline === true && (state.phase === 'loading' || state.phase === 'queued' || state.phase === 'running')) return T.statusOffline;
  switch (state.phase) {
    case 'loading':
      return '';
    case 'queued':
      return T.statusQueued(state.queuePosition);
    case 'running':
      return T.statusRunning;
    case 'done':
      switch (state.report?.state) {
        case 'quick':
          return T.statusQuick;
        case 'blocked':
          return T.statusBlocked;
        case 'failed':
          return T.statusFailed;
        case 'not-allowed':
          return T.statusNotAllowed;
        default:
          return T.statusDone;
      }
    case 'error':
      return endedPanel(state).title;
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
  if (state.phase === 'error' && state.ended === 'unreadable') {
    // The scan is done, but its report could not be read (review of B2 part 3): nothing on the screen says that
    // nothing was measured; the rows wait for the report, the panel offers to load this page again.
    const panel = endedPanel(state);
    return {
      ...base,
      action: 'new',
      drawingLabel: T.drawingDone([]),
      marks: [],
      steps: waitingSteps(),
      progress: { kind: 'live', phase: 'done', since: 0 },
      report: { title: panel.title, summary: panel.text, href: `/pruefung?id=${state.id}`, label: T.reload, delay: 0 },
    };
  }
  if (state.phase === 'error') {
    // Ended without a report (session B2 part 3): nothing was measured; "Neue Prüfung" in the header and the panel.
    const panel = endedPanel(state);
    return {
      ...base,
      heading: state.ended === 'unknown' ? { suffix: '', withoutHost: T.headingUnknown } : { suffix: T.headingEnded, withoutHost: T.headingEndedWithoutHost },
      action: 'new',
      drawingLabel: T.drawingUnmeasured,
      marks: [],
      steps: uncheckedSteps(),
      progress: { kind: 'live', phase: 'waiting', since: 0 },
      report: { title: panel.title, summary: panel.text, href: '/', label: T.newScan, delay: 0 },
    };
  }
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
  const measured = report.state === 'complete' || report.state === 'quick';
  return {
    ...base,
    domain: report.site.displayHost,
    drawingLabel: measured ? marksLabel(report) : T.drawingUnmeasured,
    marks,
    steps: reportSteps(report),
    progress: { kind: 'live', phase: 'done', since: 0 },
    report: { summary: summaryOf(report), href: `/bericht?id=${state.id}`, delay: start + (marks.length > 0 ? PANEL_AFTER : 0) },
  };
}
