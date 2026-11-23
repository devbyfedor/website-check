import { describe, expect, it } from 'vitest';
import { analyzeCapture } from '../src/analyzers/capture.ts';
import { almostEmptyReason, classifyMainDocument, interruptedFailure, pageEvidenceOf, recheckCapture } from '../src/capture/failure.ts';
import type { Capture, PageSnapshot } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { makeCapture, type RequestInput } from './helpers.ts';
import { axeResult, SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a1, review findings 2 and 3: a capture that was cut off, and a page that looks like bot
 * protection without matching the exact rule, never give a report that says "erfüllt". The cases are the
 * ones of the review's reproduction, with invented pages.
 */

function report(capture: Capture, mode: 'full' | 'quick' = 'full'): Report {
  const built = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T09:00:00.000Z', siteUrl: SHOP_URL, mode, capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(built.report)).toEqual([]);
  return built.report;
}

const results = (r: Report): string[] => r.measures.map((m) => `${m.id}:${m.result}`);

describe('finding 2: a capture that was cut off', () => {
  // What the adapters returned before the fix when the tab crashed 1.2 s after the document: `ok`, a part of the requests.
  const cutOff = (): Capture => {
    const full = shopCapture();
    return { ...full, requests: full.requests.slice(0, 3), page: null, axe: null, impressum: undefined, timings: { domContentLoadedMs: 600, loadMs: null, networkQuietMs: null, endMs: 1300, stopReason: 'error' } };
  };

  it('is a failed capture, whatever the adapter said', () => {
    const capture = cutOff();
    expect(capture.ok).toBe(true);
    const checked = recheckCapture(capture);
    expect(checked).toMatchObject({ ok: false, failure: { reason: 'other' } });
    expect(analyzeCapture(capture, DEFAULT_RULES)).toMatchObject({ state: 'failed', thirdParty: null, accessibility: null, security: null, legal: null });
  });

  it('gives a report without measures, services and findings: no "complete", no pass', () => {
    const r = report(cutOff());
    expect(r.state).toBe('failed');
    expect(r.notice).toMatchObject({ textId: 'report-failed' });
    expect(r.measures).toEqual([]);
    expect(r.services).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.sections.thirdParty).toEqual({ status: 'not-checked', reason: 'page-not-loaded' });
  });

  it('the failures the adapters give for a cut-off capture are never analysed', () => {
    expect(interruptedFailure('hard-limit')).toMatchObject({ reason: 'timeout' });
    expect(interruptedFailure('crashed')).toMatchObject({ reason: 'other' });
    expect(interruptedFailure('closed')).toMatchObject({ reason: 'other' });
    for (const cause of ['hard-limit', 'crashed', 'closed'] as const) {
      const r = report({ ...cutOff(), ok: false, failure: interruptedFailure(cause) });
      expect(r.state).toBe('failed');
      expect(results(r)).toEqual([]);
    }
  });

  it('a capture that ended normally is untouched', () => {
    const capture = shopCapture();
    expect(recheckCapture(capture)).toBe(capture);
    expect(report(capture).state).toBe('complete');
  });
});

interface Variant {
  name: string;
  status: number;
  title: string;
  text: string;
  requests: number;
}

const LONG_NOSCRIPT =
  'Diese Website verwendet einen Sicherheitsdienst zum Schutz vor Online-Angriffen. ' +
  'Um fortzufahren, muss Ihr Browser JavaScript und Cookies unterstützen. Bitte aktivieren Sie JavaScript in den Einstellungen Ihres Browsers und laden Sie die Seite neu. ' +
  'Wenn Sie ein VPN, einen Proxy oder ein Werbeblocker-Plugin verwenden, deaktivieren Sie es bitte für diese Seite. ' +
  'This website uses a security service to protect itself from online attacks. To continue, your browser must support JavaScript and cookies. ' +
  'Please enable JavaScript in your browser settings and reload the page. If you use a VPN, a proxy or an ad blocker, please switch it off for this page. ' +
  'Vorgangsnummer 0000000000. Zeit: 23.11.2026 10:00:00 UTC. Bei Fragen wenden Sie sich an den Betreiber der Website.';

