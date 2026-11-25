import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { REPORT_SCHEMA_V1, validateReport, type Finding, type Report } from '@website-check/scanner';
import exampleJson from '../components/report/example-report.json';
import { ReportScreen } from '../components/report/report-screen';
import { EXAMPLE_REPORT_FILE, exampleReportText } from '../scripts/example-report-source';
import { fill } from '../lib/report-texts';
import { findingTitle, headFacts, measureRows, ownFilesText, percentOf, planLabel, planMarks, priorityItems, ratioText, timelineView } from '../lib/report-view';

// The upper part of the report (session B3 part 1) with the example of the reference: every text, value and position
// must be the one of design/reference/bericht.html, except where a product rule decides otherwise (named below).
// npm run visual, motion and a11y compare the built page in a browser; this test catches a changed text or value
// without one.

const ROOT = join(import.meta.dirname, '..', '..');
const reference = readFileSync(join(ROOT, 'design', 'reference', 'bericht.html'), 'utf8');
const EXAMPLE = exampleJson as unknown as Report;
const strip = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const phraseText = (p: ReturnType<typeof findingTitle>): string => (typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));

describe('the example report', () => {
  it('passes the report schema by our validator and by Ajv', () => {
    expect(validateReport(EXAMPLE)).toEqual([]);
    const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(REPORT_SCHEMA_V1 as object);
    expect(ajv(EXAMPLE)).toBe(true);
  });

  it('is what web/scripts/make-example-report.ts writes (the scanner builds it; the hand-set values are named there)', () => {
    expect(readFileSync(EXAMPLE_REPORT_FILE, 'utf8')).toBe(exampleReportText());
  });
});

describe('head', () => {
  it('shows the four facts of the reference', () => {
    const ref = [...reference.matchAll(/<dt class="mut">([^<]+)<\/dt><dd[^>]*>([^<]+)<\/dd>/g)].map((m) => ({ label: m[1], value: m[2] }));
    expect(ref).toHaveLength(4);
    expect(headFacts(EXAMPLE, 'Europe/Berlin')).toEqual(ref);
  });
});

describe('Prüfmaße', () => {
  const refRows = [...reference.matchAll(/<tr><td>([^<]+)<\/td><td class="num">([^<]+)<\/td><td class="num( bad)?">([^<]+)<\/td><td><span class="res r-(\w+)">.*?<\/svg>([^<]+)<\/span><\/td><\/tr>/g)].map((m) => ({
    name: m[1],
    target: m[2],
    bad: m[3] !== undefined,
    actual: m[4],
    tone: m[5],
    label: m[6],
  }));

  it('has the rows of the reference with their names, targets and values', () => {
    expect(refRows).toHaveLength(7);
    const rows = measureRows(EXAMPLE);
    expect(rows.map((r) => r.name)).toEqual(refRows.map((r) => r.name));
    expect(rows.map((r) => r.target)).toEqual(refRows.map((r) => r.target));
    // Product rule 3 (docs/report-schema.md, conflict 14, Fedor 23.11.2026): an accessibility statement the scan did
    // not find is "nicht gefunden, bitte manuell prüfen", never "fehlt" and "nicht erfüllt" as in the reference.
    const statement = refRows.findIndex((r) => r.name === 'Erklärung zur Barrierefreiheit');
    expect(rows[statement]).toMatchObject({ actual: 'nicht gefunden', bad: false, result: { label: 'bitte manuell prüfen', tone: 'mid' } });
    const others = (list: { actual: string | undefined; bad: boolean }[]) => list.filter((_, i) => i !== statement).map((r) => [r.actual, r.bad]);
    expect(others(rows)).toEqual(others(refRows));
    expect(rows.filter((_, i) => i !== statement).map((r) => [r.result.label, r.result.tone])).toEqual(refRows.filter((_, i) => i !== statement).map((r) => [r.label, r.tone]));
  });

  it('writes a failing contrast rounded down, never as the required value', () => {
    expect(ratioText(2.9)).toBe('2,9');
    expect(ratioText(4.47)).toBe('4,4');
    expect(ratioText(21)).toBe('21');
  });
});

describe('"Drei Dinge" and the plan', () => {
  it('lists the three priorities of the reference with title, area, risk and field', () => {
    const ref = [...reference.matchAll(/<span class="pencil" aria-hidden="true">(\d)<\/span><div[^>]*><a href="([^"]+)"[^>]*>([^<]+)<\/a><span class="mut"[^>]*>([^<]+)<span class="feld">([^<]+)<\/span>/g)].map((m) => ({
      number: Number(m[1]),
      title: m[3],
      meta: m[4]!.trim(),
      field: m[5],
      href: m[2],
    }));
    expect(ref).toHaveLength(3);
    expect(priorityItems(EXAMPLE)).toEqual(ref);
  });

  it('marks the three places of the reference and names them as the reference does', () => {
    expect(planMarks(EXAMPLE)).toEqual([
      { place: 'heading', text: '1' },
      { place: 'source', text: '2' },
      { place: 'subline', text: '3' },
    ]);
    expect(planLabel(EXAMPLE)).toBe(/aria-label="(Plan der Startseite[^"]+)"/.exec(reference)![1]);
  });

  it('draws the marks with the delays, shapes and number places of the reference', () => {
    const marks = (html: string) => {
      const start = html.indexOf('<svg viewBox="-22 -28 504 412"');
      const svg = html.slice(start, html.indexOf('</svg>', start));
      // The marks are the elements of the plan with an animation delay (the class names of the app are hashed).
      return [...svg.matchAll(/<(path|text)\b([^>]*animation-delay[^>]*)>/g)].map((m) => {
        const a = m[2]!;
        const delay = Number(/animation-delay:\s*([\d.]+)s/.exec(a)?.[1]);
        const place = /\sd="([^"]+)"/.exec(a)?.[1] ?? `${/\sx="([^"]+)"/.exec(a)?.[1]} ${/\sy="([^"]+)"/.exec(a)?.[1]}`;
        return `${m[1]} ${place} @${delay}`;
      });
    };
    const app = renderToStaticMarkup(<ReportScreen report={EXAMPLE} timeZone="Europe/Berlin" />);
    expect(marks(reference)).toHaveLength(6);
    expect(marks(app)).toEqual(marks(reference));
  });
});

