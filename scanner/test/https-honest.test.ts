import { describe, expect, it } from 'vitest';
import { analyzeSecurity } from '../src/analyzers/security.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { HTTP_PROBE_BODY_LIMIT, httpsVariantOf, probeHttpRedirect, probeHttps, refreshTargetOf, scanPageStart, scriptMayRedirect } from '../src/security/http-probe.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';
import type { HttpProbe, HttpsProbe } from '../src/security/types.ts';
import { makeCapture } from './helpers.ts';
import { shopCapture } from './report-helpers.ts';

/**
 * Session fix-a2, review findings 18 and 19: "Seite ohne HTTPS" and "Keine Weiterleitung von http:// auf
 * https://" are said only when the scan really checked it. The cases are the ones of the review's
 * reproductions, with an invented site, a fake resolver and a fake fetch: nothing leaves the machine.
 */

const HOST = 'www.muster-werkstatt.de';
const HTTP_SITE = `http://${HOST}/`;
const HTTPS_SITE = `https://${HOST}/`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const guard = () => createUrlGuard({ resolve: async () => ['93.184.215.14'] });

const HOME = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster Werkstatt</title></head>
<body><main><h1>Muster Werkstatt</h1><p>${'Ihre Werkstatt in Musterhausen. '.repeat(30)}</p></main>
<footer><a href="/impressum/">Impressum</a> <a href="/datenschutz/">Datenschutz</a></footer></body></html>`;
const IMPRESSUM = '<!doctype html><html lang="de"><head><title>Impressum</title></head><body><h1>Impressum</h1><p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p><p>E-Mail: info@muster-werkstatt.de</p></body></html>';

type Answer = { status: number; body?: string; headers?: Record<string, string> } | Error;

/** A fake fetch by exact address; counts the requests per scheme, as the review's reproduction does. */
function fakeFetch(routes: Record<string, Answer | ((url: URL) => Answer)>) {
  const asked: Record<string, number> = { 'http:': 0, 'https:': 0 };
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    asked[url.protocol] = (asked[url.protocol] ?? 0) + 1;
    const route = routes[url.href] ?? routes[`${url.protocol}//*`];
    if (route === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    const answer = typeof route === 'function' ? route(url) : route;
    if (answer instanceof Error) throw answer;
    const empty = answer.status === 204 || (answer.status >= 300 && answer.status < 400);
    return new Response(empty ? null : (answer.body ?? ''), { status: answer.status, headers: { 'content-type': 'text/html; charset=utf-8', ...answer.headers } });
  }) as typeof fetch;
  return { fn, asked, calls };
}

const pages = (url: URL): Answer => ({ status: 200, body: url.pathname === '/impressum/' ? IMPRESSUM : HOME, headers: url.protocol === 'https:' ? { 'strict-transport-security': 'max-age=31536000' } : {} });

function reportOf(capture: Awaited<ReturnType<typeof quickCapture>>, siteUrl: string, mode: 'quick' | 'full' = 'quick'): Report {
  const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T10:00:00.000Z', siteUrl, mode, capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(report)).toEqual([]);
  return report;
}

const securityFindings = (r: Report) => r.findings.filter((f) => f.area === 'security').map((f) => [f.id, f.kind, f.risk, f.textId]);
const measure = (r: Report, id: string) => r.measures.find((m) => m.id === id);

