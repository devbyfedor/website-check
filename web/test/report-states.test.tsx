import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { validateReport, type Report } from '@website-check/scanner';
import exampleJson from '../components/report/example-report.json';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states';
import { ReportPageStateView } from '../components/report/report-page-state';
import { ReportScreen } from '../components/report/report-screen';
import { PAGE_TEXTS, STATE_DRAFTS as D } from '../lib/report-texts';
import { countryName, headFacts, measured, measureRows, noticeLines, prioritiesHeading, priorityItems, timelineView } from '../lib/report-view';

// The states of the upper part of the report that the design does not show (session B3 part 2), each from a report the
// scanner's own builder makes (web/components/report/example-report-states.ts). The checks in a browser (npm run
// check:report) look at the same states on the real page.

const EXAMPLE = exampleJson as unknown as Report;
const reportOf = (slug: string): Report => {
  const shown = EXAMPLE_REPORT_STATES.find((s) => s.slug === slug)?.show();
  if (shown === undefined || !('report' in shown)) throw new Error(`no report state ${slug}`);
  return shown.report;
};
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('every example state', () => {
  it('has a slug of its own and a report that passes the validator', () => {
    const slugs = EXAMPLE_REPORT_STATES.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of EXAMPLE_REPORT_STATES) {
      const shown = s.show();
      if ('report' in shown) expect(validateReport(shown.report), s.slug).toEqual([]);
    }
  });

  it('ends with the last line of every report (product rule 4) and uses no forbidden word', () => {
    const forbidden = /Sie verstoßen gegen|illegal|rechtswidrig|Abmahngefahr|abmahnsicher|rechtssicher|garantiert|DSGVO-konform/i;
    for (const s of EXAMPLE_REPORT_STATES) {
      const shown = s.show();
      const html = 'report' in shown ? renderToStaticMarkup(<ReportScreen report={shown.report} timeZone="Europe/Berlin" />) : renderToStaticMarkup(<ReportPageStateView state={shown.page} here="/bericht" />);
      expect(text(html), s.slug).not.toMatch(forbidden);
      if ('report' in shown) expect(text(html).endsWith('Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit. Impressum Datenschutz Barrierefreiheit') || text(html).includes('Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.'), s.slug).toBe(true);
    }
  });
});

describe('head', () => {
  it('names the country of the visit when the report knows it, after the four facts of the reference', () => {
    // With the note of B4 part 1 (Fedor's answer 3): a browser in the EU, set like a visitor from Germany.
    const note = 'Unser Prüfbrowser läuft in einem Rechenzentrum in der EU und ist eingestellt wie ein Besucher aus Deutschland: deutsche Sprache, Zeitzone Berlin.';
    expect(headFacts(reportOf('land')).at(-1)).toEqual({ label: 'Aufgerufen aus', value: 'Niederlande', note });
    expect(headFacts(reportOf('zwei-punkte')).at(-1)).toEqual({ label: 'Aufgerufen aus', value: 'Deutschland', note });
    // "in der EU" only for a country of the EU; the settings only when the report says de-DE and Europe/Berlin.
    const swiss = { ...reportOf('land'), visit: { ...reportOf('land').visit, country: 'CH' } } as Report;
    expect(headFacts(swiss).at(-1)?.note).toBe('Unser Prüfbrowser läuft in einem Rechenzentrum und ist eingestellt wie ein Besucher aus Deutschland: deutsche Sprache, Zeitzone Berlin.');
    const english = { ...reportOf('land'), visit: { ...reportOf('land').visit, locale: 'en-US' } } as Report;
    expect(headFacts(english).at(-1)?.note).toBe('Unser Prüfbrowser läuft in einem Rechenzentrum in der EU.');
    // The quick check has no browser (review of B4 part 1).
    const quick = { ...reportOf('land'), visit: { ...reportOf('land').visit, browser: null } } as Report;
    expect(headFacts(quick).at(-1)?.note).toBe('Unsere Abfrage kam aus einem Rechenzentrum in der EU.');
    expect(headFacts(EXAMPLE).map((f) => f.label)).toEqual(['Geprüft am', 'System', 'Geprüfte Seiten', 'Revision']);
    expect(countryName('DE')).toBe('Deutschland');
    // Codes that name no country: Cloudflare's XX (unknown), ZZ, and a code the browser has no name for (review of B3 part 2).
    for (const code of ['XX', 'ZZ', 'T1', 'QQ']) expect(countryName(code), code).toBeNull();
    const unknown = { ...reportOf('land'), visit: { ...reportOf('land').visit, country: 'XX' } } as Report;
    expect(headFacts(unknown).map((f) => f.label)).not.toContain('Aufgerufen aus');
  });

  it('a homepage that did not load: system "nicht geprüft" (never "unbekannt"), checked pages "keine"', () => {
    for (const slug of ['blockiert', 'zeitlimit', 'serverfehler', 'nicht-erlaubt', 'seitenlimit']) {
      const facts = Object.fromEntries(headFacts(reportOf(slug)).map((f) => [f.label, f.value]));
      expect(facts.System, slug).toBe('nicht geprüft');
      expect(facts['Geprüfte Seiten'], slug).toBe('keine');
    }
    expect(Object.fromEntries(headFacts(reportOf('ohne-vorrang')).map((f) => [f.label, f.value])).System).toBe('unbekannt');
  });
});