// Pages of bot protection with HTTP 2xx that the exact rule does not name (the review's variants).
const UNNAMED: Variant[] = [
  { name: 'captcha, German', status: 200, title: 'Sicherheitsabfrage', text: 'Sicherheitsabfrage Bitte bestätigen Sie, dass Sie kein Roboter sind. Ich bin kein Roboter', requests: 3 },
  { name: 'Access Denied with 200', status: 200, title: 'Access Denied', text: "Access Denied. You don't have permission to access this page. Reference #18.0000000", requests: 1 },
  { name: 'captcha title with 200', status: 200, title: 'Captcha', text: 'Bitte lösen Sie das Captcha.', requests: 3 },
  { name: 'JavaScript and cookies required, long text', status: 200, title: 'Sicherheitsprüfung', text: LONG_NOSCRIPT, requests: 2 },
  { name: 'empty page behind a script challenge, HTTP 202', status: 202, title: '', text: '', requests: 2 },
  { name: 'block notice inside an iframe: main document empty', status: 200, title: '', text: '', requests: 2 },
  { name: 'robot check, other English wording', status: 200, title: 'Robot Check', text: 'Please confirm that you are not a robot. Making sure you are not a bot…', requests: 4 },
];

// Check pages that say the browser is being checked and announce the redirect: named by the rule now.
const WITH_REDIRECT: Variant[] = [
  { name: 'classic browser check with the redirect sentence (EN)', status: 200, title: 'DDoS protection', text: 'Checking your browser before accessing the website. This process is automatic. Your browser will redirect to your requested content shortly. Please allow up to 5 seconds…', requests: 3 },
  { name: 'browser check with Weiterleitung (DE)', status: 200, title: 'Sicherheitsprüfung', text: 'Ihr Browser wird überprüft. Sie werden in wenigen Sekunden automatisch weitergeleitet.', requests: 3 },
];

function pageOf(v: Variant): PageSnapshot {
  return { title: v.title, lang: 'de', text: v.text, textTruncated: false, links: [], linksTruncated: false };
}

/** The capture as an adapter stores it: `ok` unless the classification names a failure. */
function captureOf(v: Variant, adapter: Capture['adapter'] = 'playwright-local'): Capture {
  const page = pageOf(v);
  const requests: RequestInput[] = Array.from({ length: v.requests }, (_, i) =>
    i === 0 ? { url: SHOP_URL, resourceType: 'document', isNavigation: true, status: v.status } : { url: `${SHOP_URL}check-${i}.js`, resourceType: 'script' },
  );
  const failure = classifyMainDocument(v.status, {}, v.title, pageEvidenceOf(page, requests.length));
  return makeCapture({
    adapter,
    requestedUrl: SHOP_URL,
    finalUrl: SHOP_URL,
    requests,
    page,
    ok: failure === null,
    failure,
    mainDocument: { status: v.status, headers: { 'strict-transport-security': 'max-age=31536000' }, redirectChain: [] },
    axe: axeResult({ 'color-contrast': { violations: 0, incomplete: 0, passes: 2, impact: null, examples: [], incompleteExamples: [] }, 'image-alt': { violations: 0, incomplete: 0, passes: 0, impact: null, examples: [], incompleteExamples: [] } }),
    httpProbe: { url: 'http://www.roesterei-muster.example/', startedAt: '2026-11-20T12:00:00.000Z', outcome: 'redirects-to-https', hops: [], httpsTarget: SHOP_URL, durationMs: 120 },
  });
}

