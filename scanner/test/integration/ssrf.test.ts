import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeCapture } from '../../src/analyzers/capture.ts';
import type { Capture } from '../../src/capture/types.ts';
import { DEFAULT_RULES } from '../../src/data.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { createLocalGuard } from '../../src/local/node-resolver.ts';
import { fixtureGuard, ssrfSecretHits, startFixtureServer, type FixtureServer } from './fixture-server.ts';

/**
 * Session A5: the SSRF guard in the local Playwright adapter. The fixture pages live on the
 * exempt host `www.ssrf.test` and lead the browser to 127.0.0.1 in several ways; the guard must
 * refuse every one before the request is sent, so the internal page never gets a request.
 * The same cases run against the Cloudflare adapter on plain `wrangler dev` in
 * `worker/test/integration/ssrf-dev.test.ts`.
 */

const HOST_RULES = '--host-resolver-rules=MAP *.test 127.0.0.1';

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await launchLocalBrowser([HOST_RULES]);
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const capture = async (path: string): Promise<Capture> =>
  (await captureWithPlaywright(browser, server.url('www.ssrf.test', path), { guard: fixtureGuard, maxWaitMs: 4_000, accessibility: false, httpProbe: false })).capture;

describe('SSRF guard in the local adapter', () => {
  it('loads a normal page on the exempt fixture host (control)', async () => {
    const c = await capture('/ok');
    expect(c.ok).toBe(true);
    expect(c.failure).toBeNull();
  });

  it('control: with every address exempt, the same redirect does reach the internal page', async () => {
    const hits = ssrfSecretHits();
    const open = createLocalGuard({ exempt: () => true });
    const { capture: c } = await captureWithPlaywright(browser, server.url('www.ssrf.test', '/redirect-loopback'), { guard: open, maxWaitMs: 4_000, accessibility: false, httpProbe: false, impressum: false });
    expect(c.ok).toBe(true);
    expect(c.finalUrl).toBe(`http://127.0.0.1:${server.port}/ssrf/secret`);
    expect(ssrfSecretHits()).toBe(hits + 1);
  });

  it.each([
    ['an HTTP redirect to 127.0.0.1', '/redirect-loopback', 'loopback'],
    ['a redirect to 127.0.0.1 in decimal notation, after one allowed hop', '/redirect-decimal', 'loopback'],
    ['a meta refresh to 127.0.0.1', '/meta-refresh', 'loopback'],
    ['a script navigation to 127.0.0.1 in hex notation', '/script-redirect', 'loopback'],
  ])('refuses %s before it is sent', async (_name, path, reason) => {
    const hits = ssrfSecretHits();
    const c = await capture(path);
    expect(c.ok).toBe(false);
    expect(c.failure?.reason).toBe('not-allowed');
    expect(c.failure?.message).toContain(reason);
    expect(c.failure?.message).toContain('127.0.0.1');
    expect(ssrfSecretHits()).toBe(hits);
    // A refused capture gives no findings, like any capture that failed.
    const analysis = analyzeCapture(c, DEFAULT_RULES);
    expect(analysis.state).toBe('failed');
    expect(analysis.thirdParty).toBeNull();
  });

  it('refuses the sixth redirect of the main document', async () => {
    const c = await capture('/chain/0');
    expect(c.failure?.reason).toBe('not-allowed');
    expect(c.failure?.message).toContain('too-many-redirects');
    expect(c.failure?.message).toContain('more than 5');
  });

  it('refuses an Impressum link to an internal address, the homepage stays captured', async () => {
    const hits = ssrfSecretHits();
    const { capture: c } = await captureWithPlaywright(browser, server.url('www.ssrf.test', '/impressum-internal'), { guard: fixtureGuard, maxWaitMs: 4_000, accessibility: false, httpProbe: false });
    expect(c.ok).toBe(true);
    expect(c.impressum?.ok).toBe(false);
    expect(c.impressum?.failure?.reason).toBe('not-allowed');
    expect(c.impressum?.failure?.message).toContain('loopback');
    expect(ssrfSecretHits()).toBe(hits);
  });

  it('refuses an internal address before the browser opens anything (default guard, no exemption)', async () => {
    const hits = ssrfSecretHits();
    const pagesBefore = browser.contexts().length;
    for (const url of [`http://127.0.0.1:${server.port}/ssrf/secret`, 'http://127.0.0.1/ssrf/secret', 'http://localhost/ssrf/secret', 'http://[::1]/', 'http://0x7f000001/', 'file:///C:/Windows/win.ini']) {
      const { capture: c } = await captureWithPlaywright(browser, url, { guard: createLocalGuard(), accessibility: false });
      expect(c.failure?.reason, url).toBe('not-allowed');
      expect(c.requests).toEqual([]);
    }
    expect(browser.contexts().length).toBe(pagesBefore);
    expect(ssrfSecretHits()).toBe(hits);
  });
});
