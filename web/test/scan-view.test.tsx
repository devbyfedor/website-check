import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReport, DEFAULT_RULES, RULES_FILE, SCANNER_VERSION, type Finding, type Report } from '@website-check/scanner';
import { SHOP_URL, shopCapture } from '../../scanner/test/report-helpers.ts';
import { drawingEnd } from '../components/scan/plotter';
import type { Phrase, ScanScreenData } from '../components/scan/scan-data';
import { ScanScreen } from '../components/scan/scan-screen';
import { parseScan } from '../lib/scan-api';
import { SCAN_TEXTS } from '../lib/scan-texts';
import { LIVE_MOTION_SCALE, liveScreen, MARKS_START, marksLabel, marksOf, priorityPlaces, statusOf, summaryOf, type LiveScanState } from '../lib/scan-view';

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
  for (const phase of ['loading', 'queued', 'running'] as const) {
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
    expect(flat(screen.steps[1]?.detail)).toBe(SCAN_TEXTS.requestsThirdParty(r.scan.requests?.thirdParty ?? -1));
    expect(SCAN_TEXTS.requestsThirdParty(9)).toBe('davon 9 an fremde Server');
    expect(SCAN_TEXTS.requestsThirdParty(1)).toBe('davon 1 an einen fremden Server');
    const services = r.services.filter((s) => s.findingId !== null && r.findings.find((f) => f.id === s.findingId)?.kind === 'finding');
    expect(screen.steps[3]?.finding).toBe(services.length > 0);
    expect(flat(screen.steps[3]?.title)).toBe(SCAN_TEXTS.servicesBefore(services.length));
    expect(flat(screen.steps[3]?.detail).startsWith(services[0]!.name)).toBe(true);
    expect(flat(screen.steps[6]?.title)).toBe('Barrierefreiheit geprüft');
  });

  it('marks only placed priorities and links to the report of B3 with the id', () => {
    const placed = priorityPlaces(r).filter((p) => p.where !== null);
    expect(screen.marks.flatMap((m) => m.numbers).sort()).toEqual(placed.map((p) => p.number).sort());
    expect(screen.report?.href).toBe(`/bericht?id=${ID}`);
    expect(screen.drawingLabel).toBe(marksLabel(r));
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

});

