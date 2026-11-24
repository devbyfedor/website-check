import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { validateReport } from '@website-check/scanner/report';
import { EXAMPLE_FORM_STATES, EXAMPLE_NOW, EXAMPLE_SCAN_STATES, EXAMPLE_TIME_ZONE } from '../components/scan/example-states';
import type { Phrase } from '../components/scan/scan-data';
import { ScanScreen } from '../components/scan/scan-screen';
import { formMessage, isAddressProblem } from '../lib/form-view';
import { refusalOf } from '../lib/scan-api';
import { nextUtcDay, SCAN_TEXTS, whenText } from '../lib/scan-texts';
import { liveScreen, statusOf } from '../lib/scan-view';

// Session B2 part 3: the states without design, built only from elements of the reference. Each example state renders,
// its report passes the schema, and the texts follow the rules of the session (drafts in docs/content-drafts.md).

const flat = (p: Phrase | undefined): string => (p === undefined ? '' : typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));
const byslug = (slug: string) => {
  const found = EXAMPLE_SCAN_STATES.find((s) => s.slug === slug);
  if (found === undefined) throw new Error(slug);
  return found.state();
};
const rows = (slug: string) => liveScreen(byslug(slug)).steps.map((s) => `${s.unchecked ? '-' : s.finding ? '!' : s.delay === null ? '.' : '+'} ${flat(s.title)}${s.detail ? ` | ${flat(s.detail)}` : ''}`);

