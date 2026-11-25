import { describe, expect, it, vi } from 'vitest';
import { analyzeSecurity, checkCsp, checkHsts, checkPermissionsPolicy, checkReferrerPolicy, checkXcto } from '../src/analyzers/security.ts';
import { httpVariantOf, probeHttpRedirect, type HttpProbeOptions } from '../src/security/http-probe.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';
import type { HttpProbe } from '../src/security/types.ts';
import { makeCapture } from './helpers.ts';

describe('header checks', () => {
  it('Strict-Transport-Security needs max-age > 0 on HTTPS', () => {
    expect(checkHsts('max-age=31536000; includeSubDomains', true)).toMatchObject({ status: 'present', counts: true, detail: 'max-age=31536000', textId: null });
    expect(checkHsts('max-age="15552000"', true).status).toBe('present');
    expect(checkHsts('max-age=0', true)).toMatchObject({ status: 'invalid', counts: false, detail: 'max-age=0', textId: 'security-header-hsts-invalid' });
    expect(checkHsts('includeSubDomains', true)).toMatchObject({ status: 'invalid', detail: 'no-max-age', textId: 'security-header-hsts-no-max-age' });
    expect(checkHsts('max-age=31536000', false)).toMatchObject({ status: 'invalid', detail: 'not-https', textId: null });
    expect(checkHsts(undefined, false)).toMatchObject({ status: 'missing', detail: 'not-https', textId: null });
    expect(checkHsts(undefined, true)).toMatchObject({ status: 'missing', textId: 'security-header-hsts-missing' });
    // Only the first header counts (RFC 6797 section 8.1).
    expect(checkHsts('max-age=0\nmax-age=31536000', true).status).toBe('invalid');
  });

  it('Content-Security-Policy: header, meta tag, report-only', () => {
    expect(checkCsp("default-src 'self'; script-src 'self' https://cdn.example.de", undefined, null)).toMatchObject({ status: 'present', detail: 'directives: default-src, script-src' });
    expect(checkCsp(undefined, undefined, "default-src 'self'")).toMatchObject({ status: 'meta', counts: true, textId: 'security-header-csp-meta' });
    expect(checkCsp(undefined, "default-src 'self'", null)).toMatchObject({ status: 'report-only', counts: false, textId: 'security-header-csp-report-only' });
    expect(checkCsp('', undefined, null)).toMatchObject({ status: 'missing', textId: 'security-header-csp-missing' });
  });

  it('X-Content-Type-Options must be nosniff', () => {
    expect(checkXcto('nosniff').status).toBe('present');
    expect(checkXcto('NoSniff').status).toBe('present');
    expect(checkXcto('nosniff, nosniff').status).toBe('present');
    expect(checkXcto('sniff')).toMatchObject({ status: 'invalid', textId: 'security-header-xcto-invalid' });
    expect(checkXcto(undefined).status).toBe('missing');
  });

  it('Referrer-Policy: the last known token counts; meta tag counts too', () => {
    expect(checkReferrerPolicy('no-referrer, strict-origin-when-cross-origin', null)).toMatchObject({ status: 'present', detail: 'effective: strict-origin-when-cross-origin' });
    expect(checkReferrerPolicy('strict-origin, unknown-policy', null)).toMatchObject({ status: 'present', detail: 'effective: strict-origin' });
    expect(checkReferrerPolicy('always', null)).toMatchObject({ status: 'invalid', textId: 'security-header-referrer-policy-invalid' });
    expect(checkReferrerPolicy(undefined, 'same-origin')).toMatchObject({ status: 'meta', counts: true, textId: 'security-header-referrer-policy-meta' });
    expect(checkReferrerPolicy(undefined, 'whatever').status).toBe('missing');
    // Old meta values of the HTML standard, and a valid meta tag next to an unusable header.
    // Session fix-a6 (review finding 77): `always` is the old name of unsafe-url, which weakens the default: it does not count.
    expect(checkReferrerPolicy(undefined, 'always')).toMatchObject({ status: 'invalid', counts: false, detail: 'weaker-than-default: unsafe-url (meta)' });
    expect(checkReferrerPolicy(undefined, 'never')).toMatchObject({ status: 'meta', detail: 'effective: no-referrer' });
    expect(checkReferrerPolicy('always', null).status).toBe('invalid');
    expect(checkReferrerPolicy('bogus', 'same-origin')).toMatchObject({ status: 'meta', detail: 'effective: same-origin' });
  });

  it('Permissions-Policy: structured value; Feature-Policy is the old name', () => {
    expect(checkPermissionsPolicy('geolocation=(), camera=()', undefined).status).toBe('present');
    expect(checkPermissionsPolicy('geolocation=self, fullscreen=*, camera=(self "https://www.example.de")', undefined).status).toBe('present');
    expect(checkPermissionsPolicy('geolocation', undefined)).toMatchObject({ status: 'invalid', detail: 'no-feature' });
    // Chromium drops the whole header when it does not parse as a structured field.
    expect(checkPermissionsPolicy('camera=(); microphone=()', undefined)).toMatchObject({ status: 'invalid', detail: 'not-structured-field', textId: 'security-header-permissions-policy-invalid' });
    expect(checkPermissionsPolicy("camera=('self')", undefined)).toMatchObject({ status: 'invalid', detail: 'not-structured-field' });
    expect(checkPermissionsPolicy("geolocation 'none'", undefined)).toMatchObject({ status: 'invalid', detail: 'not-structured-field' });
    // A retired feature alone restricts nothing; next to a real one it is only noted.
    expect(checkPermissionsPolicy('interest-cohort=()', undefined)).toMatchObject({ status: 'invalid', detail: 'only retired features: interest-cohort' });
    expect(checkPermissionsPolicy('interest-cohort=(), camera=()', undefined)).toMatchObject({ status: 'present', detail: 'ignored: interest-cohort' });
    expect(checkPermissionsPolicy(undefined, "geolocation 'none'")).toMatchObject({ status: 'legacy', counts: false, textId: 'security-header-permissions-policy-legacy' });
    expect(checkPermissionsPolicy(undefined, undefined).status).toBe('missing');
  });
});

