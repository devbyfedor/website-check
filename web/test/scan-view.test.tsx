import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION, type Report } from '@website-check/scanner';
import { SHOP_URL, shopCapture } from '../../scanner/test/report-helpers.ts';
import { drawingEnd } from '../components/scan/plotter';
import type { Phrase, ScanScreenData } from '../components/scan/scan-data';
import { ScanScreen } from '../components/scan/scan-screen';
import { parseScan } from '../lib/scan-api';
import { SCAN_TEXTS } from '../lib/scan-texts';
import { LIVE_MOTION_SCALE, liveScreen, MARKS_START, statusOf, summaryOf, type LiveScanState } from '../lib/scan-view';

// The real scan screen of session B2 part 2 without a browser (Fedor's answers 1 and 3): before the report no result,
// no number and no mark; with the report its rows, marks, summary and the link to the report of B3; every motion but
// the time bar within 5 s; strings of the page and the visitor only as text in <bdi>.

const ID = 'abcdefghijklmnopqrstuvwxyz';

function report(overrides: Parameters<typeof shopCapture>[0] = {}): Report {
  return buildReport({
    id: ID,
    createdAt: '2026-11-24T09:00:00.000Z',
    siteUrl: SHOP_URL,
    mode: 'full',
    capture: shopCapture(overrides),
    rules: DEFAULT_RULES,
    scannerVersion: SCANNER_VERSION,
    rulesUpdated: RULES_FILE.updated,
    visit: { country: 'IT', colo: 'MXP' },
  }).report;
}

const state = (s: Partial<LiveScanState>): LiveScanState => ({ id: ID, phase: 'loading', displayHost: 'roesterei-muster.example', queuePosition: null, runningSince: 0, report: null, reportShownAt: 0, ...s });

const flat = (p: Phrase | undefined): string => (p === undefined ? '' : typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));

/** The end of every timed motion of a screen except the time bar, in seconds after its elements appeared. */
function motionEnds(screen: ScanScreenData): number[] {
  const ends = [drawingEnd(screen.motionScale ?? 1)];
  for (const m of screen.marks) ends.push(m.draw.delay + m.draw.duration, m.numberDelay + 0.35);
  for (const s of screen.steps) if (s.delay !== null) ends.push(s.delay + 0.3, s.delay + 0.05 + 0.35);
  if (screen.report !== null) ends.push(screen.report.delay + 0.4);
  return ends;
}

describe('before the report: no result, no number, no mark (Fedor, answer 1)', () => {
  for (const phase of ['loading', 'queued', 'running', 'error'] as const) {
    it(`${phase}: every row waits, with the name of its step and nothing else`, () => {
      const screen = liveScreen(state({ phase, queuePosition: 3, runningSince: 4.2 }));
      expect(screen.steps).toHaveLength(8);
      expect(screen.steps.every((s) => s.delay === null && s.detail === undefined && !s.finding)).toBe(true);
      expect(screen.steps.map((s) => flat(s.title))).toEqual([...SCAN_TEXTS.waiting]);
      expect(screen.steps.some((s) => /\d/.test(flat(s.title)))).toBe(false);
      expect(screen.marks).toEqual([]);
      expect(screen.report).toBeNull();
      expect(screen.drawingLabel).toBe(SCAN_TEXTS.drawingWaiting);
    });
  }

  it('the time bar waits in the queue and runs from the time the scan had run when it started', () => {
    expect(liveScreen(state({ phase: 'queued' })).progress).toEqual({ kind: 'live', phase: 'waiting', since: 0 });
    expect(liveScreen(state({ phase: 'running', runningSince: 4.2 })).progress).toEqual({ kind: 'live', phase: 'running', since: 4.2 });
  });

  it('renders no "Bericht öffnen" before the report, so Tab cannot reach it', () => {
    const html = renderToStaticMarkup(<ScanScreen scan={liveScreen(state({ phase: 'running' }))} />);
    expect(html).not.toContain('Bericht öffnen');
    expect(html).not.toContain('/bericht');
  });
});

