import { describe, expect, it } from 'vitest';
import { analyzeSecurity } from '../src/analyzers/security.ts';
import { notAllowedCapture } from '../src/capture/failure.ts';
import type { Capture } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import { validateReport } from '../src/report/validate.ts';
import { createDohResolver } from '../src/security/doh.ts';
import { isConnectionFailure } from '../src/security/fetch-errors.ts';
import { probeHttpRedirect } from '../src/security/http-probe.ts';
import { createUrlGuard, describeRejection } from '../src/security/ssrf.ts';
import { shopCapture } from './report-helpers.ts';

/**
 * Review findings 32 and 80 (session fix-a5), built from the review's reproductions (fake resolver and fake
 * `fetch`, no network, invented names): a failure on our side during a check (the name lookup failed, the Worker
 * used up its subrequests, an internal error) gave a final report "the address was refused by the SSRF
 * protection" (32) or the hint "Unter http:// nicht erreichbar" (80), both statements about the site.
 */

const SITE = 'https://www.gewoehnliche-seite-erfunden.de/';
const page = (async () => new Response('<html lang="de"><title>ok</title><body>Hallo</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;

function report(capture: Capture, mode: 'full' | 'quick' = 'quick') {
  return buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T10:00:00.000Z', siteUrl: SITE, mode, capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated }).report;
}

describe('finding 32: a failed name lookup during the check is our failure, not a refused address', () => {
  for (const [name, doh] of [
    ['the resolver answers HTTP 503', (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch],
    ['the subrequests are used up', (async () => {
      throw new Error('Too many subrequests.');
    }) as unknown as typeof fetch],
  ] as const) {
    it(`quick check, ${name}: state failed (reason other), not not-allowed; valid; not cached`, async () => {
      const guard = createUrlGuard({ resolve: createDohResolver(doh) });
      const capture = await quickCapture(SITE, { guard, userAgent: 'UA', fetch: page });
      expect(capture.failure?.reason).toBe('other');
      expect(capture.failure?.message).toMatch(/^name lookup failed during the scan: dns-error/);
      const built = report(capture);
      expect(validateReport(built)).toEqual([]);
      expect(built.state).toBe('failed');
      expect(built.failure).toEqual({ reason: 'other', status: null });
      expect(JSON.stringify(built)).not.toContain('report-not-allowed');
    });
  }

  it('a browser capture refused by a failed lookup, saved before the fix, is decided again', () => {
    const verdict = { allowed: false as const, url: SITE, rejection: 'dns-error' as const, detail: 'name resolution failed: Too many subrequests.' };
    const capture = notAllowedCapture('cloudflare-browser-run', shopCapture().environment, SITE, describeRejection(verdict), 'cdp-events');
    const built = report(capture, 'full');
    expect(built.state).toBe('failed');
    expect(built.failure?.reason).toBe('other');
  });

  it('control: a real refusal of the address stays not-allowed', async () => {
    const guard = createUrlGuard({ resolve: async () => ['127.0.0.1'] });
    const capture = await quickCapture(SITE, { guard, userAgent: 'UA', fetch: page });
    expect(capture.failure?.reason).toBe('not-allowed');
    expect(report(capture).state).toBe('not-allowed');
  });

  it('quick check: a request that failed on our side is not "unreachable"', async () => {
    const guard = createUrlGuard({ resolve: async () => ['93.184.215.14'] });
    const throwing = (async () => {
      throw new Error('Too many subrequests.');
    }) as unknown as typeof fetch;
    const capture = await quickCapture(SITE, { guard, userAgent: 'UA', fetch: throwing });
    expect(capture.failure?.reason).toBe('other');
    const refused = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 93.184.215.14:443'), { code: 'ECONNREFUSED' }) });
    }) as unknown as typeof fetch;
    expect((await quickCapture(SITE, { guard, userAgent: 'UA', fetch: refused })).failure?.reason).toBe('unreachable');
  });
});

describe('finding 80: only a failed connection is "Unter http:// nicht erreichbar"', () => {
  const guard = createUrlGuard({ resolve: async () => ['93.184.216.34'] });
  const probe = async (impl: () => Promise<Response>) => {
    const result = await probeHttpRedirect('http://wc-review-erfunden.de/', { guard, fetch: impl as unknown as typeof fetch });
    const security = analyzeSecurity({ finalUrl: 'https://wc-review-erfunden.de/', mainDocument: { status: 200, headers: {}, redirectChain: [] }, page: null, httpProbe: result } as unknown as Capture);
    return { outcome: result.outcome, result: security.httpRedirect.result, textId: security.httpRedirect.textId };
  };

  it('the subrequest limit and an internal error are a manual check, not "nicht erreichbar"', async () => {
    for (const error of [new Error('Too many subrequests.'), new TypeError('internal error')]) {
      const r = await probe(async () => {
        throw error;
      });
      expect(r.outcome, error.message).toBe('stopped');
      expect(r.textId).not.toBe('security-http-unavailable');
      expect(r.result).toBe('manual');
    }
  });

  it('control: a refused or reset connection is still "nicht erreichbar"', async () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET']) {
      const r = await probe(async () => {
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code} 93.184.216.34:80`), { code }) });
      });
      expect(r.outcome, code).toBe('unavailable');
      expect(r.textId).toBe('security-http-unavailable');
    }
  });

  it('isConnectionFailure', () => {
    expect(isConnectionFailure('TypeError: fetch failed: connect ECONNREFUSED 1.2.3.4:80')).toBe(true);
    expect(isConnectionFailure('Error: Network connection lost.')).toBe(true);
    expect(isConnectionFailure('Error: Too many subrequests.')).toBe(false);
    expect(isConnectionFailure('TypeError: internal error')).toBe(false);
    expect(isConnectionFailure('Error: request budget of the quick check used up')).toBe(false);
  });
});
