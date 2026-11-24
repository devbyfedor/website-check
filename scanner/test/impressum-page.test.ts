import { describe, expect, it } from 'vitest';
import type { PageSnapshot } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { checkImpressumPage } from '../src/legal/impressum-page.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';

/**
 * Session fix-a3, review finding 6: a page with HTTP 200 behind the Impressum link is not yet a read
 * Impressum. The cases run through the quick check (the production code without a browser) with a fake
 * resolver and a fake fetch; the same pages run through Chromium in `test/integration/legal.test.ts`.
 * Invented firm on a reserved `.example` name.
 */

const SITE = 'https://www.muster-werkstatt.example/';
const BARE = 'https://muster-werkstatt.example/';
const IMP = `${SITE}impressum/`;
const guard = () => createUrlGuard({ resolve: async () => ['93.184.215.14'], exempt: (url) => url.hostname.endsWith('.example') });

const FOOT_SHORT = '<p>Muster Werkstatt GmbH · Erlenweg 12 · 12345 Musterhausen · info@muster-werkstatt.example</p>';
const FOOT_FULL = '<p>Muster Werkstatt GmbH<br>Erlenweg 12<br>12345 Musterhausen</p><p>E-Mail: info@muster-werkstatt.example</p><p>Amtsgericht Musterhausen, HRB 4711 · USt-IdNr. DE123456788</p>';
const shell = (title: string, main: string, foot: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head>
<body><header><nav><a href="/">Start</a> <a href="/leistungen/">Leistungen</a> <a href="/kontakt/">Kontakt</a></nav></header>
<main>${main}</main>
<footer>${foot}<p><a href="/impressum/">Impressum</a> <a href="/datenschutz/">Datenschutz</a></p></footer></body></html>`;
// Long enough not to be an "almost empty" page.
const INTRO = `<p>${'Ihre Werkstatt in Musterhausen für Reparaturen aller Art. '.repeat(40)}</p>`;
const home = (foot: string) => shell('Muster Werkstatt – Reparaturen in Musterhausen', `<h1>Muster Werkstatt</h1>${INTRO}`, foot);
const soft404 = (foot: string) => shell('Seite nicht gefunden – Muster Werkstatt', '<h1>Seite nicht gefunden</h1><p>Die angeforderte Seite existiert leider nicht.</p>', foot);
const kontakt = (foot: string) => shell('Kontakt – Muster Werkstatt', '<h1>Kontakt</h1><p>Schreiben Sie uns über das Formular.</p><form><input name="n"><button>Senden</button></form>', foot);
const login = (foot: string) => shell('Anmelden – Muster Werkstatt', '<h1>Bitte melden Sie sich an</h1><form><input name="u"><input type="password" name="p"><button>Anmelden</button></form>', foot);
const realImpressum = (title = 'Impressum – Muster Werkstatt') =>
  shell(title, '<h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p><p>Muster Werkstatt GmbH<br>Erlenweg 12<br>12345 Musterhausen</p><p>E-Mail: info@muster-werkstatt.example</p><p>Amtsgericht Musterhausen, HRB 4711</p><p>USt-IdNr. DE123456788</p>', FOOT_SHORT);

type Route = () => Response;
const ok = (body: string): Route => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const status = (code: number, body: string): Route => () => new Response(body, { status: code, headers: { 'content-type': 'text/html; charset=utf-8' } });
const to = (location: string): Route => () => new Response(null, { status: 302, headers: { location } });

async function run(routes: Record<string, Route>) {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    return route === undefined ? new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } }) : route();
  }) as typeof fetch;
  const capture = await quickCapture(SITE, { guard: guard(), userAgent: 'Mozilla/5.0 test', fetch: fetchFn, httpProbe: false });
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SITE, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  const fields = built.report.legal?.fields;
  return {
    state: built.analysis.legal?.impressum.state,
    page: built.report.pages.impressum,
    measure: built.report.measures.find((m) => m.id === 'impressum-fields'),
    found: fields === undefined ? [] : Object.entries(fields).filter(([, f]) => f.status === 'found').map(([k]) => k),
    check: built.report.findings.find((f) => f.id === 'legal:impressum')?.textId ?? null,
  };
}

describe('finding 6: HTTP 200 behind the Impressum link is not yet a read Impressum', () => {
  it('a soft 404 (HTTP 200, "Seite nicht gefunden") with the firm\'s data in the footer is not read', async () => {
    for (const foot of [FOOT_SHORT, FOOT_FULL]) {
      const r = await run({ [SITE]: ok(home(foot)), [IMP]: ok(soft404(foot)) });
      expect(r.state).toBe('failed');
      expect(r.page).toBe('not-checked');
      expect(r.found).toEqual([]);
      expect(r.measure).toMatchObject({ result: 'manual', actual: null });
      expect(r.check).toBe('legal-impressum-failed');
    }
  });

  it('the homepage under another address (query, index.html, without www) is not read', async () => {
    for (const target of [`${SITE}?lang=de`, `${SITE}index.html`, BARE]) {
      const r = await run({ [SITE]: ok(home(FOOT_FULL)), [IMP]: to(target), [target]: ok(home(FOOT_FULL)) });
      expect(r.state, target).toBe('failed');
      expect(r.found, target).toEqual([]);
      expect(r.measure, target).toMatchObject({ result: 'manual', actual: null });
    }
  });

  it('a contact page or a login behind the link is not read', async () => {
    for (const [target, body] of [[`${SITE}kontakt/`, kontakt(FOOT_FULL)], [`${SITE}login?next=%2Fimpressum%2F`, login(FOOT_FULL)]] as const) {
      const r = await run({ [SITE]: ok(home(FOOT_FULL)), [IMP]: to(target), [target]: ok(body) });
      expect(r.state, target).toBe('failed');
      expect(r.found, target).toEqual([]);
    }
  });

  it('controls: a real Impressum is read; HTTP 404 and the exact homepage fail as before', async () => {
    const real = await run({ [SITE]: ok(home(FOOT_SHORT)), [IMP]: ok(realImpressum()) });
    expect(real).toMatchObject({ state: 'analyzed', page: 'checked', found: ['address', 'email', 'handelsregister', 'ustId'], check: null });
    expect(real.measure).toMatchObject({ result: 'pass', actual: { type: 'of', count: 4, total: 4 } });
    // The same Impressum on a site whose pages all carry one title: the heading and the legal sentence are the sign.
    const sameTitle = await run({ [SITE]: ok(home(FOOT_SHORT)), [IMP]: ok(realImpressum('Muster Werkstatt – Reparaturen in Musterhausen')) });
    expect(sameTitle).toMatchObject({ state: 'analyzed', found: ['address', 'email', 'handelsregister', 'ustId'] });
    expect((await run({ [SITE]: ok(home(FOOT_SHORT)), [IMP]: status(404, soft404(FOOT_SHORT)) })).state).toBe('failed');
    expect((await run({ [SITE]: ok(home(FOOT_SHORT)), [IMP]: to(SITE) })).state).toBe('failed');
  });
});

describe('checkImpressumPage', () => {
  const snap = (title: string, text: string, links: { href: string; text: string }[] = [{ href: IMP, text: 'Impressum' }]): PageSnapshot => ({ url: IMP, title, lang: 'de', text, textTruncated: false, links, linksTruncated: false });
  const homepage = snap('Muster Werkstatt', 'Muster Werkstatt\nIhre Werkstatt.\nImpressum');

  it('needs a sign of an Impressum: the title, a sentence of a legal notice, or the word outside the link texts', () => {
    expect(checkImpressumPage(snap('Impressum | Muster', 'Muster GmbH\nImpressum'), homepage)).toEqual({ impressum: true });
    expect(checkImpressumPage(snap('Muster', 'Angaben gemäß § 5 TMG\nMuster GmbH\nImpressum'), homepage)).toEqual({ impressum: true });
    expect(checkImpressumPage(snap('Muster', 'Impressum\nMuster GmbH\nErlenweg 12\nImpressum'), homepage)).toEqual({ impressum: true });
    expect(checkImpressumPage(snap('Legal Notice', 'Muster Ltd.'), homepage)).toEqual({ impressum: true });
    // The word only as the text of the footer link, as on every page of the site.
    expect(checkImpressumPage(snap('Kontakt', 'Kontakt\nSchreiben Sie uns.\nImpressum'), homepage)).toMatchObject({ impressum: false, reason: 'no-sign' });
    // A soft hyphen in the heading does not hide the sign.
    expect(checkImpressumPage(snap('Muster', 'Im­pressum\nMuster GmbH\nImpressum'), homepage)).toEqual({ impressum: true });
  });

  it('an error page is never an Impressum, also when its address and its footer carry the word', () => {
    expect(checkImpressumPage(snap('Seite nicht gefunden', 'Seite nicht gefunden\nImpressum'), homepage)).toMatchObject({ impressum: false, reason: 'error-page' });
    expect(checkImpressumPage(snap('Impressum', 'Fehler 404\nDie Seite existiert nicht.\nImpressum'), homepage)).toMatchObject({ impressum: false, reason: 'error-page' });
    expect(checkImpressumPage(snap('Muster', 'Die angeforderte Seite wurde leider nicht gefunden.\nImpressum\nImpressum'), homepage)).toMatchObject({ impressum: false, reason: 'error-page' });
    expect(checkImpressumPage(snap('Page not found – Muster', 'Imprint\nOops'), homepage)).toMatchObject({ impressum: false, reason: 'error-page' });
  });

  it('the homepage again (same title and text) is not an Impressum, also when its text says the word twice', () => {
    const twice = snap('Muster Werkstatt', 'Muster Werkstatt\nMehr im Impressum.\nImpressum');
    expect(checkImpressumPage({ ...twice, url: `${SITE}?lang=de` }, twice)).toMatchObject({ impressum: false, reason: 'homepage' });
  });

  it('a long sentence of a real Impressum that mentions a page that is not available is no error sign', () => {
    const text = `Impressum\nAngaben gemäß § 5 DDG\nMuster GmbH\n${'Haftung für Links: Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen, auch wenn eine verlinkte Seite nicht mehr verfügbar ist.'}`;
    expect(checkImpressumPage(snap('Impressum', text), homepage)).toEqual({ impressum: true });
  });
});