describe('with the report: rows, marks, summary and the link (Fedor, answer 1)', () => {
  const r = report();
  const screen = liveScreen(state({ phase: 'done', report: r, reportShownAt: 0.5 }));

  it('lights every row of a checked part at once, with the numbers of the report', () => {
    expect(r.state).toBe('complete');
    expect(screen.steps.every((s) => s.delay === 0)).toBe(true);
    expect(flat(screen.steps[0]?.title)).toBe('Seite aufgerufen');
    expect(flat(screen.steps[1]?.title)).toBe(`${r.scan.requests?.total} Anfragen aufgezeichnet`);
    expect(flat(screen.steps[1]?.detail)).toBe(`davon ${r.scan.requests?.thirdParty} an fremde Server`);
    const services = r.services.filter((s) => s.severity === 'finding');
    expect(screen.steps[3]?.finding).toBe(services.length > 0);
    expect(flat(screen.steps[3]?.title)).toBe(SCAN_TEXTS.servicesBefore(services.length));
    expect(flat(screen.steps[3]?.detail).startsWith(services[0]!.name)).toBe(true);
    expect(flat(screen.steps[6]?.title)).toBe('Barrierefreiheit geprüft');
  });

  it('marks the priorities in their order, at most three, and links to the report of B3 with the id', () => {
    expect(screen.marks.map((m) => m.number)).toEqual(r.priorities.slice(0, 3).map((_, i) => i + 1));
    expect(screen.marks.map((m) => m.place)).toEqual(['heading', 'source', 'subline'].slice(0, screen.marks.length));
    expect(screen.report?.href).toBe(`/bericht?id=${ID}`);
    expect(screen.drawingLabel).toBe(SCAN_TEXTS.drawingDone(screen.marks.length));
    expect(screen.domain).toBe(r.site.displayHost);
  });

  it('writes the summary of the reference from the counts of the report', () => {
    const n = r.counts.findings;
    expect(flat(summaryOf(r)).startsWith(`${SCAN_TEXTS.findings(n)}`)).toBe(true);
    const fixture = structuredClone(r);
    fixture.counts = { ...fixture.counts, findings: 7, manual: 0 };
    fixture.findings = Array.from({ length: 7 }, (_, i) => ({ ...r.findings[0]!, id: `f${i}`, kind: 'finding' as const, fixTextId: 'fix-x' }));
    fixture.priorities = ['f0', 'f1', 'f2'];
    fixture.truncated = { ...fixture.truncated, findings: false };
    fixture.platform = { system: 'wordpress', woocommerce: true, shopwareVersion: null, shop: true };
    expect(summaryOf(fixture)).toBe('7 Funde, davon 3 vorrangig. Zu jedem gibt es eine Anleitung für WordPress.');
    fixture.findings[6] = { ...fixture.findings[6]!, fixTextId: null };
    expect(summaryOf(fixture)).toBe('7 Funde, davon 3 vorrangig.');
  });

  it('shows a report that is not a plain complete check without rows, numbers or marks (part 3 builds its state)', () => {
    const quick = { ...r, state: 'quick' as const, notice: { textId: 'report-quick-incomplete', params: {} } };
    const other = liveScreen(state({ phase: 'done', report: quick }));
    expect(other.steps.every((s) => s.delay === null)).toBe(true);
    expect(other.marks).toEqual([]);
    expect(other.report?.summary).toBe(SCAN_TEXTS.summaryOther);
  });
});

describe('motion: everything but the time bar ends within 5 seconds (Fedor, answer 3)', () => {
  it('the drawing, the pen and the carriage at the scale of the real page', () => {
    expect(drawingEnd(LIVE_MOTION_SCALE)).toBeLessThanOrEqual(5);
    expect(drawingEnd(1)).toBeCloseTo(7.3);
  });

  it('a report there when the page appears, and one that arrives later', () => {
    const r = report();
    for (const shownAt of [0, 0.2, 1, 3, 3.4, 6, 30]) {
      const screen = liveScreen(state({ phase: 'done', report: r, reportShownAt: shownAt }));
      // Times count from the moment the elements appear: the page (shown at 0) or the arrival of the report.
      const ends = motionEnds(screen).filter((_, i) => i > 0 || shownAt === 0);
      expect(Math.max(...ends), `report shown at ${shownAt} s`).toBeLessThanOrEqual(5 - Math.min(shownAt, MARKS_START) + 0.001);
    }
  });
});

describe('the status line: a text only at real changes', () => {
  it('maps each state to one text; the same state gives the same text', () => {
    expect(statusOf({ phase: 'loading', queuePosition: null })).toBe('');
    expect(statusOf({ phase: 'queued', queuePosition: 2 })).toBe('Ihre Prüfung wartet: Platz 2 in der Warteschlange.');
    expect(statusOf({ phase: 'queued', queuePosition: 2 })).toBe(statusOf({ phase: 'queued', queuePosition: 2 }));
    expect(statusOf({ phase: 'queued', queuePosition: 1 })).not.toBe(statusOf({ phase: 'queued', queuePosition: 2 }));
    expect(statusOf({ phase: 'running', queuePosition: null })).toBe(SCAN_TEXTS.statusRunning);
    expect(statusOf({ phase: 'done', queuePosition: null })).toBe(SCAN_TEXTS.statusDone);
    expect(statusOf({ phase: 'error', queuePosition: null })).toBe(SCAN_TEXTS.statusError);
  });

  it('is one region with role="status" from the start; the example page of the checks has none', () => {
    const html = renderToStaticMarkup(<ScanScreen scan={liveScreen(state({ phase: 'loading', displayHost: null }))} />);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain(SCAN_TEXTS.headingWithoutHost);
  });
});

describe('strings of the scanned page and of the visitor (docs/report-schema.md)', () => {
  it('shows the address, unknown service names and the place of the Impressum only as text in <bdi>', () => {
    const r = report();
    const hostile = '<img src=x onerror=alert(1)>‮gnp.exe';
    const unknown = { ...r.services[0]!, known: false, name: hostile, severity: 'finding' as const };
    const modified: Report = { ...r, services: [unknown, ...r.services.slice(1)] };
    const html = renderToStaticMarkup(<ScanScreen scan={liveScreen(state({ phase: 'done', report: modified, displayHost: hostile }))} />);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<bdi class="wrap-anywhere">&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toMatch(/<h1[^>]*><bdi>[^<]*<\/bdi> wird nachgemessen<\/h1>/);
  });

  it('accepts only answers of the API in the expected shape', () => {
    const good = { id: ID, status: 'queued', displayHost: 'beispiel.de', queuePosition: 2, startedAt: null, cancelToken: 'a'.repeat(26) };
    expect(parseScan(good)).toEqual({ id: ID, status: 'queued', displayHost: 'beispiel.de', queuePosition: 2, startedAt: null, cancelToken: 'a'.repeat(26) });
    expect(parseScan({ ...good, id: '../x' })).toBeNull();
    expect(parseScan({ ...good, status: 'fertig' })).toBeNull();
    expect(parseScan([good])).toBeNull();
    expect(parseScan({ ...good, queuePosition: -1, cancelToken: 'kurz', displayHost: 'x'.repeat(300) })).toMatchObject({ queuePosition: null, cancelToken: null, displayHost: null });
  });
});