describe('the note under the head', () => {
  it('says nothing for a plain complete check', () => {
    expect(noticeLines(EXAMPLE)).toEqual([]);
    expect(noticeLines(reportOf('zwei-punkte'))).toEqual([]);
  });

  it('names the state of every other report, by its own texts', () => {
    expect(noticeLines(reportOf('schnellpruefung'))).toEqual([D.quick]);
    expect(noticeLines(reportOf('blockiert'))).toEqual(['Ihre Website hat unseren Browser nicht durchgelassen (Antwort 403). Deshalb zeigt der Bericht keine Funde.']);
    expect(noticeLines(reportOf('blockiert-schnellpruefung'))[0]).toContain('unsere Abfrage nicht durchgelassen (Antwort 429)');
    expect(noticeLines(reportOf('zeitlimit'))).toEqual(['Ihre Startseite ließ sich nicht prüfen: sie hat nicht rechtzeitig geantwortet. Deshalb zeigt der Bericht keine Funde.']);
    expect(noticeLines(reportOf('serverfehler'))[0]).toContain('mit dem Fehler 500 geantwortet');
    expect(noticeLines(reportOf('keine-webseite'))[0]).toContain('keine Webseite, sondern eine Datei');
    expect(noticeLines(reportOf('nicht-erlaubt'))[0]).toContain('mehr als fünfmal weiter');
    expect(noticeLines(reportOf('fast-leer'))).toEqual([D.almostEmpty]);
  });

  it('says what the report shows only in part, and a page that was still loading', () => {
    const lines = noticeLines(reportOf('gekuerzt'));
    expect(lines).toEqual([D.stillLoading, 'Der Bericht enthält nur die wichtigsten 60 von 86 Punkten.', 'Der Bericht enthält nur 80 von 85 fremden Diensten.', D.truncatedPage['homepage-text'], D.truncatedPage['homepage-links']]);
  });

  it('a reason or a key of the report never picks a value of a prototype (review of B3 part 2)', () => {
    const r = { ...reportOf('nicht-erlaubt'), notice: { textId: 'report-not-allowed', params: { rejection: 'constructor' } } } as Report;
    expect(noticeLines(r)[0]).toContain('die Adresse ist für die Prüfung nicht zugelassen');
    const base = reportOf('ohne-felder');
    const odd = { ...base, findings: base.findings.map((f, i) => (i === 0 ? { ...f, textId: 'constructor', serviceKey: 'toString', area: 'privacy' as const } : i === 1 ? { ...f, textId: 'constructor', area: 'accessibility' as const, serviceKey: null } : f)) } as Report;
    expect(() => renderToStaticMarkup(<ReportScreen report={odd} />)).not.toThrow();
    const titles = priorityItems(odd).map((p) => (typeof p.title === 'string' ? p.title : p.title.map((x) => (typeof x === 'string' ? x : x.page)).join('')));
    expect(titles.slice(0, 2).every((t) => !t.includes('function') && !t.includes('native code'))).toBe(true);
  });

  it('a notice the page does not know gets a general line, never its id or a reason of the page', () => {
    const r = { ...reportOf('blockiert'), notice: { textId: 'report-<b>neu</b>', params: { reason: '<script>' } } } as Report;
    expect(noticeLines(r)).toEqual([D.otherNotice]);
    const failed = { ...reportOf('zeitlimit'), failure: { reason: 'something-new', status: null } } as unknown as Report;
    expect(noticeLines(failed)[0]).toContain('bei der Prüfung ist ein Fehler aufgetreten');
  });
});

describe('Prüfmaße', () => {
  it('"keine Bilder" on a page without images instead of "0 von 0"', () => {
    expect(measureRows(reportOf('keine-bilder')).find((m) => m.id === 'images-described')).toMatchObject({ actual: 'keine Bilder', result: { label: 'erfüllt' } });
  });

  it('"nicht geprüft" for a row that did not run, "nicht ermittelt" for one that ran without a value, "bitte manuell prüfen" when unsure', () => {
    const rows = Object.fromEntries(measureRows(reportOf('manuell')).map((m) => [m.id, m]));
    expect(rows['lowest-contrast']).toMatchObject({ actual: 'nicht geprüft', result: { label: 'nicht geprüft', tone: 'mid' } });
    expect(rows['impressum-fields']).toMatchObject({ actual: 'nicht ermittelt', result: { label: 'bitte manuell prüfen', tone: 'mid' } });
    for (const row of measureRows(reportOf('fast-leer'))) expect(['bitte manuell prüfen', 'nicht geprüft'], row.id).toContain(row.result.label);
  });

  it('no table when the homepage did not load', () => {
    for (const slug of ['blockiert', 'zeitlimit', 'nicht-erlaubt']) expect(text(renderToStaticMarkup(<ReportScreen report={reportOf(slug)} />)), slug).not.toContain('Prüfmaße');
  });
});

