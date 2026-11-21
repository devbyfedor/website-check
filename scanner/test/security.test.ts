import { describe, expect, it, vi } from 'vitest';
import { analyzeSecurity, checkCsp, checkHsts, checkPermissionsPolicy, checkReferrerPolicy, checkXcto } from '../src/analyzers/security.ts';
import { httpVariantOf, isDefaultProbeTarget, probeHttpRedirect } from '../src/security/http-probe.ts';
import type { HttpProbe } from '../src/security/types.ts';
import { makeCapture } from './helpers.ts';

describe('header checks', () => {
  it('Strict-Transport-Security needs max-age > 0 on HTTPS', () => {
    expect(checkHsts('max-age=31536000; includeSubDomains', true)).toMatchObject({ status: 'present', counts: true, detail: 'max-age=31536000', textId: null });
    expect(checkHsts('max-age="15552000"', true).status).toBe('present');
    expect(checkHsts('max-age=0', true)).toMatchObject({ status: 'invalid', counts: false, detail: 'max-age=0', textId: 'security-header-hsts-invalid' });
    expect(checkHsts('includeSubDomains', true)).toMatchObject({ status: 'invalid', detail: 'no-max-age' });
    expect(checkHsts('max-age=31536000', false)).toMatchObject({ status: 'invalid', detail: 'not-https' });
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
  });

  it('Permissions-Policy: structured value; Feature-Policy is the old name', () => {
    expect(checkPermissionsPolicy('geolocation=(), camera=()', undefined).status).toBe('present');
    expect(checkPermissionsPolicy('geolocation', undefined)).toMatchObject({ status: 'invalid', detail: 'no-feature' });
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
      httpProbe: probe('redirects-to-https'),
    });
    const result = analyzeSecurity(capture);
    expect(result.https).toEqual({ result: 'pass', finalUrl: 'https://www.example.de/', textId: 'security-https-ok' });
    expect(result.httpRedirect).toEqual({ result: 'pass', outcome: 'redirects-to-https', httpsTarget: 'https://www.example.de/', textId: 'security-http-redirect-ok' });
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
  it('follows http redirects by hand and stops at the first https address without requesting it', async () => {
    const f = fakeFetch({
      'http://example.de/': { status: 301, location: 'http://www.example.de/' },
      'http://www.example.de/': { status: 308, location: 'https://www.example.de/' },
    });
    const result = await probeHttpRedirect('http://example.de/', { fetch: f.fetch, userAgent: 'UA', acceptLanguage: 'de-DE' });
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
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: f.fetch })).outcome).toBe('redirects-to-https');
  });

  it('a 2xx answer on http is no redirect; 4xx or 5xx is an error page', async () => {
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': { status: 200 } }).fetch })).outcome).toBe('no-redirect');
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': { status: 403 } }).fetch })).outcome).toBe('http-error');
  });

  it('no connection at all is unavailable; a timeout is a timeout', async () => {
    const refused = await probeHttpRedirect('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': new TypeError('fetch failed') }).fetch });
    expect(refused.outcome).toBe('unavailable');
    expect(refused.hops[0]?.error).toContain('fetch failed');
    const slow = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: fakeFetch({ 'http://www.example.de/': slow }).fetch })).outcome).toBe('timeout');
  });

  it('stops after the allowed number of redirects', async () => {
    const answers: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i < 10; i += 1) answers[`http://www.example.de/${i}`] = { status: 302, location: `/${i + 1}` };
    const f = fakeFetch(answers);
    const result = await probeHttpRedirect('http://www.example.de/0', { fetch: f.fetch, maxRedirects: 5 });
    expect(result.outcome).toBe('too-many-redirects');
    expect(f.calls).toHaveLength(6);
  });

  it('never opens an address that is not allowed, and stops on a redirect without Location', async () => {
    const f = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'http://www.example.de:8080/' } });
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: f.fetch })).outcome).toBe('stopped');
    expect(f.calls).toHaveLength(1);
    const none = fakeFetch({ 'http://www.example.de/': { status: 302 } });
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: none.fetch })).outcome).toBe('stopped');
    const nothing = fakeFetch({});
    expect((await probeHttpRedirect('http://user:pw@www.example.de/', { fetch: nothing.fetch })).outcome).toBe('stopped');
    expect((await probeHttpRedirect('https://www.example.de/', { fetch: nothing.fetch })).outcome).toBe('stopped');
    expect(nothing.calls).toHaveLength(0);
    const ftp = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'ftp://www.example.de/' } });
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: ftp.fetch })).outcome).toBe('stopped');
    const custom = fakeFetch({ 'http://www.example.de/': { status: 301, location: 'http://intranet.local/' } });
    expect((await probeHttpRedirect('http://www.example.de/', { fetch: custom.fetch, isAllowed: (u) => !u.hostname.endsWith('.local') })).outcome).toBe('stopped');
    expect(custom.calls).toHaveLength(1);
  });

  it('httpVariantOf and isDefaultProbeTarget', () => {
    expect(httpVariantOf('https://www.example.de/shop?x=1#top')).toBe('http://www.example.de/shop?x=1');
    expect(httpVariantOf('https://www.example.de:8443/')).toBe('http://www.example.de/');
    expect(httpVariantOf('mailto:a@b.de')).toBeNull();
    expect(isDefaultProbeTarget(new URL('http://www.example.de/'))).toBe(true);
    expect(isDefaultProbeTarget(new URL('https://www.example.de:443/'))).toBe(true);
    expect(isDefaultProbeTarget(new URL('http://www.example.de:8080/'))).toBe(false);
  });
});