describe('the example states of the scan screen', () => {
  it('every report of an example passes the schema, and every state renders with one status region', () => {
    expect(EXAMPLE_SCAN_STATES.length).toBeGreaterThanOrEqual(19);
    for (const example of EXAMPLE_SCAN_STATES) {
      const state = example.state();
      if (state.report !== null) expect(validateReport(state.report), example.slug).toEqual([]);
      const html = renderToStaticMarkup(<ScanScreen scan={liveScreen(state)} />);
      expect(html.match(/role="status"/g), example.slug).toHaveLength(1);
      expect(statusOf(state), example.slug).not.toBe('');
    }
  });

  it('the reports are in the state their page names', () => {
    const states = Object.fromEntries(EXAMPLE_SCAN_STATES.map((e) => [e.slug, e.state().report?.state ?? null]));
    expect(states).toMatchObject({
      'ohne-funde': 'complete',
      'impressum-auf-startseite': 'complete',
      'ohne-impressum': 'complete',
      schnellpruefung: 'quick',
      blockiert: 'blocked',
      zeitlimit: 'failed',
      serverfehler: 'failed',
      seitenlimit: 'failed',
      'keine-webseite': 'failed',
      'nicht-erlaubt': 'not-allowed',
      'fast-leer': 'complete',
    });
    expect(byslug('fast-leer').report?.notice?.textId).toBe('report-page-almost-empty');
  });

  it('the rows without design: one request, no banner, no service finding, one page, no Impressum link', () => {
    expect(rows('ohne-funde').slice(0, 4)).toEqual([
      '+ Seite aufgerufen | wie von einem Besucher aus Deutschland',
      '+ 2 Anfragen aufgezeichnet | davon 1 an einen fremden Server',
      '+ Kein Einwilligungsbanner erkannt',
      '+ Keine Funde bei fremden Diensten',
    ]);
    expect(rows('impressum-auf-startseite').slice(1, 6)).toEqual([
      '+ 1 Anfrage aufgezeichnet | keine an fremde Server',
      '+ Kein Einwilligungsbanner erkannt',
      '+ Keine Funde bei fremden Diensten',
      '+ Impressum auf der Startseite | als Abschnitt, ohne eigene Seite',
      '- Pflichtangaben lesen | nicht geprüft, bitte manuell prüfen',
    ]);
    expect(rows('ohne-impressum').slice(3, 6)).toEqual([
      '! 1 fremder Dienst vor der Einwilligung | Google Fonts',
      '! Impressum-Link nicht gefunden | bitte manuell prüfen',
      '- Pflichtangaben lesen | nicht geprüft, kein Impressum geöffnet',
    ]);
  });

  it('Google Fonts requested by the page itself gets the mark at the source code, named in the description', () => {
    const screen = liveScreen(byslug('ohne-impressum'));
    expect(screen.marks.map((m) => [m.place, m.numbers.join(', ')])).toEqual([['source', expect.any(String)]]);
    expect(screen.drawingLabel).toContain('im Quelltext');
  });

  it('a quick check says which parts it did not check and why', () => {
    expect(rows('schnellpruefung')).toEqual([
      '+ Quelltext der Seite gelesen | ohne Browser, so wie Ihr Server ihn ausliefert',
      '- Anfragen aufzeichnen | nicht geprüft, Schnellprüfung ohne Browser',
      '- Einwilligungsbanner suchen | nicht geprüft, Schnellprüfung ohne Browser',
      '- Fremde Dienste vor der Einwilligung prüfen | nicht geprüft, Schnellprüfung ohne Browser',
      '+ Impressum gefunden | unter /impressum/',
      '+ Pflichtangaben gelesen | Anschrift, E-Mail, Handelsregister, USt-IdNr.',
      '- Barrierefreiheit prüfen | nicht geprüft, Schnellprüfung ohne Browser',
      '+ Verschlüsselung und Sicherheits-Header gelesen',
    ]);
    const screen = liveScreen(byslug('schnellpruefung'));
    expect(flat(screen.report?.summary)).toContain(SCAN_TEXTS.summaryQuick);
    expect(screen.status).toBe(SCAN_TEXTS.statusQuick);
  });

  it('blocked, failed and refused: the first row says why, nothing else is checked, no mark, "Bericht öffnen"', () => {
    expect(rows('blockiert')[0]).toBe('- Prüfung blockiert | Ihre Website hat unseren Browser nicht durchgelassen (Antwort 403)');
    expect(rows('zeitlimit')[0]).toBe('- Seite nicht geladen | sie hat nicht rechtzeitig geantwortet');
    expect(rows('serverfehler')[0]).toBe('- Seite nicht geladen | der Server hat mit dem Fehler 500 geantwortet');
    expect(rows('seitenlimit')[0]).toBe('- Seite nicht geladen | sie stellt mehr Anfragen oder liefert mehr Daten, als die Prüfung aufzeichnet');
    expect(rows('keine-webseite')[0]).toBe('- Seite nicht geladen | unter der Adresse liegt keine Webseite, sondern eine Datei');
    expect(rows('nicht-erlaubt')[0]).toBe('- Adresse nicht geprüft | die Seite leitet mehr als fünfmal weiter');
    for (const slug of ['blockiert', 'zeitlimit', 'nicht-erlaubt']) {
      const screen = liveScreen(byslug(slug));
      expect(screen.steps.slice(1).every((s) => s.unchecked && flat(s.detail) === 'nicht geprüft'), slug).toBe(true);
      expect(screen.marks).toEqual([]);
      expect(screen.drawingLabel).toBe(SCAN_TEXTS.drawingUnmeasured);
      expect(screen.report?.label ?? 'Bericht öffnen').toBe('Bericht öffnen');
    }
    expect(liveScreen(byslug('blockiert')).status).toBe(SCAN_TEXTS.statusBlocked);
    expect(flat(liveScreen(byslug('fast-leer')).report?.summary)).toBe(SCAN_TEXTS.summaryAlmostEmpty);
  });

  it('a scan that ended without a report: its own heading, panel and status, "Neue Prüfung" instead of the cancel', () => {
    const cancelled = liveScreen(byslug('abgebrochen'));
    expect(cancelled.action).toBe('new');
    expect(cancelled.status).toBe(SCAN_TEXTS.ended.cancelled.title);
    expect(cancelled.report).toMatchObject({ title: SCAN_TEXTS.ended.cancelled.title, href: '/', label: 'Neue Prüfung' });
    expect(cancelled.steps.every((s) => s.unchecked && s.delay === 0)).toBe(true);
    const html = renderToStaticMarkup(<ScanScreen scan={cancelled} />);
    expect(html).toContain('<bdi>roesterei-muster.de</bdi> wurde nicht nachgemessen');
    expect(html).not.toContain('Prüfung abbrechen');
    expect(html).not.toContain('Bericht öffnen');
    expect(renderToStaticMarkup(<ScanScreen scan={liveScreen(byslug('unbekannt'))} />)).toContain('>Prüfung nicht gefunden</h1>');
    // After the day's cap: the next 00:00 UTC in the visitor's time (01:00 in Berlin in winter).
    expect(flat(liveScreen(byslug('ausgelastet')).report?.summary)).toBe('Diese Prüfung konnte nicht mehr beginnen. Die nächste ist morgen ab 01:00 Uhr möglich.');
  });

  it('no connection: the status line says so while the rows keep waiting', () => {
    const screen = liveScreen(byslug('keine-verbindung'));
    expect(screen.status).toBe(SCAN_TEXTS.statusOffline);
    expect(screen.steps.every((s) => s.delay === null)).toBe(true);
    expect(screen.report).toBeNull();
  });
});

