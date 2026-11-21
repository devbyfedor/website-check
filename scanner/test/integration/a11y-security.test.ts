import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AXE_RULES, AXE_VERSION } from '../../src/a11y/types.ts';
import { analyzeAccessibility } from '../../src/analyzers/accessibility.ts';
import { analyzeSecurity } from '../../src/analyzers/security.ts';
import { compareAxeRuns, runReferenceAxe, type ReferenceRun } from '../../src/local/axe-reference.ts';
import { captureWithPlaywright, launchLocalBrowser } from '../../src/local/playwright-capture.ts';
import { probeHttpRedirect } from '../../src/security/http-probe.ts';
import { startFixtureServer, type FixtureServer } from './fixture-server.ts';

/**
 * Session A3: the accessibility fixture pages (`scanner/fixtures/a11y/`) through the real local
 * capture adapter with the pinned axe-core, each compared with its expected counts and with a
 * standard `@axe-core/playwright` run on the same page load; and the security checks against
 * the local fixture server.
 */

const HOST_RULES = '--host-resolver-rules=MAP nx.test ~NOTFOUND, MAP *.test 127.0.0.1';
const A11Y_DIR = resolve(import.meta.dirname, '../../fixtures/a11y');

interface Expected {
  violations: Record<string, number>;
  incomplete: Record<string, number>;
}
const manifest = JSON.parse(readFileSync(resolve(A11Y_DIR, 'expected.json'), 'utf8')) as { axeVersion: string; pages: Record<string, Expected> };

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

describe('accessibility fixture pages', () => {
  it('the manifest is for the pinned axe-core version', () => {
    expect(manifest.axeVersion).toBe(AXE_VERSION);
  });

  it.each(Object.keys(manifest.pages))('%s: counts as expected and the same as the standard axe-core run', async (name) => {
    const expected = manifest.pages[name] as Expected;
    const { capture, after } = await captureWithPlaywright(browser, server.url('www.a11y.test', `/${name}`), {
      maxWaitMs: 5_000,
      httpProbe: false,
      afterChecks: (page) => runReferenceAxe(page),
    });
    expect(capture.ok).toBe(true);
    // Self-contained pages: nothing but the page itself and data: URLs.
    expect(capture.requests.filter((r) => !r.url.startsWith('data:') && !r.url.startsWith(server.url('www.a11y.test', '/')))).toEqual([]);
    const axe = capture.axe;
    expect(axe?.status, axe?.error ?? '').toBe('ok');
    expect(axe?.axeVersion).toBe(AXE_VERSION);
    for (const id of AXE_RULES) {
      expect(axe?.rules[id]?.violations, `${id} violations`).toBe(expected.violations[id]);
      expect(axe?.rules[id]?.incomplete, `${id} incomplete`).toBe(expected.incomplete[id] ?? 0);
      expect(axe?.rules[id]?.examples.length).toBe(Math.min(5, expected.violations[id] ?? 0));
    }
    const comparison = compareAxeRuns(axe ?? null, after as ReferenceRun, null);
    expect(comparison.versions.reference).toBe(AXE_VERSION);
    expect(comparison.rules.filter((r) => !r.same)).toEqual([]);
    expect(comparison.rules.filter((r) => !r.sameExamples)).toEqual([]);
    expect(comparison.rules.filter((r) => r.incomplete.ours !== r.incomplete.reference)).toEqual([]);
    const analysis = analyzeAccessibility(capture);
    expect(analysis.status).toBe('checked');
    expect(analysis.counts.violations).toBe(Object.values(expected.violations).reduce((a, b) => a + b, 0));
  });

  it('every rule has a page with errors and a page without', () => {
    for (const id of AXE_RULES) {
      expect(manifest.pages[`${id}-fail.html`]?.violations[id] ?? 0, `${id}-fail.html`).toBeGreaterThan(0);
      expect(manifest.pages[`${id}-pass.html`]?.violations[id], `${id}-pass.html`).toBe(0);
    }
  });
});

describe('axe within the page limits', () => {
  it('skips axe when no time is left before the hard limit, and says so', async () => {
    // A page that never gets quiet, with a hard limit just above the wait: no time for axe.
    const { capture } = await captureWithPlaywright(browser, server.url('www.busy.test'), { maxWaitMs: 2_000, hardLimitMs: 3_500, httpProbe: false });
    expect(capture.axe?.status).toBe('skipped');
    expect(analyzeAccessibility(capture)).toMatchObject({ status: 'not-checked' });
  });

  it('does not run axe on a page that failed', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.broken.test'), { httpProbe: false });
    expect(capture.ok).toBe(false);
    expect(capture.axe?.status).toBe('skipped');
  });
});

describe('security checks', () => {
  it('reads the headers and the meta tag of the main document', async () => {
    const { capture } = await captureWithPlaywright(browser, server.url('www.headers.test'), { accessibility: false, httpProbe: false });
    expect(capture.page?.securityMeta).toEqual({ csp: null, referrer: 'no-referrer' });
    const result = analyzeSecurity(capture);
    expect(result.https.result).toBe('fail'); // the fixture server speaks plain http
    expect(result.headers.map((h) => [h.key, h.status])).toEqual([
      ['hsts', 'invalid'], // ignored over http
      ['csp', 'present'],
      ['xcto', 'present'],
      ['referrer-policy', 'meta'],
      ['permissions-policy', 'present'],
    ]);
  });

  const anyPort = { isAllowed: (url: URL) => url.protocol === 'http:' || url.protocol === 'https:' };

  it('follows a real redirect chain to https without requesting the https address', async () => {
    const result = await probeHttpRedirect(`http://127.0.0.1:${server.port}/redirect/start`, anyPort);
    expect(result.outcome).toBe('redirects-to-https');
    expect(result.httpsTarget).toBe('https://www.secure.test/');
    expect(result.hops.map((h) => h.status)).toEqual([301, 308]);
  });

  it('recognises an http page without redirect, a redirect loop and a closed port', async () => {
    expect((await probeHttpRedirect(`http://127.0.0.1:${server.port}/plain`, anyPort)).outcome).toBe('no-redirect');
    expect((await probeHttpRedirect(`http://127.0.0.1:${server.port}/loop`, anyPort)).outcome).toBe('too-many-redirects');
    expect((await probeHttpRedirect('http://127.0.0.1:1/', anyPort)).outcome).toBe('unavailable');
  });
});
