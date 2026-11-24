import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';

/**
 * The quick check without a browser (session A5 part 3): homepage and Impressum fetched under the SSRF
 * rules and read as HTML. Invented firm, a fake resolver and a fake fetch: nothing leaves the machine.
 */

const SITE = 'https://www.muster-werkstatt.de/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const guard = () => createUrlGuard({ resolve: async (host) => (host === 'intern.muster-werkstatt.de' ? ['10.0.0.8'] : ['93.184.215.14']) });

const HOME = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster Werkstatt – Reparaturen in Musterhausen</title>
<meta name="generator" content="WordPress 6.9"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato"></head>
<body><header><nav><a href="/leistungen/">Leistungen</a></nav></header><main><h1>Muster Werkstatt</h1><p>Ihre Werkstatt in Musterhausen.</p></main>
<footer><a href="/impressum/">Impressum</a> <a href="/datenschutz/">Datenschutz</a></footer></body></html>`;

const IMPRESSUM = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Impressum</title></head><body><main><h1>Impressum</h1>
<p>Angaben gemäß § 5 DDG</p><p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p>
<p>E-Mail: kontakt [at] muster-werkstatt.de</p><p>Handelsregister: HRB 12345, Amtsgericht Beispielburg</p>
<p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: DE123456789</p></main></body></html>`;

type Route = (url: string) => Response | Promise<Response>;

function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return route(url);
  }) as typeof fetch;
  return { fn, calls };
}

const page = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

function normalSite(extra: Record<string, Route> = {}) {
  return fakeFetch({
    [SITE]: page(HOME, { 'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff' }),
    [`${SITE}impressum/`]: page(IMPRESSUM),
    'http://www.muster-werkstatt.de/': () => new Response(null, { status: 301, headers: { location: SITE } }),
    ...extra,
  });
}

function report(capture: Awaited<ReturnType<typeof quickCapture>>) {
  return buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T10:00:00.000Z', siteUrl: SITE, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated }).report;
}

describe('quick check without a browser', () => {
  it('reads the homepage and the Impressum from the HTML and gives a quick report that validates', async () => {
    const f = normalSite();
    const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: f.fn, visit: { country: 'DE', colo: 'FRA', source: 'object-trace' } });
    expect(capture).toMatchObject({ adapter: 'quick-fetch', ok: true, failure: null, finalUrl: SITE });
    expect(capture.timings.stopReason).toBe('fetched');
    expect(capture.requests).toHaveLength(1);
    expect(capture.axe).toBeNull();
    expect(capture.page?.links.find((l) => l.text === 'Impressum')).toMatchObject({ href: `${SITE}impressum/`, footer: true });
    expect(capture.impressum).toMatchObject({ ok: true, url: `${SITE}impressum/`, status: 200 });
    expect(capture.impressum?.page?.text).toContain('87654 Musterhausen');
    expect(capture.httpProbe?.outcome).toBe('redirects-to-https');
    // Only the homepage, the Impressum and the http address: no other page, no script, no stylesheet.
    expect(f.calls.sort()).toEqual(['http://www.muster-werkstatt.de/', SITE, `${SITE}impressum/`].sort());

    const r = report(capture);
    expect(validateReport(r)).toEqual([]);
    expect(r.state).toBe('quick');
    expect(r.notice).toEqual({ textId: 'report-quick-incomplete', params: {} });
    expect(r.visit).toMatchObject({ country: 'DE', colo: 'FRA', adapter: 'quick-fetch', browser: null });
    expect(r.sections.thirdParty).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(r.sections.accessibility).toEqual({ status: 'not-checked', reason: 'quick-check' });
    // A Google Fonts link in the HTML is no finding without a browser: no request was made.
    expect(r.findings.some((x) => x.area === 'privacy')).toBe(false);
    expect(r.services).toEqual([]);
    expect(r.pages).toEqual({ homepage: 'checked', impressum: 'checked' });
    expect(r.measures.find((m) => m.id === 'impressum-fields')?.actual).toEqual({ type: 'of', count: 4, total: 4 });
    expect(r.measures.find((m) => m.id === 'security-headers')?.actual).toEqual({ type: 'of', count: 2, total: 5 });
    expect(r.platform?.system).toBe('wordpress');
  });

  it('refuses an internal address before anything is fetched', async () => {
    const f = normalSite();
    for (const url of ['http://127.0.0.1/', 'https://intern.muster-werkstatt.de/', 'http://www.muster-werkstatt.de:8080/']) {
      const capture = await quickCapture(url, { guard: guard(), userAgent: UA, fetch: f.fn });
      expect(capture.ok).toBe(false);
      expect(capture.failure?.reason).toBe('not-allowed');
    }
    expect(f.calls).toEqual([]);
  });

  it('refuses a redirect to an internal address before it is requested', async () => {
    const f = normalSite({ [SITE]: () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.8/admin' } }) });
    const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: f.fn, httpProbe: false });
    expect(capture.failure?.reason).toBe('not-allowed');
    expect(f.calls).toEqual([SITE]);
    expect(report(capture).state).toBe('not-allowed');
  });

  it('refuses an Impressum link to an internal address, the homepage stays checked', async () => {
    const home = HOME.replace('href="/impressum/"', 'href="https://intern.muster-werkstatt.de/impressum"');
    const f = normalSite({ [SITE]: page(home) });
    const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: f.fn, httpProbe: false });
    expect(capture.ok).toBe(true);
    expect(capture.impressum?.failure?.reason).toBe('not-allowed');
    expect(f.calls).toEqual([SITE]);
  });

  it('recognises a check page as blocked and gives no findings', async () => {
    const f = normalSite({ [SITE]: page('<!doctype html><html><head><title>Einen Moment bitte…</title></head><body><p>Bitte warten</p></body></html>') });
    const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: f.fn, httpProbe: false });
    const r = report(capture);
    expect(r.state).toBe('blocked');
    expect(r.findings).toEqual([]);
  });

  it('reports HTTP errors, a body over 2 MB, a timeout and a network error as a failed check, never as a clean site', async () => {
    const cases: [Route, string][] = [
      [() => new Response('Fehler', { status: 500, headers: { 'content-type': 'text/html' } }), 'http-error'],
      [() => new Response('x'.repeat(2 * 1024 * 1024 + 10), { status: 200, headers: { 'content-type': 'text/html' } }), 'other'],
      [
        () => {
          // Session fix-a5 (finding 32): the error as Node's fetch gives it for a refused connection, with its cause.
          throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 192.0.2.1:80'), { code: 'ECONNREFUSED' }) });
        },
        'unreachable',
      ],
    ];
    for (const [route, reason] of cases) {
      const f = normalSite({ [SITE]: route });
      const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: f.fn, httpProbe: false });
      expect(capture.ok, reason).toBe(false);
      expect(capture.failure?.reason).toBe(reason);
      const r = report(capture);
      expect(r.state).toBe('failed');
      expect(r.findings).toEqual([]);
      expect(validateReport(r)).toEqual([]);
    }
    const slow = fakeFetch({ [SITE]: () => new Promise<Response>(() => undefined) });
    const capture = await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: slow.fn, httpProbe: false, timeoutMs: 50 });
    expect(capture.failure?.reason).toBe('timeout');
  });

  it('sends only the user agent, Accept and Accept-Language: no cookies, no authorization', async () => {
    const seen: Record<string, string>[] = [];
    const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])));
      return new Response(HOME, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    await quickCapture(SITE, { guard: guard(), userAgent: UA, fetch: fn, httpProbe: false, impressum: false });
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['accept', 'accept-language', 'user-agent']);
  });
});