describe('the marks stand only where they show the place of the finding (Fedor, B2 part 3, answer 1)', () => {
  const base = report();
  const own = base.site.finalUrl ?? base.site.url;
  const template = base.findings[0]!;
  const request = (via: string | null, initiatorType: 'parser' | 'script' | null = 'parser') => ({ type: 'request' as const, url: 'https://tracker.example/x.js', startMs: 10, status: 200, reachedServer: true, beforeBanner: null, via, initiatorType });
  const f = (id: string, over: Partial<Finding>): Finding => ({ ...template, id, kind: 'finding', risk: 'high', area: 'privacy', serviceKey: 'svc', field: null, evidence: [], ...over });
  const withPriorities = (...findings: Finding[]): Report => ({ ...structuredClone(base), findings, priorities: findings.map((x) => x.id) });
  const places = (rep: Report) => marksOf(rep, 0).map((m) => [m.place, m.numbers.join(', ')]);

  it('a measured field gives the mark of the design in that field (B2 heading, A2 subline, A3 source), any other field none', () => {
    const rep = withPriorities(f('a', { field: 'C1' }), f('b', { field: 'B2', area: 'accessibility', serviceKey: null }), f('c', { field: 'A2' }));
    expect(places(rep)).toEqual([
      ['heading', '2'],
      ['subline', '3'],
    ]);
    expect(places(withPriorities(f('a', { field: 'A3', area: 'accessibility', serviceKey: null })))).toEqual([['source', '1']]);
    expect(marksLabel(rep)).toBe('Der Plotter zeichnet die geprüfte Startseite und markiert rot, wo vorrangige Punkte liegen: Punkt 2 in Feld B2 und Punkt 3 in Feld A2.');
  });

  it('without a field: the source code for a third party whose request stands in the source of the homepage, nothing otherwise', () => {
    const fromPage = f('fonts', { evidence: [request('https://tracker.example/a.css'), request(own)] });
    const fromOwnFile = f('tag', { evidence: [request(`${new URL(own).origin}/wp-content/theme.js`)] });
    const fromThirdParty = f('ga', { evidence: [request('https://www.googletagmanager.com/gtm.js')] });
    expect(places(withPriorities(fromPage))).toEqual([['source', '1']]);
    // Session B3 part 2 (Fedor): a request a script made is no tag of the source, also when the stack names the homepage
    // (an inline script a tag manager inserted); a request of the site's own script or style sheet is none either.
    expect(places(withPriorities(f('inline', { evidence: [request(own, 'script')] })))).toEqual([]);
    expect(places(withPriorities(fromOwnFile))).toEqual([]);
    expect(places(withPriorities(f('css', { evidence: [request(`${new URL(own).origin}/wp-content/style.css`, 'parser')] })))).toEqual([]);
    // A report made before the initiator type existed: no mark (unsure means no mark).
    expect(places(withPriorities(f('old', { evidence: [{ ...request(own), initiatorType: undefined }] })))).toEqual([]);
    expect(places(withPriorities(f('null', { evidence: [request(own, null)] })))).toEqual([]);
    // The homepage with a query or a fragment is the same document.
    expect(places(withPriorities(f('query', { evidence: [request(`${own}?lang=de#top`)] })))).toEqual([['source', '1']]);
    expect(places(withPriorities(fromThirdParty))).toEqual([]);
    expect(places(withPriorities(f('x', { evidence: [request(null)] })))).toEqual([]);
    // A look-alike host is no file of the site.
    expect(places(withPriorities(f('y', { evidence: [request(`https://${new URL(own).hostname}.evil.example/x.js`)] })))).toEqual([]);
    // Mandatory information and security have no place on the drawing.
    expect(places(withPriorities(f('legal', { area: 'mandatory-information', serviceKey: null, kind: 'manual' })))).toEqual([]);
    expect(marksLabel(withPriorities(fromThirdParty))).toBe('Der Plotter zeichnet die geprüfte Startseite.');
  });

  it('the language of the page is in the source, whatever its "field"; two priorities at one place share the mark', () => {
    const lang = f('a11y:page-language', { area: 'accessibility', serviceKey: null, risk: 'medium', field: 'C2' });
    const fonts = f('fonts', { evidence: [request(own)] });
    const rep = withPriorities(fonts, f('b', { field: 'D3' }), lang);
    expect(places(rep)).toEqual([['source', '1, 3']]);
    expect(marksLabel(rep)).toBe('Der Plotter zeichnet die geprüfte Startseite und markiert rot, wo vorrangige Punkte liegen: Punkt 1 im Quelltext und Punkt 3 im Quelltext.');
    const screen = liveScreen(state({ phase: 'done', report: rep }));
    expect(screen.marks).toHaveLength(1);
    expect(renderToStaticMarkup(<ScanScreen scan={screen} />)).toContain('>1, 3</text>');
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
    expect(statusOf({ phase: 'error', queuePosition: null, ended: 'cancelled' })).toBe(SCAN_TEXTS.ended.cancelled.title);
    expect(statusOf({ phase: 'error', queuePosition: null })).toBe(SCAN_TEXTS.ended.other.title);
    expect(statusOf({ phase: 'queued', queuePosition: 2, offline: true })).toBe(SCAN_TEXTS.statusOffline);
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
    expect(parseScan(good)).toEqual({ id: ID, status: 'queued', displayHost: 'beispiel.de', queuePosition: 2, startedAt: null, cancelToken: 'a'.repeat(26), errorReason: null });
    expect(parseScan({ ...good, status: 'error', errorReason: 'cancelled' })?.errorReason).toBe('cancelled');
    expect(parseScan({ ...good, status: 'error', errorReason: '<b>x</b>' })?.errorReason).toBe('other');
    expect(parseScan({ ...good, errorReason: 'cancelled' })?.errorReason).toBeNull();
    expect(parseScan({ ...good, id: '../x' })).toBeNull();
    expect(parseScan({ ...good, status: 'fertig' })).toBeNull();
    expect(parseScan([good])).toBeNull();
    expect(parseScan({ ...good, queuePosition: -1, cancelToken: 'kurz', displayHost: 'x'.repeat(300) })).toMatchObject({ queuePosition: null, cancelToken: null, displayHost: null });
  });
});
