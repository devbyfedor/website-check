import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeCapture } from '../../src/analyzers/capture.ts';
import type { Capture } from '../../src/capture/types.ts';
import { DEFAULT_RULES } from '../../src/data.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { createLocalGuard } from '../../src/local/node-resolver.ts';
import type { UrlGuard } from '../../src/security/ssrf.ts';
import { fixtureGuard, PRIVATE_MARK, ssrfPrivateNavigations, ssrfSecretHits, startFixtureServer, type FixtureServer } from './fixture-server.ts';

/**
 * Session A5: the SSRF guard in the local Playwright adapter. The fixture pages live on the
 * exempt host `www.ssrf.test` and lead the browser to 127.0.0.1 in several ways; the guard must
 * refuse every one before the request is sent, so the internal page never gets a request.
 * The same cases run against the Cloudflare adapter on plain `wrangler dev`, through the real queue object
 * and the API, in `worker/test/integration/ssrf-dev.test.ts`.
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

  it('a prerendered page that is activated and then navigates to 127.0.0.1 reaches nothing', async () => {
    const hits = ssrfSecretHits();
    const c = await capture('/prerender');
    expect(ssrfSecretHits()).toBe(hits);
    // Either the guard refused the navigation, or the page never left the allowed host.
    if (!c.ok) expect(c.failure?.reason).toBe('not-allowed');
    expect(c.page?.url ?? '').not.toContain('127.0.0.1');
  });

  it('control: with the default launch flags of Playwright (popup blocker off) a popup does reach the internal page; through the adapter it does not', async () => {
    const loose = await chromium.launch({ channel: 'chromium', headless: true, args: [HOST_RULES] });
    try {
      const hits = ssrfSecretHits();
      const context = await loose.newContext();
      await (await context.newPage()).goto(server.url('www.ssrf.test', '/popup'), { waitUntil: 'load' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await context.close();
      expect(ssrfSecretHits()).toBeGreaterThan(hits);
      // Session fix-a2: the adapter refuses windows of the page itself, whatever the launch flags are.
      const before = ssrfSecretHits();
      await captureWithPlaywright(loose, server.url('www.ssrf.test', '/popup'), { guard: fixtureGuard, maxWaitMs: 4_000, accessibility: false, httpProbe: false });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(ssrfSecretHits()).toBe(before);
    } finally {
      await loose.close();
    }
  });

  it.each(['/popup', '/popup-noopener', '/popup-link'])('a window that %s opens by script without user action reaches nothing', async (path) => {
    const hits = ssrfSecretHits();
    await capture(path);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(ssrfSecretHits()).toBe(hits);
  });

  it('a same-origin iframe that navigates the top document to 127.0.0.1 is refused', async () => {
    const hits = ssrfSecretHits();
    const c = await capture('/iframe-top');
    expect(c.failure?.reason).toBe('not-allowed');
    expect(ssrfSecretHits()).toBe(hits);
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

  // Session fix-a2, review finding 24. Playwright's `page.evaluate` gives the page "user activation", and with
  // it Chrome's popup blocker lets a window of the page through; the scanner's own calls are enough for that.
  it.each([
    ['a script opens a window once the page has user activation', '/activation-open', {}],
    ['the same with the shortest capture: no accessibility check, no Impressum', '/activation-open', { accessibility: false, impressum: false }],
    ['a form is sent into a new window once the page has user activation', '/activation-post', {}],
    ['the Impressum page opens a window once it has user activation', '/activation-impressum', { accessibility: false }],
  ])('%s: the window reaches nothing', async (_name, path, extra) => {
    const hits = ssrfSecretHits();
    const { capture: c } = await captureWithPlaywright(browser, server.url('www.ssrf.test', path), { guard: fixtureGuard, maxWaitMs: 4_000, httpProbe: false, ...extra });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(ssrfSecretHits()).toBe(hits);
    // The scanner's own tabs are not taken for windows of the page.
    expect(c.ok).toBe(true);
    if (path === '/activation-impressum') expect(c.impressum?.ok).toBe(true);
    expect(browser.contexts()).toHaveLength(0);
  });

  it('control: the same page does reach the internal page when the window is let through (Playwright default flags, no guard on windows)', async () => {
    const hits = ssrfSecretHits();
    const loose = await chromium.launch({ channel: 'chromium', headless: true, args: [HOST_RULES] });
    try {
      const context = await loose.newContext();
      const page = await context.newPage();
      await page.goto(server.url('www.ssrf.test', '/activation-open'), { waitUntil: 'load' });
      await page.evaluate('1');
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      await loose.close();
    }
    expect(ssrfSecretHits()).toBeGreaterThan(hits);
  });

  // Session fix-a2, review finding 23. The page moves to a prefetched internal page right after the snapshot;
  // the check of the snapshot's address is slow here (as a name lookup can be), so the other document is in
  // the tab before axe starts. Before the fix axe, the HTML and the screenshot were read from it.
  it('axe, the HTML and the screenshot are never read from a document that replaced the checked one', async () => {
    /** The third check is the one of the snapshot's address (the address, the document request, the read document). */
    const slowReadCheck = (inner: UrlGuard, delayMs: number): UrlGuard => {
      let calls = 0;
      return {
        check: async (url) => {
          calls += 1;
          if (calls === 3) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return inner.check(url);
        },
      };
    };
    const navigations = ssrfPrivateNavigations();
    const { capture: c, html, screenshot } = await captureWithPlaywright(browser, server.url('www.ssrf.test', '/prefetch-swap'), { guard: slowReadCheck(fixtureGuard, 900), maxWaitMs: 4_000, httpProbe: false, impressum: false, artifacts: true });
    // The navigation used the prefetched answer: no document request, so nothing the guard on requests could refuse.
    expect(ssrfPrivateNavigations()).toBe(navigations);
    expect(JSON.stringify(c)).not.toContain(PRIVATE_MARK);
    expect(html ?? '').not.toContain(PRIVATE_MARK);
    expect(screenshot).toBeNull();
    expect(c.axe?.status).not.toBe('ok');
    // The internal document in the tab is refused like a navigation to it.
    expect(c.ok).toBe(false);
    expect(c.failure?.reason).toBe('not-allowed');
    expect(analyzeCapture(c, DEFAULT_RULES).state).toBe('failed');
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