describe('the form: refusals of the API and when to try again', () => {
  it('reads code, rule, limit and Retry-After from the answer (the header first)', () => {
    expect(refusalOf(400, null, { error: 'invalid-address' })).toEqual({ kind: 'invalid' });
    expect(refusalOf(400, null, { error: 'address-not-found' })).toEqual({ kind: 'not-found' });
    expect(refusalOf(400, null, { error: 'address-not-allowed', reason: 'port' })).toEqual({ kind: 'not-allowed', reason: 'port' });
    expect(refusalOf(400, null, { error: 'address-not-allowed', reason: '<script>' })).toEqual({ kind: 'not-allowed', reason: null });
    expect(refusalOf(429, '1260', { error: 'rate-limited', limit: 'day', retryAfterSeconds: 5 })).toEqual({ kind: 'rate', limit: 'day', retryAfter: 1260 });
    expect(refusalOf(429, null, { error: 'rate-limited', limit: 'starts', retryAfterSeconds: 600 })).toEqual({ kind: 'rate', limit: 'starts', retryAfter: 600 });
    expect(refusalOf(503, '39400', { error: 'daily-limit' })).toEqual({ kind: 'busy', retryAfter: 39400 });
    expect(refusalOf(503, '60', { error: 'queue-unavailable' })).toEqual({ kind: 'ours', retryAfter: 60 });
    expect(refusalOf(503, null, { error: 'dns-unavailable' })).toEqual({ kind: 'ours', retryAfter: null });
    expect(refusalOf(415, null, null)).toEqual({ kind: 'ours', retryAfter: null });
    expect(refusalOf(503, 'Wed, 21 Oct 2026 07:28:00 GMT', { error: 'daily-limit' })).toEqual({ kind: 'busy', retryAfter: null });
    expect(refusalOf(503, '999999999', { error: 'daily-limit' })).toEqual({ kind: 'busy', retryAfter: null });
  });

  it('the time in the visitor\'s own zone, rounded up to the minute: today, tomorrow or a date', () => {
    const now = EXAMPLE_NOW; // 14:03:20 in Berlin
    expect(whenText(now + 1260_000, now, EXAMPLE_TIME_ZONE)).toBe('ab 14:25 Uhr');
    expect(whenText(now + 1_000, now, EXAMPLE_TIME_ZONE)).toBe('ab 14:04 Uhr');
    expect(whenText(nextUtcDay(now), now, EXAMPLE_TIME_ZONE)).toBe('morgen ab 01:00 Uhr');
    expect(whenText(nextUtcDay(now), now, 'America/New_York')).toBe('ab 19:00 Uhr');
    expect(whenText(now + 3 * 86_400_000, now, EXAMPLE_TIME_ZONE)).toBe('am 27.11. ab 14:04 Uhr');
  });

  it('every example state has its message; address problems mark the field invalid, limits do not', () => {
    const messages = EXAMPLE_FORM_STATES.map((e) => [e.slug, formMessage(e.problem, EXAMPLE_TIME_ZONE), isAddressProblem(e.problem.problem)]);
    expect(messages).toEqual([
      ['leer', SCAN_TEXTS.form.empty, true],
      ['ungueltig', SCAN_TEXTS.form.invalid, true],
      ['nicht-gefunden', SCAN_TEXTS.form.notFound, true],
      ['port', SCAN_TEXTS.form.notAllowed.port, true],
      ['nicht-oeffentlich', SCAN_TEXTS.form.notAllowed['host-name'], true],
      ['stunde', 'Sie haben in dieser Stunde so viele Prüfungen gestartet, wie wir einem Besucher erlauben. Die nächste ist ab 14:25 Uhr möglich.', false],
      ['tag', 'Sie haben heute so viele Prüfungen gestartet, wie wir einem Besucher an einem Tag erlauben. Die nächste ist morgen ab 01:00 Uhr möglich.', false],
      ['starts', 'Sie haben in kurzer Zeit sehr viele Prüfungen gestartet. Die nächste ist ab 14:14 Uhr möglich.', false],
      ['ausgelastet', 'Heute sind alle Prüfungen vergeben. Die nächste ist morgen ab 01:00 Uhr möglich.', false],
      ['fehler', 'Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es ab 14:05 Uhr noch einmal.', false],
      ['keine-antwort', 'Bei uns ist gerade ein Fehler aufgetreten. Bitte versuchen Sie es in einigen Minuten noch einmal.', false],
    ]);
  });

  it('no text of the session uses a forbidden word of the brief', () => {
    const all = JSON.stringify(SCAN_TEXTS) + EXAMPLE_FORM_STATES.map((e) => formMessage(e.problem, EXAMPLE_TIME_ZONE)).join(' ');
    for (const word of ['verstoßen', 'illegal', 'rechtswidrig', 'Abmahn', 'rechtssicher', 'garantiert', 'DSGVO-konform']) expect(all).not.toContain(word);
  });
});