const probe = (outcome: HttpProbe['outcome']): HttpProbe => ({ url: 'http://www.example.de/', startedAt: '', outcome, hops: [], httpsTarget: outcome === 'redirects-to-https' ? 'https://www.example.de/' : null, durationMs: 80 });

describe('analyzeSecurity', () => {
  it('HTTPS, redirect and five headers of the final document', () => {
    const capture = makeCapture({
      requests: [],
      finalUrl: 'https://www.example.de/',
      mainDocument: { status: 200, redirectChain: [], headers: { 'strict-transport-security': 'max-age=63072000', 'x-content-type-options': 'nosniff' } },
      page: { title: '', lang: 'de', text: '', textTruncated: false, links: [], linksTruncated: false, securityMeta: { csp: null, referrer: null } },
      httpProbe: probe('redirects-to-https'),
    });
    const result = analyzeSecurity(capture);
    expect(result.https).toEqual({ result: 'pass', finalUrl: 'https://www.example.de/', textId: 'security-https-ok' });
    expect(result.httpRedirect).toEqual({ result: 'pass', outcome: 'redirects-to-https', httpsTarget: 'https://www.example.de/', textId: 'security-http-redirect-ok', reason: null, status: null });
    expect(result.headers.map((h) => [h.key, h.status])).toEqual([
      ['hsts', 'present'],
      ['csp', 'missing'],
      ['xcto', 'present'],
      ['referrer-policy', 'missing'],
      ['permissions-policy', 'missing'],
    ]);
    expect([result.headersPresent, result.headersTotal]).toEqual([2, 5]);
  });

  it('a page delivered over http fails HTTPS, and its HSTS header does not count', () => {
    const capture = makeCapture({ requests: [], finalUrl: 'http://www.example.de/', mainDocument: { status: 200, redirectChain: [], headers: { 'strict-transport-security': 'max-age=1' } }, httpProbe: probe('no-redirect') });
    const result = analyzeSecurity(capture);
    expect(result.https).toMatchObject({ result: 'fail', textId: 'security-https-missing' });
    expect(result.httpRedirect).toMatchObject({ result: 'fail', textId: 'security-http-no-redirect' });
    expect(result.headers[0]).toMatchObject({ status: 'invalid', detail: 'not-https' });
    expect(result.headersPresent).toBe(0);
  });

  it('without the meta tags of the page, a missing CSP or referrer header is a manual check, not missing', () => {
    for (const page of [null, { title: '', lang: 'de', text: '', textTruncated: false, links: [], linksTruncated: false }]) {
      const result = analyzeSecurity(makeCapture({ requests: [], page, mainDocument: { status: 200, redirectChain: [], headers: { 'referrer-policy': 'bogus' } } }));
      expect(result.headers.find((h) => h.key === 'csp')).toMatchObject({ status: 'manual', counts: false, textId: 'security-header-csp-manual' });
      expect(result.headers.find((h) => h.key === 'referrer-policy')).toMatchObject({ status: 'manual', textId: 'security-header-referrer-policy-manual' });
    }
    // A header that decides it does not need the meta tags.
    const decided = analyzeSecurity(makeCapture({ requests: [], page: null, mainDocument: { status: 200, redirectChain: [], headers: { 'content-security-policy': "default-src 'self'", 'referrer-policy': 'no-referrer' } } }));
    expect(decided.headers.filter((h) => h.status === 'present').map((h) => h.key)).toEqual(['csp', 'referrer-policy']);
  });

  it('meta tags of the page count for CSP and referrer policy', () => {
    const capture = makeCapture({
      requests: [],
      page: { title: '', lang: 'de', text: '', textTruncated: false, links: [], linksTruncated: false, securityMeta: { csp: "default-src 'self'", referrer: 'no-referrer' } },
    });
    const result = analyzeSecurity(capture);
    expect(result.headers.find((h) => h.key === 'csp')?.status).toBe('meta');
    expect(result.headers.find((h) => h.key === 'referrer-policy')?.status).toBe('meta');
    expect(result.headersPresent).toBe(2);
  });

  it('an unknown final address is a manual check, not a missing HTTPS', () => {
    expect(analyzeSecurity(makeCapture({ requests: [], finalUrl: null })).https).toEqual({ result: 'manual', finalUrl: null, textId: 'security-https-manual' });
  });

  it('maps every probe outcome; unsure means manual, no http at all is only information', () => {
    const resultOf = (outcome: HttpProbe['outcome'] | null) => analyzeSecurity(makeCapture({ requests: [], httpProbe: outcome === null ? null : probe(outcome) })).httpRedirect;
    expect(resultOf('unavailable')).toMatchObject({ result: 'info', textId: 'security-http-unavailable' });
    for (const outcome of ['http-error', 'timeout', 'too-many-redirects', 'stopped'] as const) expect(resultOf(outcome)).toMatchObject({ result: 'manual', textId: 'security-http-redirect-manual' });
    expect(resultOf(null)).toMatchObject({ result: 'not-checked', textId: null });
  });
});

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(answers: Record<string, { status: number; location?: string } | Error>) {
  const calls: FetchCall[] = [];
  const cancelled: string[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected request ${url}`);
    if (answer instanceof Error) throw answer;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('body'));
        // A page answered with 2xx is read to its end (session fix-a2), so the stream ends as a real one does.
        if (answer.status >= 200 && answer.status < 300) controller.close();
      },
      cancel() {
        cancelled.push(url);
      },
    });
    return new Response(answer.status === 204 || answer.status === 304 ? null : body, { status: answer.status, headers: answer.location === undefined ? {} : { location: answer.location } });
  });
  return { fetch: fn as unknown as typeof fetch, calls, cancelled };
}

describe('probeHttpRedirect', () => {
  // Every name resolves to a public address unless a test says otherwise; no DNS is used.
  const publicGuard = (addresses: Record<string, string[]> = {}) => createUrlGuard({ resolve: async (host) => addresses[host] ?? ['93.184.215.14'] });
  const probe = (url: string, options: HttpProbeOptions = {}) => probeHttpRedirect(url, { guard: publicGuard(), ...options });

  it('follows http redirects by hand and stops at the first https address without requesting it', async () => {
    const f = fakeFetch({
      'http://example.de/': { status: 301, location: 'http://www.example.de/' },
      'http://www.example.de/': { status: 308, location: 'https://www.example.de/' },
    });
    const result = await probe('http://example.de/', { fetch: f.fetch, userAgent: 'UA', acceptLanguage: 'de-DE' });
    expect(result.outcome).toBe('redirects-to-https');
    expect(result.httpsTarget).toBe('https://www.example.de/');
    expect(result.hops.map((h) => [h.url, h.status, h.location])).toEqual([
      ['http://example.de/', 301, 'http://www.example.de/'],
      ['http://www.example.de/', 308, 'https://www.example.de/'],
    ]);
    expect(f.calls.map((c) => c.url)).toEqual(['http://example.de/', 'http://www.example.de/']);
    expect(f.calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { 'user-agent': 'UA', 'accept-language': 'de-DE' } });
    expect(f.calls[0]?.init.headers).not.toHaveProperty('cookie');
    expect(f.cancelled).toEqual(['http://example.de/', 'http://www.example.de/']);
  });

  it('resolves a relative Location', async () => {
    const f = fakeFetch({ 'http://www.example.de/': { status: 302, location: '/start' }, 'http://www.example.de/start': { status: 301, location: 'https://www.example.de/start' } });
    expect((await probe('http://www.example.de/', { fetch: f.fetch })).outcome).toBe('redirects-to-https');
  });

  it('a 2xx answer on http is no redirect; 4xx or 5xx is an error page', async () => {
    expect((await probe('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': { status: 200 } }).fetch })).outcome).toBe('no-redirect');
    expect((await probe('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': { status: 403 } }).fetch })).outcome).toBe('http-error');
  });

  it('no connection at all is unavailable; a timeout is a timeout', async () => {
    // Session fix-a5 (finding 80): the error as Node's fetch gives it for a refused connection, with its cause.
    const refused = await probe('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 192.0.2.1:80'), { code: 'ECONNREFUSED' }) }) }).fetch });
    expect(refused.outcome).toBe('unavailable');
    expect(refused.hops[0]?.error).toContain('fetch failed');
    const slow = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect((await probe('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': slow }).fetch })).outcome).toBe('timeout');
  });

  it('stops after the allowed number of redirects', async () => {
    const answers: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i < 10; i += 1) answers[`http://www.example.de/${i}`] = { status: 302, location: `/${i + 1}` };
    const f = fakeFetch(answers);
    const result = await probe('http://www.example.de/0', { fetch: f.fetch, maxRedirects: 5 });
    expect(result.outcome).toBe('too-many-redirects');
    expect(f.calls).toHaveLength(6);
  });

  it('never opens an address that is not allowed, and stops on a redirect without Location', async () => {
    const f = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'http://www.example.de:8080/' } });
    expect((await probe('http://www.example.de/', { fetch: f.fetch })).outcome).toBe('stopped');
    expect(f.calls).toHaveLength(1);
    const none = fakeFetch({ 'http://www.example.de/': { status: 302 } });
    expect((await probe('http://www.example.de/', { fetch: none.fetch })).outcome).toBe('stopped');
    const nothing = fakeFetch({});
    expect((await probe('http://user:pw@www.example.de/', { fetch: nothing.fetch })).outcome).toBe('stopped');
    expect((await probe('https://www.example.de/', { fetch: nothing.fetch })).outcome).toBe('stopped');
    expect(nothing.calls).toHaveLength(0);
    const ftp = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'ftp://www.example.de/' } });
    expect((await probe('http://www.example.de/', { fetch: ftp.fetch })).outcome).toBe('stopped');
    const custom = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'http://intranet.local/' } });
    const local = await probe('http://www.example.de/', { fetch: custom.fetch });
    expect(local.outcome).toBe('stopped');
    expect(local.hops.at(-1)?.error).toContain('host-name');
    expect(custom.calls).toHaveLength(1);
    // A public-looking name that resolves to a private address is refused after resolving it.
    const rebound = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'http://inside.example.de/' } });
    const toPrivate = await probe('http://www.example.de/', { fetch: rebound.fetch, guard: publicGuard({ 'inside.example.de': ['10.0.0.7'] }) });
    expect(toPrivate.outcome).toBe('stopped');
    expect(toPrivate.hops.at(-1)?.error).toContain('private');
    expect(rebound.calls).toHaveLength(1);
    // The first address itself is checked too.
    const first = fakeFetch({});
    expect((await probe('http://www.example.de/', { fetch: first.fetch, guard: publicGuard({ 'www.example.de': ['127.0.0.1'] }) })).outcome).toBe('stopped');
    expect(first.calls).toHaveLength(0);
  });

  it('the time limit covers name resolution (A5 review)', async () => {
    // Session B5 part 1: the probe ends before the slow name resolution answers, not "in less than 1 s by the clock",
    // which a busy machine could break (test/speed.ts).
    let answered = false;
    const slow = createUrlGuard({ resolve: () => new Promise<string[]>((resolve) => setTimeout(() => ((answered = true), resolve(['93.184.215.14'])), 1_500)) });
    const result = await probe('http://www.example.de/', { fetch: fakeFetch({}).fetch, guard: slow, timeoutMs: 150 });
    expect(result.outcome).toBe('timeout');
    expect(answered).toBe(false);
  });

  it('httpVariantOf', () => {
    expect(httpVariantOf('https://www.example.de/shop?x=1#top')).toBe('http://www.example.de/shop?x=1');
    expect(httpVariantOf('https://www.example.de:8443/')).toBe('http://www.example.de/');
    expect(httpVariantOf('mailto:a@b.de')).toBeNull();
  });
});