describe('finding 3: a page that looks like bot protection outside the exact rule', () => {
  it.each(UNNAMED)('$name: no "erfüllt", no high risk for the Impressum link, a notice', (v) => {
    const capture = captureOf(v);
    expect(capture.ok).toBe(true);
    const analysis = analyzeCapture(capture, DEFAULT_RULES);
    expect(analysis.state).toBe('analyzed');
    expect(analysis.almostEmpty).toMatch(/^almost empty page: \d+ characters, 0 links, \d+ requests$/);
    const r = report(capture);
    expect(r.state).toBe('complete');
    expect(r.notice).toEqual({ textId: 'report-page-almost-empty', params: {} });
    expect(r.measures).toHaveLength(7);
    expect(r.measures.filter((m) => m.result === 'pass')).toEqual([]);
    expect(r.findings.find((f) => f.id === 'legal:impressum')).toMatchObject({ kind: 'manual', risk: null, textId: 'legal-impressum-no-link-empty-page' });
    expect(r.priorities).not.toContain('legal:impressum');
    expect(r.findings.filter((f) => f.risk === 'high')).toEqual([]);
  });

  it.each(WITH_REDIRECT)('$name: blocked, although the text announces the redirect', (v) => {
    const capture = captureOf(v);
    expect(capture).toMatchObject({ ok: false, failure: { reason: 'blocked' } });
    const r = report(capture);
    expect(r.state).toBe('blocked');
    expect(r.measures).toEqual([]);
    expect(r.findings).toEqual([]);
  });

  it('the pages the exact rule named before are still blocked, and a redirect page of the site is not', () => {
    expect(captureOf({ name: '', status: 200, title: 'Einen Moment bitte …', text: 'Bitte warten Sie, während Ihre Anfrage geprüft wird …', requests: 2 }).failure?.reason).toBe('blocked');
    expect(captureOf({ name: '', status: 200, title: 'Just a moment...', text: 'Checking your browser', requests: 3 }).failure?.reason).toBe('blocked');
    expect(captureOf({ name: '', status: 503, title: 'Captcha', text: 'Bitte lösen Sie das Captcha.', requests: 3 }).failure?.reason).toBe('blocked');
    // Only a "please wait" title and a redirect sentence: the site's own redirect page, as before.
    expect(captureOf({ name: '', status: 200, title: 'Einen Moment bitte', text: 'Sie werden in Kürze zu unserem neuen Shop weitergeleitet.', requests: 2 }).failure).toBeNull();
  });

  // Session fix-a2 (Fedor's answer to the question of fix-a1): if the page is a page of bot protection, what
  // was measured on it describes the protection, not the site. So it shows no findings, only the notice and
  // manual checks.
  describe('what such a page did show is no finding (session fix-a2)', () => {
    // A page of bot protection with everything that gave a finding before: a font from Google, a CDN hint,
    // contrast and image violations, no security header, no HTTPS redirect.
    const noisy = (v: Variant = UNNAMED[0] as Variant, adapter: Capture['adapter'] = 'playwright-local'): Capture => {
      const base = captureOf(v, adapter);
      const extra = (seq: number, url: string, resourceType: string): Capture['requests'][number] => ({ ...(base.requests[0] as Capture['requests'][number]), seq, url, resourceType, isNavigation: false });
      return {
        ...base,
        requests: [...base.requests, extra(9, 'https://fonts.googleapis.com/css2?family=Lato', 'stylesheet'), extra(10, 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', 'script')],
        mainDocument: { status: v.status, headers: {}, redirectChain: [] },
        axe: axeResult(),
        httpProbe: { url: 'http://www.roesterei-muster.example/', startedAt: '2026-11-20T12:00:00.000Z', outcome: 'no-redirect', hops: [], httpsTarget: null, durationMs: 120 },
      };
    };

    it('control: the same requests, headers and axe result on an ordinary page are findings', () => {
      const shop = shopCapture();
      const page = shop.page as PageSnapshot;
      const r = report({ ...noisy(), page: { ...page }, impressum: null });
      expect(r.notice).toBeNull();
      expect(r.findings.find((f) => f.id === 'third-party:google-fonts')).toMatchObject({ kind: 'finding', risk: 'high' });
      expect(r.findings.find((f) => f.id === 'security:headers')).toMatchObject({ kind: 'finding', risk: 'low' });
      expect(r.findings.find((f) => f.id === 'security:http-redirect')).toMatchObject({ kind: 'finding', risk: 'medium' });
      expect(r.findings.find((f) => f.id === 'a11y:color-contrast')).toMatchObject({ kind: 'finding', risk: 'medium' });
      expect(r.priorities.length).toBeGreaterThan(0);
    });

    it('no finding, no hint, no risk and nothing in "Drei Dinge": only the notice and manual checks', () => {
      const r = report(noisy());
      expect(r.state).toBe('complete');
      expect(r.notice).toEqual({ textId: 'report-page-almost-empty', params: {} });
      expect(r.findings.filter((f) => f.kind === 'finding' || f.kind === 'hint')).toEqual([]);
      expect(r.findings.filter((f) => f.risk !== null)).toEqual([]);
      expect(r.findings.length).toBeGreaterThan(0);
      expect(r.findings.every((f) => f.kind === 'manual')).toBe(true);
      expect(r.findings.map((f) => f.id)).toContain('legal:impressum');
      expect(r.priorities).toEqual([]);
      expect(r.counts).toMatchObject({ findings: 0, hints: 0 });
      expect(r.counts.manual).toBe(r.findings.length);
    });

    it('no Prüfmaß is "erfüllt" or "nicht erfüllt", and none shows a measured value', () => {
      const r = report(noisy());
      expect(r.measures).toHaveLength(7);
      expect(r.measures.map((m) => m.result)).toEqual(Array.from({ length: 7 }, () => 'manual'));
      expect(r.measures.filter((m) => m.actual !== null)).toEqual([]);
    });

    it('the Stückliste lists the services that were seen, none as "Einwilligung fehlt" and none tied to a finding', () => {
      const r = report(noisy());
      const fonts = r.services.find((s) => s.key === 'google-fonts');
      expect(fonts).toMatchObject({ consent: 'manual', severity: 'hint', findingId: null });
      expect(r.services.filter((s) => s.consent === 'missing' || s.severity === 'finding' || s.findingId !== null)).toEqual([]);
    });

    it('the quick check of such a page shows no finding either', () => {
      const v = UNNAMED[2] as Variant;
      const r = report({ ...noisy(v, 'quick-fetch'), axe: null, timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 300, stopReason: 'fetched' } }, 'quick');
      expect(r.state).toBe('quick');
      expect(r.notice).toEqual({ textId: 'report-quick-incomplete', params: { pageAlmostEmpty: true } });
      expect(r.findings.filter((f) => f.kind === 'finding' || f.kind === 'hint' || f.risk !== null)).toEqual([]);
      expect(r.measures.filter((m) => m.result === 'pass' || m.result === 'fail' || m.result === 'partial')).toEqual([]);
      expect(r.priorities).toEqual([]);
    });
  });

  it('the quick check of such a page keeps its own notice and gives no "erfüllt" and no high risk either', () => {
    const v = UNNAMED[2] as Variant;
    const r = report({ ...captureOf(v, 'quick-fetch'), axe: null, timings: { domContentLoadedMs: null, loadMs: null, networkQuietMs: null, endMs: 300, stopReason: 'fetched' } }, 'quick');
    expect(r.state).toBe('quick');
    expect(r.notice).toEqual({ textId: 'report-quick-incomplete', params: { pageAlmostEmpty: true } });
    expect(r.measures.filter((m) => m.result === 'pass')).toEqual([]);
    expect(r.findings.filter((f) => f.risk === 'high')).toEqual([]);
  });

  it('an ordinary page is untouched: no notice, its "erfüllt" rows and the risk of a missing Impressum link stay', () => {
    const shop = shopCapture();
    expect(analyzeCapture(shop, DEFAULT_RULES).almostEmpty).toBeNull();
    const r = report(shop);
    expect(r.notice).toBeNull();
    expect(results(r)).toContain('https:pass');
    expect(results(r)).toContain('impressum-fields:pass');
    const page = shop.page as PageSnapshot;
    const noLink = report({ ...shop, page: { ...page, links: page.links.filter((l) => l.text !== 'Impressum') }, impressum: null });
    expect(noLink.notice).toBeNull();
    expect(noLink.findings.find((f) => f.id === 'legal:impressum')).toMatchObject({ kind: 'manual', risk: 'high', textId: 'legal-impressum-no-link' });
  });

  it('a small page is almost empty only by its sizes and only without a link to Impressum or Datenschutz', () => {
    const small = { title: 'Baustelle', text: 'Hier entsteht eine neue Website.', links: 0, requests: 4 };
    expect(almostEmptyReason(small)).toBe('almost empty page: 32 characters, 0 links, 4 requests');
    expect(almostEmptyReason({ ...small, links: 4 })).toBeNull();
    expect(almostEmptyReason({ ...small, requests: 16 })).toBeNull();
    expect(almostEmptyReason({ ...small, text: 'Wort '.repeat(301) })).toBeNull();
    const withLink = captureOf(UNNAMED[2] as Variant);
    const page = withLink.page as PageSnapshot;
    const linked = { ...withLink, page: { ...page, links: [{ href: `${SHOP_URL}impressum/`, text: 'Impressum', footer: true }] }, impressum: null };
    expect(analyzeCapture(linked, DEFAULT_RULES).almostEmpty).toBeNull();
    expect(report(linked).notice).toBeNull();
  });
});