describe('"Drei Dinge"', () => {
  it('the heading follows the number of priorities', () => {
    expect(prioritiesHeading(EXAMPLE)).toEqual({ heading: 'Drei Dinge sollten Sie zuerst beheben', none: null });
    expect(prioritiesHeading(reportOf('zwei-punkte')).heading).toBe('Zwei Dinge sollten Sie zuerst beheben');
    expect(prioritiesHeading(reportOf('manuell')).heading).toBe('Das sollten Sie zuerst beheben');
    expect(prioritiesHeading(reportOf('ohne-vorrang'))).toEqual({ heading: 'Keine vorrangigen Punkte', none: D.prioritiesNoneText });
  });

  it('no such section when nothing of the homepage was measured (blocked, refused, failed, almost empty page)', () => {
    for (const slug of ['blockiert', 'zeitlimit', 'nicht-erlaubt', 'fast-leer']) {
      expect(measured(reportOf(slug)), slug).toBe(false);
      expect(text(renderToStaticMarkup(<ReportScreen report={reportOf(slug)} />)), slug).not.toMatch(/Dinge sollten|vorrangigen Punkte|Plan der Startseite/);
    }
  });

  it('priorities without a field have no "Feld" caption', () => {
    const items = priorityItems(reportOf('ohne-felder'));
    expect(items).toHaveLength(3);
    expect(items.map((p) => p.field)).toEqual([null, null, null]);
  });
});

describe('Zeitschnitt', () => {
  it('none on an almost empty page: what was seen may belong to a protection page (review of B3 part 2)', () => {
    expect(timelineView(reportOf('fast-leer'))).toBeNull();
    expect(text(renderToStaticMarkup(<ReportScreen report={reportOf('fast-leer')} />))).not.toMatch(/Zeitschnitt|Kein Einwilligungsbanner/);
  });

  it('without a banner: no cut, the line "Kein Einwilligungsbanner erkannt."', () => {
    const view = timelineView(reportOf('zwei-punkte'));
    expect(view?.cut).toBeNull();
    expect(view?.lines).toEqual([D.bannerNotSeen]);
    expect(text(renderToStaticMarkup(<ReportScreen report={reportOf('zwei-punkte')} />))).not.toContain('Schnitt A–A, Banner wird sichtbar');
  });

  it('a banner after the window: no cut, the time in a line', () => {
    const view = timelineView(reportOf('banner-spaeter'));
    expect(view?.cut).toBeNull();
    expect(view?.lines).toEqual(['Einwilligungsbanner erscheint nach 4,2 s, nach diesem Ausschnitt.']);
  });

  it('no third party in the window: a line says so; the cut stays', () => {
    const view = timelineView(reportOf('ohne-fremde-server'));
    expect(view?.cut?.text).toBe('Einwilligungsbanner erscheint nach 0,9 s');
    expect(view?.lines).toEqual([D.noThirdParty]);
    expect(timelineView(EXAMPLE)?.lines).toEqual([]);
  });
});

describe('the page without a report', () => {
  it('each state has its heading, its line and its way on; the address of the scan only as text', () => {
    const html = (state: Parameters<typeof ReportPageStateView>[0]['state']) => renderToStaticMarkup(<ReportPageStateView state={state} here="/bericht?id=x" />);
    const notReady = html({ kind: 'not-ready', id: 'abcdefghijklmnopqrstuvwxyz', displayHost: '<b>roesterei-muster.de</b>' });
    expect(notReady).toContain('href="/pruefung?id=abcdefghijklmnopqrstuvwxyz"');
    expect(notReady).toContain('&lt;b&gt;roesterei-muster.de&lt;/b&gt;');
    expect(notReady).not.toContain('<b>roesterei');
    expect(text(html({ kind: 'not-found' }))).toContain(PAGE_TEXTS.notFound.title);
    expect(html({ kind: 'error' })).toContain('href="/bericht?id=x"');
    expect(text(html({ kind: 'ended', reason: 'cancelled', displayHost: null }))).toContain(PAGE_TEXTS.ended.cancelled.text);
    // One h1 in every state.
    for (const state of [{ kind: 'loading' }, { kind: 'not-found' }, { kind: 'error' }, { kind: 'not-ready', id: 'a', displayHost: 'x.de' }, { kind: 'ended', reason: 'other', displayHost: null }] as const) {
      expect(html(state).match(/<h1/g)?.length, state.kind).toBe(1);
    }
  });
});
