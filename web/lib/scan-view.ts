import type { Report } from '@website-check/scanner/report';
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
/** The places of the design in the order of the priorities (the reference: Feld B2, A3, A2). */
const MARK_PLACES: readonly MarkPlace[] = ['heading', 'source', 'subline'];
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

/** The marks of the priorities ("Drei Dinge"), numbered as in the report, starting `base` seconds after they appear. */
export function marksOf(report: Report, base: number, scale = LIVE_MOTION_SCALE): PlotMark[] {
  if (!isPlainComplete(report)) return [];
  return report.priorities.slice(0, 3).map((_, i) => {
    const t = MARK_TIMES[i]!;
    return {
      place: MARK_PLACES[i]!,
      number: i + 1,
      draw: { delay: base + t.at * scale, duration: t.duration * scale },
      numberDelay: base + t.number * scale,
    };
  });
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
    drawingLabel: isPlainComplete(report) ? T.drawingDone(marks.length) : T.drawingWaiting,
    marks,
    steps: isPlainComplete(report) ? reportSteps(report) : waitingSteps(),
    progress: { kind: 'live', phase: 'done', since: 0 },
    report: { summary: summaryOf(report), href: `/bericht?id=${state.id}`, delay: start + (marks.length > 0 ? PANEL_AFTER : 0) },
  };
}