describe('Zeitschnitt A–A', () => {
  const view = timelineView(EXAMPLE)!;

  it('has the rows, bars and labels of the reference', () => {
    const ref = [...reference.matchAll(/<div class="trow"><span class="tlab">([^<]+)<small>([^<]+)<\/small><\/span><div class="track"><span class="bar (own|ext)" style="left: ([\d.]+%); width: ([\d.]+%)"><\/span>/g)].map((m) => ({
      label: m[1],
      small: m[2],
      party: m[3] === 'own' ? 'own' : 'third',
      left: m[4],
      width: m[5],
    }));
    expect(ref).toHaveLength(6);
    const app = view.rows.map((r) => ({ label: phraseText(r.label), small: phraseText(r.small), party: r.party, left: r.left, width: r.width }));
    // Session B3 part 2: the report names the types of the site's own files (style sheets, a font and scripts in the
    // window of the example), so the row says "Ihre Dateien: Design und Skripte" as the reference does.
    expect(ref[1]!.small).toBe('Ihre Dateien: Design und Skripte');
    expect(app).toEqual(ref);
  });

  it('names the types of the own files only when they are true (Fedor, B3 part 2, answer 1)', () => {
    expect(ownFilesText(['stylesheet', 'font', 'script'])).toBe('Ihre Dateien: Design und Skripte');
    expect(ownFilesText(['script'])).toBe('Ihre Dateien: Skripte');
    expect(ownFilesText(['stylesheet', 'script', 'image', 'data'])).toBe('Ihre Dateien: Design, Skripte, Bilder und Daten');
    expect(ownFilesText(['image', 'media', 'other'])).toBe('Ihre Dateien: Bilder, Medien und Weiteres');
    expect(ownFilesText(['other'])).toBe('Ihre Dateien');
    expect(ownFilesText([])).toBe('Ihre Dateien');
    expect(ownFilesText(null)).toBe('Ihre Dateien');
  });

  it('has the ticks, the cut and the banner time of the reference', () => {
    const ticks = [...reference.matchAll(/<span style="position: absolute; (left: ([\d.]+%)|left: 0|right: 0); bottom: 4px[^"]*">([^<]+)<\/span>/g)].map((m) => ({
      text: m[3],
      left: m[2] ?? null,
      edge: m[1] === 'left: 0' ? 'start' : m[1] === 'right: 0' ? 'end' : null,
    }));
    expect(ticks.map((t) => t.text)).toEqual(['0 s', '0,5 s', '1 s', '2 s', '2,5 s', '3 s']);
    expect(view.ticks).toEqual(ticks);
    expect(view.cut).toEqual({ left: /\.cut \{[^}]*left: ([\d.]+%)/.exec(reference)![1], text: strip(/(Einwilligungsbanner erscheint nach [^<]+)</.exec(reference)![1]!) });
  });

  it('leaves out a tick within 200 ms of the cut only', () => {
    const at = (banner: number) => timelineView({ ...EXAMPLE, timeline: { ...EXAMPLE.timeline!, bannerVisibleAtMs: banner } })!.ticks.map((t) => t.text);
    expect(at(1000)).toEqual(['0 s', '0,5 s', '1,5 s', '2 s', '2,5 s', '3 s']);
    expect(at(1250)).toEqual(['0 s', '0,5 s', '1 s', '1,5 s', '2 s', '2,5 s', '3 s']);
    expect(percentOf(1400, 3000)).toBe('46.6667%');
  });
});

describe('strings of the scanned page', () => {
  const service = (name: string): Finding => ({ ...EXAMPLE.findings.find((f) => f.id === 'third-party:google-tag-manager')!, serviceKey: 'unknown:example.com', params: { service: name } });

  it('keeps a value of the page a part of its own, filled once', () => {
    expect(findingTitle(service('{service}.beispiel.example'))).toEqual([{ page: '{service}.beispiel.example' }, ' startet vor der Einwilligung']);
    expect(fill('{a} und {b}', { a: '{b}', b: 'x' }, ['a'])).toEqual([{ page: '{b}' }, ' und x']);
  });

  it('gives a general title for an unknown text id or a missing value, never the id', () => {
    expect(findingTitle({ ...EXAMPLE.findings[3]!, textId: 'no-such-text' })).toBe('Vorrangiger Punkt');
    expect(findingTitle({ ...EXAMPLE.findings[3]!, params: {} })).toBe('Vorrangiger Punkt');
  });

  it('shows markup of the page as text', () => {
    const hostile = { ...EXAMPLE, site: { ...EXAMPLE.site, displayHost: '<img src=x onerror=alert(1)>' } } as Report;
    const html = renderToStaticMarkup(<ReportScreen report={hostile} timeZone="Europe/Berlin" />);
    expect(html).toContain('<bdi class="text-[length:clamp(40px,5vw,64px)] leading-none wrap-anywhere">&lt;img src=x onerror=alert(1)&gt;</bdi>');
    expect(html).not.toContain('<img');
  });

  it('ends with the sentence every report ends with', () => {
    const html = renderToStaticMarkup(<ReportScreen report={EXAMPLE} timeZone="Europe/Berlin" />);
    expect(strip(html)).toContain('Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.');
  });
});
