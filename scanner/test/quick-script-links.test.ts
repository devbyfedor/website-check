import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';

/**
 * Session fix-a2, review finding 21: the quick check reads only the HTML source. A page whose links a
 * script builds in the browser must not get "Impressum-Link nicht gefunden" with a high risk, and a source
 * without any text and link says nothing about the mandatory information or the system. The pages are the
 * ones of the review's reproduction; a fake resolver and a fake fetch, nothing leaves the machine.
 */

const SITE = 'https://www.muster-app.de/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const PAGES = {
  // The whole page, footer links included, is built by /app.js.
  spaShell: '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster App</title></head><body><div id="root"></div><noscript>Bitte aktivieren Sie JavaScript.</noscript><script src="/app.js"></script></body></html>',
  // Server-rendered text and menu; only the footer links are built by /footer.js.
  jsFooter:
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster Praxis</title><meta name="generator" content="WordPress 6.9"></head><body><header><nav><a href="/leistungen">Leistungen</a> <a href="/team">Team</a> <a href="/sprechzeiten">Sprechzeiten</a> <a href="/anfahrt">Anfahrt</a> <a href="/kontakt">Kontakt</a></nav></header><main><h1>Muster Praxis</h1><p>Ihre Praxis in Musterhausen. Sprechzeiten Montag bis Freitag.</p></main><script src="/footer.js"></script></body></html>',
  // A web host's cookie test with HTTP 200: a script sets a cookie and reloads, the real page comes only then.
  cookieTest: '<!doctype html><html><head><meta charset="utf-8"><script>document.cookie="wc_test=1; path=/";location.reload();</script></head><body></body></html>',
  // Control: the footer links are in the HTML source.
  linksInHtml:
    '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Muster Praxis</title><meta name="generator" content="WordPress 6.9"></head><body><main><h1>Muster Praxis</h1><p>Ihre Praxis in Musterhausen.</p><a href="/leistungen">Leistungen</a> <a href="/kontakt">Kontakt</a></main><footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer></body></html>',
} as const;

const IMPRESSUM = '<!doctype html><html lang="de"><head><title>Impressum</title></head><body><h1>Impressum</h1><p>Muster App GmbH<br>Musterweg 1<br>87654 Musterhausen</p><p>E-Mail: info@muster-app.de</p></body></html>';

async function quickReport(homeHtml: string, mode: 'quick' | 'full' = 'quick'): Promise<{ report: Report; text: number; links: number }> {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === SITE) return new Response(homeHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'strict-transport-security': 'max-age=31536000' } });
    if (url === 'http://www.muster-app.de/') return new Response(null, { status: 301, headers: { location: SITE } });
    if (url === `${SITE}impressum`) return new Response(IMPRESSUM, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
  const capture = await quickCapture(SITE, { guard: createUrlGuard({ resolve: async () => ['93.184.215.14'] }), userAgent: UA, fetch: fetchFn });
  expect(capture.ok).toBe(true);
  const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-23T10:00:00.000Z', siteUrl: SITE, mode, capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(report)).toEqual([]);
  return { report, text: capture.page?.text.trim().length ?? -1, links: capture.page?.links.length ?? -1 };
}

const impressum = (r: Report) => r.findings.find((f) => f.id === 'legal:impressum');

describe('finding 21: the quick check of a page whose links a script builds', () => {
  it('server-rendered text, footer built by a script: the missing link is a limit of the method, without a risk', async () => {
    const { report: r, links } = await quickReport(PAGES.jsFooter);
    // More than three links: an ordinary small page, not an "almost empty" one.
    expect(links).toBe(5);
    expect(r.state).toBe('quick');
    expect(impressum(r)).toMatchObject({ kind: 'manual', risk: null, textId: 'legal-impressum-no-link-quick' });
    expect(r.priorities).not.toContain('legal:impressum');
    expect(r.findings.filter((f) => f.area === 'mandatory-information' && f.risk !== null)).toEqual([]);
    // What the source did show is still read: the page has text and links, and names its system.
    expect(r.sections.legal).toEqual({ status: 'checked', reason: null });
    expect(r.platform?.system).toBe('wordpress');
  });

  it.each([
    ['the shell of a page that a script fills', PAGES.spaShell],
    ['a page that only sets a cookie and reloads', PAGES.cookieTest],
  ])('%s: no text and no link in the source, so mandatory information and system are "nicht geprüft"', async (_name, html) => {
    const { report: r, text, links } = await quickReport(html);
    expect([text, links]).toEqual([0, 0]);
    expect(r.state).toBe('quick');
    expect(r.notice?.textId).toBe('report-quick-incomplete');
    expect(r.sections.legal).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(r.sections.platform).toEqual({ status: 'not-checked', reason: 'quick-check' });
    expect(r.sections.security).toEqual({ status: 'checked', reason: null });
    expect(r.legal).toBeNull();
    expect(r.platform).toBeNull();
    expect(r.findings.filter((f) => f.area === 'mandatory-information')).toEqual([]);
    expect(r.findings.filter((f) => f.risk === 'high')).toEqual([]);
    expect(r.priorities.filter((id) => id.startsWith('legal:'))).toEqual([]);
    expect(r.measures.filter((m) => m.id === 'impressum-fields' || m.id === 'accessibility-statement').map((m) => m.result)).toEqual(['not-checked', 'not-checked']);
    expect(r.pages).toEqual({ homepage: 'checked', impressum: 'not-checked' });
  });

  it('control: links in the HTML source are found and the Impressum is read', async () => {
    const { report: r } = await quickReport(PAGES.linksInHtml);
    expect(impressum(r)).toBeUndefined();
    expect(r.sections.legal.status).toBe('checked');
    expect(r.legal?.impressumLink).toMatchObject({ text: 'Impressum' });
    expect(r.pages.impressum).toBe('checked');
    expect(r.platform?.system).toBe('wordpress');
  });

  it('control: the full check with the browser keeps the risk of a missing Impressum link', async () => {
    // The same capture as a full report: there the browser built the page, so a missing link is a fact of the page.
    const { report: r } = await quickReport(PAGES.jsFooter, 'full');
    expect(impressum(r)).toMatchObject({ kind: 'manual', risk: 'high', textId: 'legal-impressum-no-link' });
    expect(r.priorities).toContain('legal:impressum');
  });
});