describe('finding 18: an address entered with http://', () => {
  it('the scan asks https:// itself; a site that answers there has HTTPS, only the missing redirect is a finding', async () => {
    const f = fakeFetch({ 'http://*': pages, 'https://*': pages });
    const capture = await quickCapture(HTTP_SITE, { guard: guard(), userAgent: UA, fetch: f.fn });
    expect(capture.finalUrl).toBe(HTTP_SITE);
    expect(f.asked['https:']).toBe(1);
    expect(capture.httpsProbe).toMatchObject({ url: HTTPS_SITE, outcome: 'answers', status: 200 });
    const r = reportOf(capture, HTTP_SITE);
    expect(r.security).toMatchObject({ https: 'pass', httpRedirect: 'fail' });
    expect(securityFindings(r).filter(([id]) => id === 'security:https')).toEqual([]);
    expect(r.findings.filter((x) => x.risk === 'high')).toEqual([]);
    expect(securityFindings(r)).toContainEqual(['security:http-redirect', 'finding', 'medium', 'security-http-no-redirect']);
    expect(measure(r, 'https')).toMatchObject({ result: 'pass', actual: { type: 'state', state: 'https' } });
    expect(analyzeSecurity(capture).https.textId).toBe('security-https-available');
  });

  it('"Seite ohne HTTPS" stays when https:// was asked and the connection was refused, or the site sent the visitor back to http://', async () => {
    // Node's fetch names a refused connection in the cause of its error.
    const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 93.184.215.14:443'), { code: 'ECONNREFUSED' }) });
    const down = fakeFetch({ 'http://*': pages, 'https://*': refused });
    const noHttps = await quickCapture(HTTP_SITE, { guard: guard(), userAgent: UA, fetch: down.fn });
    expect(down.asked['https:']).toBe(1);
    expect(noHttps.httpsProbe).toMatchObject({ outcome: 'refused' });
    expect(securityFindings(reportOf(noHttps, HTTP_SITE))).toContainEqual(['security:https', 'finding', 'high', 'security-https-missing']);

    const back = fakeFetch({ 'http://*': pages, 'https://*': { status: 301, headers: { location: HTTP_SITE } } });
    const sentBack = await quickCapture(HTTP_SITE, { guard: guard(), userAgent: UA, fetch: back.fn });
    expect(sentBack.httpsProbe).toMatchObject({ outcome: 'redirects-to-http', location: HTTP_SITE });
    expect(securityFindings(reportOf(sentBack, HTTP_SITE))).toContainEqual(['security:https', 'finding', 'high', 'security-https-missing']);
  });

  it('no clear answer on https:// is "bitte manuell prüfen", never "ohne HTTPS"', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    // A certificate the client does not accept, or a connection that is reset: the site may have HTTPS (broken, or
    // protected against automated requests), so neither is "ohne HTTPS".
    const certificate = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }) });
    const reset = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
    for (const [answer, outcome] of [[{ status: 403 }, 'http-error'], [timeout, 'timeout'], [{ status: 302 }, 'stopped'], [certificate, 'unavailable'], [reset, 'unavailable'], [new TypeError('fetch failed'), 'unavailable']] as const) {
      const f = fakeFetch({ 'http://*': pages, 'https://*': answer });
      const capture = await quickCapture(HTTP_SITE, { guard: guard(), userAgent: UA, fetch: f.fn });
      expect(capture.httpsProbe?.outcome).toBe(outcome);
      const r = reportOf(capture, HTTP_SITE);
      expect(securityFindings(r)).toContainEqual(['security:https', 'manual', null, 'security-https-manual']);
      expect(measure(r, 'https')).toMatchObject({ result: 'manual', actual: { type: 'state', state: 'unknown' } });
      expect(r.findings.filter((x) => x.risk === 'high')).toEqual([]);
    }
  });

  it('a capture that stayed on http:// and never asked https:// (saved before the fix) is a manual check', () => {
    const stayed = makeCapture({ requests: [], requestedUrl: HTTP_SITE, finalUrl: HTTP_SITE });
    expect(analyzeSecurity(stayed).https).toEqual({ result: 'manual', finalUrl: HTTP_SITE, textId: 'security-https-manual' });
    expect(analyzeSecurity({ ...stayed, httpsProbe: null }).https.result).toBe('manual');
    // The same in a full report (the review's synthetic capture of a browser that stayed on http://).
    const base = shopCapture();
    const swap = (u: string): string => (u.startsWith('https://www.roesterei-muster.example') ? `http://${u.slice('https://'.length)}` : u);
    const page = base.page as NonNullable<typeof base.page>;
    const full = {
      ...base,
      requestedUrl: swap(base.requestedUrl),
      finalUrl: swap(base.finalUrl as string),
      requests: base.requests.map((r) => ({ ...r, url: swap(r.url) })),
      page: { ...page, url: swap(page.url as string), links: page.links.map((l) => ({ ...l, href: swap(l.href) })) },
      httpProbe: { url: swap(base.requestedUrl), startedAt: '2026-11-20T12:00:00.000Z', outcome: 'no-redirect' as const, hops: [], httpsTarget: null, durationMs: 40 },
    };
    const r = reportOf(full, swap(base.requestedUrl), 'full');
    expect(securityFindings(r)).toContainEqual(['security:https', 'manual', null, 'security-https-manual']);
    expect(r.priorities).not.toContain('security:https');
    const asked: HttpsProbe = { url: 'https://www.roesterei-muster.example/', startedAt: '', outcome: 'answers', status: 200, location: null, error: null, durationMs: 30 };
    expect(reportOf({ ...full, httpsProbe: asked }, swap(base.requestedUrl), 'full').security?.https).toBe('pass');
    expect(securityFindings(reportOf({ ...full, httpsProbe: { ...asked, outcome: 'refused', status: null } }, swap(base.requestedUrl), 'full'))).toContainEqual(['security:https', 'finding', 'high', 'security-https-missing']);
  });

  it('the request to https:// says nothing about another host the page ended on', () => {
    const asked: HttpsProbe = { url: 'https://example.de/', startedAt: '', outcome: 'answers', status: 200, location: null, error: null, durationMs: 30 };
    const moved = makeCapture({ requests: [], requestedUrl: 'http://example.de/', finalUrl: 'http://www.other-host.example/start', httpsProbe: asked });
    expect(analyzeSecurity(moved).https).toMatchObject({ result: 'manual', textId: 'security-https-manual' });
    expect(analyzeSecurity({ ...moved, httpsProbe: { ...asked, outcome: 'refused', status: null } }).https.result).toBe('manual');
    // The same host with and without "www." is the same site.
    expect(analyzeSecurity({ ...moved, finalUrl: 'http://www.example.de/start' }).https).toMatchObject({ result: 'pass', textId: 'security-https-available' });
  });

  it('an address entered with https:// that ends on http:// is "ohne HTTPS": https:// was asked', () => {
    const sent = makeCapture({ requests: [], requestedUrl: HTTPS_SITE, finalUrl: HTTP_SITE });
    expect(analyzeSecurity(sent).https).toMatchObject({ result: 'fail', textId: 'security-https-missing' });
  });

  it('an address entered with https:// gets no extra request', async () => {
    const f = fakeFetch({ 'https://*': pages, [HTTP_SITE]: { status: 301, headers: { location: HTTPS_SITE } } });
    const capture = await quickCapture(HTTPS_SITE, { guard: guard(), userAgent: UA, fetch: f.fn });
    expect(capture.httpsProbe).toBeUndefined();
    expect(f.calls.filter((u) => u === HTTPS_SITE)).toHaveLength(1);
    expect(reportOf(capture, HTTPS_SITE).security).toMatchObject({ https: 'pass', httpRedirect: 'pass' });
    expect(httpsVariantOf('https://www.example.de/')).toBeNull();
    expect(httpsVariantOf('http://www.example.de:8080/start#top')).toBe('https://www.example.de/start');
    expect(httpsVariantOf('ftp://www.example.de/')).toBeNull();
  });

  it('probeHttps asks once, follows nothing, and never opens an address that is not allowed', async () => {
    const f = fakeFetch({ [HTTPS_SITE]: { status: 301, headers: { location: 'https://muster-werkstatt.de/' } } });
    expect(await probeHttps(HTTPS_SITE, { guard: guard(), fetch: f.fn })).toMatchObject({ outcome: 'answers', status: 301, location: 'https://muster-werkstatt.de/' });
    expect(f.calls).toEqual([HTTPS_SITE]);
    const none = fakeFetch({});
    expect((await probeHttps(HTTP_SITE, { guard: guard(), fetch: none.fn })).outcome).toBe('stopped');
    const internal = createUrlGuard({ resolve: async () => ['10.0.0.7'] });
    expect(await probeHttps(HTTPS_SITE, { guard: internal, fetch: none.fn })).toMatchObject({ outcome: 'stopped' });
    expect(none.calls).toEqual([]);
  });
});

const META = `<!doctype html><html><head><meta http-equiv="refresh" content="0; url=${HTTPS_SITE}"></head><body></body></html>`;
const SCRIPT = "<!doctype html><html><head><script>location.replace('https://' + location.host + location.pathname)</script></head><body></body></html>";

describe('finding 19: an answer 200 on http:// that redirects inside the page', () => {
  const probe = (answer: Answer) => probeHttpRedirect(HTTP_SITE, { guard: guard(), fetch: fakeFetch({ [HTTP_SITE]: answer }).fn });
  const redirectOf = (p: HttpProbe) => analyzeSecurity(shopCapture({ httpProbe: p })).httpRedirect;

  it('a meta refresh or a Refresh header to https:// is a redirect in the browser, not a missing one', async () => {
    for (const answer of [{ status: 200, body: META }, { status: 200, body: '<!doctype html><html><body></body></html>', headers: { refresh: `0; url=${HTTPS_SITE}` } }]) {
      const p = await probe(answer);
      expect(p).toMatchObject({ outcome: 'redirects-in-page', httpsTarget: HTTPS_SITE });
      expect(p.hops.map((h) => [h.status, h.location])).toEqual([[200, HTTPS_SITE]]);
      expect(redirectOf(p)).toMatchObject({ result: 'info', textId: 'security-http-redirect-in-page' });
    }
  });

  it('a script that switches the address to https is "bitte manuell prüfen": only a browser can tell', async () => {
    const p = await probe({ status: 200, body: SCRIPT });
    expect(p.outcome).toBe('script-may-redirect');
    expect(redirectOf(p)).toMatchObject({ result: 'manual', textId: 'security-http-redirect-manual' });
  });

  it('controls: a plain page is "no redirect", a 301 to https:// is the redirect', async () => {
    const plain = await probe({ status: 200, body: HOME });
    expect(plain.outcome).toBe('no-redirect');
    expect(redirectOf(plain)).toMatchObject({ result: 'fail', textId: 'security-http-no-redirect' });
    const moved = await probe({ status: 301, headers: { location: HTTPS_SITE } });
    expect(moved.outcome).toBe('redirects-to-https');
    expect(redirectOf(moved)).toMatchObject({ result: 'pass' });
  });

  it('in the report: no finding and nothing in "Drei Dinge" for a redirect inside the page', async () => {
    for (const [body, kind, textId] of [[META, 'hint', 'security-http-redirect-in-page'], [SCRIPT, 'manual', 'security-http-redirect-manual']] as const) {
      const f = fakeFetch({ 'https://*': pages, [HTTP_SITE]: { status: 200, body } });
      const capture = await quickCapture(HTTPS_SITE, { guard: guard(), userAgent: UA, fetch: f.fn });
      const r = reportOf(capture, HTTPS_SITE);
      expect(securityFindings(r).filter(([id]) => id === 'security:http-redirect')).toEqual([['security:http-redirect', kind, null, textId]]);
      expect(r.priorities).not.toContain('security:http-redirect');
      // The same probe result in a full report.
      const full = reportOf(shopCapture({ httpProbe: capture.httpProbe ?? null }), 'https://www.roesterei-muster.example/', 'full');
      expect(full.findings.find((x) => x.id === 'security:http-redirect')).toMatchObject({ kind, risk: null, textId });
    }
    // Control: a plain page on http:// is still the finding.
    const f = fakeFetch({ 'https://*': pages, [HTTP_SITE]: { status: 200, body: HOME } });
    const r = reportOf(await quickCapture(HTTPS_SITE, { guard: guard(), userAgent: UA, fetch: f.fn }), HTTPS_SITE);
    expect(securityFindings(r)).toContainEqual(['security:http-redirect', 'finding', 'medium', 'security-http-no-redirect']);
  });

  it('what does not redirect a browser does not count: noscript, comments, script text, a target on http://', async () => {
    const not = [
      `<html><head><noscript><meta http-equiv="refresh" content="0; url=${HTTPS_SITE}"></noscript></head><body>${HOME}</body></html>`,
      `<html><head><!-- <meta http-equiv="refresh" content="0; url=${HTTPS_SITE}"> --></head><body></body></html>`,
      `<html><head><script type="application/json">{"hint":"<meta http-equiv=refresh content='0;url=${HTTPS_SITE}'>"}</script></head><body></body></html>`,
      '<html><head><meta http-equiv="refresh" content="30"></head><body></body></html>',
      // A script that opens another page on a click, and one that only reads the address.
      "<html><body><button id=b>Shop</button><script>document.getElementById('b').onclick = function () { location.href = '/shop'; };</script><script>var page = 'https://example.de/' + location.pathname;</script></body></html>",
    ];
    for (const body of not) expect((await probe({ status: 200, body })).outcome, body.slice(0, 60)).toBe('no-redirect');
  });

  it('a refresh to another http:// address is a manual check: what comes there was not looked at', async () => {
    for (const target of [`http://${HOST}/start`, '/start']) {
      const p = await probe({ status: 200, body: `<html><head><meta http-equiv="refresh" content="0; url=${target}"></head><body></body></html>` });
      expect(p.outcome, target).toBe('refresh-to-http');
      expect(redirectOf(p)).toMatchObject({ result: 'manual', textId: 'security-http-redirect-manual' });
    }
  });

  it('reads pages as browsers do: odd letters, empty comments, quoted values, the onload of the body, UTF-16', async () => {
    const meta = `<meta http-equiv="refresh" content="0; url=${HTTPS_SITE}">`;
    const inPage = [
      // U+0130 gets longer in lower case; positions in the page must not shift.
      `<html><head><title>${'\u0130'.repeat(40)}</title>${meta}</head><body></body></html>`,
      `<html><head><!-->${meta}</head><body></body></html>`,
      `<html><head><meta http-equiv="refresh" content="0; url=${HTTPS_SITE}?a>b"></head><body></body></html>`,
      `<html><head><meta name="description" content="a > b">${meta}</head><body></body></html>`,
    ];
    for (const body of inPage) expect((await probe({ status: 200, body })).outcome, body.slice(0, 50)).toBe('redirects-in-page');
    const scripted = [
      `<html><head><title>${'\u0130'.repeat(40)}</title><script>location.replace('https://' + location.host)</script></head><body></body></html>`,
      "<html><head></head><body onload=\"location.href='https://' + location.host + location.pathname\"></body></html>",
      "<html><head><script>window['location'] = 'https://' + location.host;</script></head><body></body></html>",
    ];
    for (const body of scripted) expect((await probe({ status: 200, body })).outcome, body.slice(0, 50)).toBe('script-may-redirect');
    // A UTF-16 page with a byte order mark.
    const text = `<html><head>${meta}</head><body></body></html>`;
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i += 1) utf16[2 + i * 2] = text.charCodeAt(i);
    const fetch16 = (async () => new Response(utf16, { status: 200 })) as unknown as typeof fetch;
    expect((await probeHttpRedirect(HTTP_SITE, { guard: guard(), fetch: fetch16 })).outcome).toBe('redirects-in-page');
  });

  it('reads the forms browsers accept', () => {
    const base = new URL(HTTP_SITE);
    expect(refreshTargetOf('0; url=https://a.example/', base)?.href).toBe('https://a.example/');
    expect(refreshTargetOf("5,URL='https://a.example/x'", base)?.href).toBe('https://a.example/x');
    expect(refreshTargetOf('0;https://a.example/', base)?.href).toBe('https://a.example/');
    expect(refreshTargetOf('0; URL = "/neu"', base)?.href).toBe(`http://${HOST}/neu`);
    expect(refreshTargetOf('3', base)).toBeNull();
    expect(refreshTargetOf('url=https://a.example/', base)).toBeNull();
    expect(scanPageStart(`<META HTTP-EQUIV='Refresh' CONTENT='0;URL=${HTTPS_SITE}'>`).metaRefresh).toEqual([`0;URL=${HTTPS_SITE}`]);
    expect(scanPageStart('<metadata http-equiv="refresh" content="0;url=https://a.example/">').metaRefresh).toEqual([]);
    for (const script of ["if (location.protocol !== 'https:') { location.href = target; }", 'window.location = "https://" + location.host;', "location.protocol = 'https:'", "top.location.assign(location.href.replace('http:', 'https:'))"]) expect(scriptMayRedirect(script), script).toBe(true);
    for (const script of ["if (a.location == b) run();", "var u = 'https://example.de/' + location.pathname;", "el.onclick = function () { location.href = '/kontakt'; }"]) expect(scriptMayRedirect(script), script).toBe(false);
  });

  it('reads at most the start of the page, and a page that does not arrive is no "no redirect"', async () => {
    // A head longer than the limit: a meta refresh may follow, so "no redirect" is not known.
    const late = `<html><head><style>${'a{}'.repeat(HTTP_PROBE_BODY_LIMIT / 3)}</style><meta http-equiv="refresh" content="0; url=${HTTPS_SITE}"></head></html>`;
    const cut = await probe({ status: 200, body: late });
    expect(cut.outcome).toBe('page-not-read');
    expect(analyzeSecurity(shopCapture({ httpProbe: cut })).httpRedirect).toMatchObject({ result: 'manual', textId: 'security-http-redirect-manual' });
    // A long page whose head was read completely: the finding, with the text that states what the server answered.
    const long = `<html><head><title>Lang</title></head><body>${'<p>Text der Seite.</p>'.repeat(HTTP_PROBE_BODY_LIMIT / 10)}</body></html>`;
    expect(long.length).toBeGreaterThan(HTTP_PROBE_BODY_LIMIT);
    expect((await probe({ status: 200, body: long })).outcome).toBe('no-redirect');
    // A body that stalls after its first bytes.
    const stalled = (async () => new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('<html><head>')) }), { status: 200 })) as unknown as typeof fetch;
    const started = Date.now();
    const p = await probeHttpRedirect(HTTP_SITE, { guard: guard(), fetch: stalled, timeoutMs: 300 });
    expect(p.outcome).toBe('page-not-read');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(analyzeSecurity(shopCapture({ httpProbe: p })).httpRedirect.result).toBe('manual');
    // A hostile start of a page is read in linear time.
    const hostile = `<meta ${'a="b" '.repeat(8_000)}`.slice(0, HTTP_PROBE_BODY_LIMIT) + '<'.repeat(20_000);
    const before = Date.now();
    scanPageStart(hostile);
    scriptMayRedirect(`location${' '.repeat(60_000)}`);
    scriptMayRedirect(`location'${' '.repeat(60_000)}`);
    scriptMayRedirect(`location [${' '.repeat(60_000)}`);
    scriptMayRedirect(`location . ${' '.repeat(2_000)}`.repeat(30));
    scanPageStart(`<meta x="${'a'.repeat(3_990)}`.repeat(16));
    scanPageStart('<script '.repeat(8_000));
    scanPageStart('<body onload="'.repeat(4_500));
    expect(Date.now() - before).toBeLessThan(1_000);
  });
});
