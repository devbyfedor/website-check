import { describe, expect, it } from 'vitest';
import { axeCaptureFrom } from '../src/a11y/axe-script.ts';
import { analyzeCapture } from '../src/analyzers/capture.ts';
import { checkPermissionsPolicy } from '../src/analyzers/security.ts';
import { CAPTURE_LIMITS, cutUrl, limitCapture, limitPageSnapshot, limitSnapshot, RequestBudget } from '../src/capture/limits.ts';
import type { Capture, PageLink } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { extractImpressumFields, indexOfLinear } from '../src/legal/fields.ts';
import { decodeHtml, snapshotFromHtml } from '../src/quick/html-snapshot.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport, type BuiltReport } from '../src/report/build.ts';
import { REPORT_LIMITS } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { createDohResolver } from '../src/security/doh.ts';
import { createFetchBudget, QUICK_CHECK_FETCHES } from '../src/security/fetch-budget.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';
import type { CompiledRules } from '../src/rules/match.ts';
import { makeCapture } from './helpers.ts';
import { axeResult, shopCapture, SHOP } from './report-helpers.ts';

/**
 * Session fix-a4: limits and heavy pages (review findings 4, 10, 11, 12, 13 and the small findings 25, 51,
 * 54, 61), built from the review's reproductions. Synthetic data only: invented names, a fake resolver and
 * a fake fetch. The pages themselves run through both adapters in the integration tests.
 *
 * Speed is measured as CPU time of the process with wide bounds (the slow code needed seconds to minutes),
 * so a busy machine does not fail the tests.
 */

const ID = 'abcdefghijklmnopqrstuvwxyz';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

function build(capture: Capture, mode: 'full' | 'quick' = 'full', rules: CompiledRules = DEFAULT_RULES): BuiltReport {
  return buildReport({ id: ID, createdAt: '2026-11-24T10:00:00.000Z', siteUrl: SHOP, mode, capture, rules, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated, visit: { country: 'DE', colo: 'FRA' } });
}

function cpuMs(work: () => void): number {
  const before = process.cpuUsage();
  work();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

function jsonLength(value: unknown): number {
  return JSON.stringify(value).length;
}

describe('finding 4: the number of requests and the length of their addresses are bounded', () => {
  it('an address longer than the limit keeps its start; an inline address keeps only a short start', () => {
    const long = `https://www.roesterei-muster.example/n?${'p'.repeat(1_000_000)}`;
    expect(cutUrl(long)).toHaveLength(CAPTURE_LIMITS.urlLength);
    expect(cutUrl(long).startsWith('https://www.roesterei-muster.example/n?ppp')).toBe(true);
    expect(cutUrl(`data:image/png;base64,${'A'.repeat(50_000)}`)).toHaveLength(CAPTURE_LIMITS.inlineUrlLength);
    expect(cutUrl('https://www.roesterei-muster.example/kurz')).toBe('https://www.roesterei-muster.example/kurz');
  });

  it('200 requests with an address of 1 MB each: the capture stays small, the report is built fast and is complete', () => {
    const pad = 'p'.repeat(1_000_000);
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true }, ...Array.from({ length: 200 }, (_, i) => ({ url: `${SHOP}n?${i}${pad}`, resourceType: 'fetch', failure: 'net::ERR_ABORTED', status: null }))];
    const capture = shopCapture({ requests: makeCapture({ requests }).requests });
    const limited = limitCapture(capture);
    expect(limited.ok).toBe(true);
    expect(limited.requests).toHaveLength(201);
    expect(Math.max(...limited.requests.map((r) => r.url.length))).toBe(CAPTURE_LIMITS.urlLength);
    expect(limited.limited?.strings).toBe(200);
    expect(jsonLength(limited)).toBeLessThan(CAPTURE_LIMITS.maxCaptureChars);
    let built: BuiltReport | null = null;
    const ms = cpuMs(() => {
      built = build(capture);
    });
    expect(ms).toBeLessThan(1_000);
    const report = (built as unknown as BuiltReport).report;
    expect(report.state).toBe('complete');
    expect(validateReport(report)).toEqual([]);
  });

  it('a page with more requests than the limit is a failed capture: the report says so and shows no findings', () => {
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true }, ...Array.from({ length: 60_000 }, (_, i) => ({ url: `${SHOP}n?${i}`, resourceType: 'fetch' }))];
    const capture = shopCapture({ requests: makeCapture({ requests }).requests });
    const limited = limitCapture(capture);
    expect(limited.ok).toBe(false);
    expect(limited.failure?.reason).toBe('page-limit');
    expect(limited.failure?.message).toContain(`more than ${CAPTURE_LIMITS.maxRequests} requests`);
    expect(limited.requests.length).toBeLessThanOrEqual(CAPTURE_LIMITS.maxRequests);
    expect(limited.page).toBeNull();
    expect(jsonLength(limited)).toBeLessThan(CAPTURE_LIMITS.maxCaptureChars);
    const { report, networkHosts } = build(capture);
    expect(report.state).toBe('failed');
    expect(report.failure).toEqual({ reason: 'page-limit', status: null });
    expect(report.notice).toEqual({ textId: 'report-failed', params: { reason: 'page-limit', status: null } });
    expect(report.findings).toEqual([]);
    expect(report.services).toEqual([]);
    expect(report.measures).toEqual([]);
    expect(networkHosts).toEqual([]);
    expect(validateReport(report)).toEqual([]);
  });

  it('requests whose addresses are longer than the budget in all make the capture fail too', () => {
    const pad = 'q'.repeat(1_900);
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true }, ...Array.from({ length: 1_500 }, (_, i) => ({ url: `${SHOP}n?${i}${pad}`, resourceType: 'fetch' }))];
    const limited = limitCapture(shopCapture({ requests: makeCapture({ requests }).requests }));
    expect(limited.failure?.reason).toBe('page-limit');
    expect(limited.failure?.message).toContain('addresses');
    expect(limited.requests.reduce((sum, r) => sum + r.url.length, 0)).toBeLessThanOrEqual(CAPTURE_LIMITS.requestChars);
  });

  it('the budget of an adapter stops at the first request over a limit and stays stopped', () => {
    const budget = new RequestBudget();
    const request = makeCapture({ requests: [{ url: `${SHOP}n` }] }).requests[0];
    if (request === undefined) throw new Error('no request');
    for (let i = 0; i < CAPTURE_LIMITS.maxRequests; i += 1) expect(budget.add(request)).toBe(true);
    expect(budget.add(request)).toBe(false);
    expect(budget.exceeded).toBe('requests');
    expect(budget.add(request)).toBe(false);
  });

  it('a refusal of the address rules stays the reason of a capture that is also over the limit', () => {
    const requests = Array.from({ length: 3_000 }, (_, i) => ({ url: `${SHOP}n?${i}` }));
    const limited = limitCapture(makeCapture({ requests, ok: false, failure: { reason: 'not-allowed', message: 'not allowed: private-address' } }));
    expect(limited.failure?.reason).toBe('not-allowed');
  });

  it('an ordinary capture is not changed by the limits', () => {
    const capture = shopCapture();
    const limited = limitCapture(capture);
    expect(limited).toEqual(capture);
    expect(limited.limited).toBeUndefined();
  });
});

describe('finding 10: what a script in the page returns is bounded', () => {
  const hostileSnapshot = (): Record<string, unknown> => ({
    url: `https://www.roesterei-muster.example/links?${'q'.repeat(20_000)}`,
    title: 'T'.repeat(5_000_000),
    lang: 'l'.repeat(5_000_000),
    text: 'Hallo',
    textTruncated: false,
    links: Array.from({ length: 1_600 }, (_, i) => ({ href: `https://www.roesterei-muster.example/links?${'q'.repeat(20_000)}#a${i}`, text: 'x', footer: false })),
    linksTruncated: true,
    probe: { found: { toolId: 'x'.repeat(5_000_000), selector: 's'.repeat(5_000_000), method: 'selector', at: 1 }, present: { ['p'.repeat(5_000_000)]: 1, cookiebot: 2 } },
    signals: { cookiebot: { consented: false, declined: false, method: 'm'.repeat(5_000_000) }, usercentrics: null },
    timeOrigin: 1_700_000_000_000,
    securityMeta: { csp: 'c'.repeat(50_000), referrer: null },
    platform: { generators: Array.from({ length: 500 }, () => 'g'.repeat(10_000)), globals: Array.from({ length: 5_000 }, () => 'Shopify.shop'), selectors: [] },
  });

  it('a snapshot with a long document address, 1,600 links and megabyte strings is cut to the limits', () => {
    const snapshot = limitSnapshot(hostileSnapshot());
    expect(snapshot).not.toBeNull();
    if (snapshot === null) return;
    expect(jsonLength(snapshot)).toBeLessThan(20_000);
    expect(snapshot.url).toHaveLength(CAPTURE_LIMITS.urlLength);
    expect(snapshot.title).toHaveLength(CAPTURE_LIMITS.titleLength);
    expect(snapshot.lang).toHaveLength(CAPTURE_LIMITS.langLength);
    // Every link has an address over the limit: none is kept, and the snapshot says that links were left out.
    expect(snapshot.links).toEqual([]);
    expect(snapshot.linksTruncated).toBe(true);
    expect(snapshot.probe?.found?.toolId).toHaveLength(CAPTURE_LIMITS.toolIdLength);
    expect(snapshot.probe?.found?.selector).toHaveLength(CAPTURE_LIMITS.selectorLength);
    expect(Object.keys(snapshot.probe?.present ?? {})).toEqual(['cookiebot']);
    expect(snapshot.signals?.cookiebot?.method).toHaveLength(CAPTURE_LIMITS.shortText);
    expect(snapshot.securityMeta?.csp).toHaveLength(CAPTURE_LIMITS.metaLength);
    expect(snapshot.platform?.generators).toHaveLength(5);
    expect(snapshot.platform?.globals.length).toBeLessThanOrEqual(CAPTURE_LIMITS.platformEntries);
  });

  it('wrong types become empty values, never an exception later', () => {
    const page = limitPageSnapshot({ title: 7, lang: {}, text: null, links: null, linksTruncated: 'yes', securityMeta: 'x', platform: [] });
    expect(page).toEqual({ title: '', lang: null, text: '', textTruncated: false, links: [], linksTruncated: false });
    expect(limitPageSnapshot(null)).toBeNull();
    expect(limitPageSnapshot('<html>')).toBeNull();
    expect(limitSnapshot(undefined)).toBeNull();
  });

  it('links share a budget of address characters; links over it are left out and the snapshot says so', () => {
    const href = (i: number): string => `https://www.roesterei-muster.example/${'k'.repeat(1_900)}/${i}`;
    const page = limitPageSnapshot({ title: 't', lang: 'de', text: 'x', textTruncated: false, linksTruncated: false, links: Array.from({ length: 1_500 }, (_, i) => ({ href: href(i), text: `Link ${i}` })) });
    expect(page?.linksTruncated).toBe(true);
    const chars = (page?.links ?? []).reduce((sum, link) => sum + link.href.length, 0);
    expect(chars).toBeLessThanOrEqual(CAPTURE_LIMITS.linkChars);
    expect(page?.links.length).toBeGreaterThan(100);
    expect(page?.links.length).toBeLessThan(200);
  });

  it('an accessibility result made by the page (megabyte selectors, snippets and a long version) is cut to the limits', () => {
    const big = 'x'.repeat(1_000_000);
    const contrast = { ratio: 1, expected: big, fgColor: big, bgColor: big, fontSize: big, fontWeight: big, messageKey: big };
    const example = { target: [big, big, big, big, big, big, big], html: big, contrast };
    const rules: Record<string, unknown> = {};
    for (const id of ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name', 'html-has-lang', 'html-lang-valid']) {
      rules[id] = { violations: 5, incomplete: 0, passes: 0, impact: big, examples: Array.from({ length: 50 }, () => example), incompleteExamples: [] };
    }
    const axe = axeCaptureFrom({ status: 'ok', error: null, axeVersion: big, rules, ruleErrors: [big, big, big], lowestContrast: { violation: contrast, pass: contrast }, runMs: 5, junk: [big, big] }, { injectMs: 1, totalMs: 6 });
    expect(axe.status).toBe('ok');
    expect(jsonLength(axe)).toBeLessThan(200_000);
    expect(axe.axeVersion).toHaveLength(CAPTURE_LIMITS.shortText);
    const rule = axe.rules['image-alt'];
    expect(rule?.examples).toHaveLength(CAPTURE_LIMITS.axeExamples);
    expect(rule?.examples[0]?.target).toHaveLength(CAPTURE_LIMITS.axeTargetParts);
    expect(rule?.examples[0]?.target[0]).toHaveLength(CAPTURE_LIMITS.axeTargetLength);
    expect(rule?.examples[0]?.html).toHaveLength(CAPTURE_LIMITS.axeHtmlLength);
    expect(rule?.impact).toHaveLength(CAPTURE_LIMITS.shortText);
    expect((axe as unknown as Record<string, unknown>)['junk']).toBeUndefined();
  });

  it('a capture that is still too large as a whole is a failed capture without the data of the page', () => {
    // 100,000 control characters are 600,000 characters of JSON; two pages and the requests pass 2 MB.
    const text = '\u0001'.repeat(100_000);
    const links: PageLink[] = Array.from({ length: 1_500 }, (_, i) => ({ href: `${SHOP}k/${i}`, text: '\u0001'.repeat(200) }));
    const page = { url: SHOP, title: 't', lang: 'de', text, textTruncated: true, links, linksTruncated: false };
    const base = shopCapture();
    const impressum = base.impressum;
    if (impressum === undefined || impressum === null) throw new Error('no impressum');
    const limited = limitCapture({ ...base, page, impressum: { ...impressum, page } });
    expect(jsonLength(limited)).toBeLessThan(CAPTURE_LIMITS.maxCaptureChars);
    expect(limited.ok).toBe(false);
    expect(limited.failure?.reason).toBe('page-limit');
    expect(limited.page).toBeNull();
    const { report } = build({ ...base, page, impressum: { ...impressum, page } });
    expect(report.state).toBe('failed');
    expect(validateReport(report)).toEqual([]);
  });
});

describe('finding 11: a long <base href> is not repeated in every link of the quick check', () => {
  const page = (base: string, anchors = 1_700): string =>
    `<!doctype html><html lang="de"><head><base href="${base}"><title>Startseite</title></head><body><h1>Hallo</h1><p>Willkommen.</p>${Array.from({ length: anchors }, (_, i) => `<a href="#impressum${i}">x</a>`).join('')}</body></html>`;

  it.each([
    ['a query of 100,000 characters', `https://www.muster-werkstatt.de/?${'q'.repeat(100_000)}`],
    ['a path of 20,000 short parts', `https://www.muster-werkstatt.de/${'a/'.repeat(10_000)}`],
    ['a path of 40,000 short parts', `https://www.muster-werkstatt.de/${'a/'.repeat(20_000)}`],
  ])('%s: the links are left out, the snapshot says so, and reading it is fast', (_name, base) => {
    const html = page(base);
    let snapshot: ReturnType<typeof snapshotFromHtml> | null = null;
    const ms = cpuMs(() => {
      snapshot = snapshotFromHtml(html, 'https://www.muster-werkstatt.de/');
    });
    const snap = snapshot as unknown as ReturnType<typeof snapshotFromHtml>;
    expect(ms).toBeLessThan(1_000);
    expect(snap.links.reduce((sum, link) => sum + link.href.length, 0)).toBeLessThanOrEqual(CAPTURE_LIMITS.linkChars);
    expect(snap.links).toEqual([]);
    expect(snap.linksTruncated).toBe(true);
  });

  it('a base address within the limit works as before, and an absolute link is kept beside a base that is too long', () => {
    const ok = snapshotFromHtml('<!doctype html><html><head><base href="https://www.muster-werkstatt.de/shop/"></head><body><a href="impressum">Impressum</a></body></html>', 'https://www.muster-werkstatt.de/');
    expect(ok.links).toEqual([{ href: 'https://www.muster-werkstatt.de/shop/impressum', text: 'Impressum', footer: false }]);
    expect(ok.linksTruncated).toBe(false);
    const long = snapshotFromHtml(`<!doctype html><html><head><base href="https://www.muster-werkstatt.de/?${'q'.repeat(5_000)}"></head><body><a href="rel">Relativ</a><a href="https://www.muster-werkstatt.de/impressum/">Impressum</a></body></html>`, 'https://www.muster-werkstatt.de/');
    expect(long.links).toEqual([{ href: 'https://www.muster-werkstatt.de/impressum/', text: 'Impressum', footer: false }]);
    expect(long.linksTruncated).toBe(true);
  });

  it('the whole quick check of such a page: a small capture, a fast report, and a missing Impressum link without a risk', async () => {
    const site = 'https://www.muster-werkstatt.de/';
    const bytes = new TextEncoder().encode(page(`${site}?${'q'.repeat(100_000)}`).replace(/#impressum/g, '#a'));
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://')) return new Response(null, { status: 301, headers: { location: site } });
      return new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as typeof fetch;
    const capture = await quickCapture(site, { guard: createUrlGuard({ resolve: async () => ['93.184.215.14'] }), userAgent: UA, fetch: fakeFetch });
    expect(capture.ok).toBe(true);
    expect(jsonLength(capture)).toBeLessThan(20_000);
    expect(capture.page?.linksTruncated).toBe(true);
    let built: BuiltReport | null = null;
    const ms = cpuMs(() => {
      built = buildReport({ id: ID, createdAt: '2026-11-24T10:00:00.000Z', siteUrl: site, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated });
    });
    expect(ms).toBeLessThan(1_000);
    const report = (built as unknown as BuiltReport).report;
    expect(validateReport(report)).toEqual([]);
    expect(report.truncated.page).toEqual(['homepage-links']);
    const impressum = report.findings.find((f) => f.id === 'legal:impressum');
    expect(impressum?.textId).toBe('legal-impressum-no-link-links-cut');
    expect(impressum?.risk).toBeNull();
    expect(report.priorities).not.toContain('legal:impressum');
  });

  it('in a full check too, a missing Impressum link carries no risk when the scan did not read every link', () => {
    const base = shopCapture();
    if (base.page === null) throw new Error('no page');
    const page = { ...base.page, links: base.page.links.filter((l) => !/impressum/i.test(l.href)), text: `${base.page.text}\n${'Kaffee aus Musterhausen. '.repeat(100)}` };
    const withAll = build({ ...base, page, impressum: null }).report.findings.find((f) => f.id === 'legal:impressum');
    expect(withAll?.textId).toBe('legal-impressum-no-link');
    expect(withAll?.risk).toBe('high');
    const cut = build({ ...base, page: { ...page, linksTruncated: true }, impressum: null }).report;
    const finding = cut.findings.find((f) => f.id === 'legal:impressum');
    expect(finding?.textId).toBe('legal-impressum-no-link-links-cut');
    expect(finding?.kind).toBe('manual');
    expect(finding?.risk).toBeNull();
    expect(cut.truncated.page).toContain('homepage-links');
  });
});

describe('finding 12: the place of a mailto link in the text is found in linear time', () => {
  const text = 'a '.repeat(50_000);

  it('1,600 links whose text holds the address after 90 words of the page: fast, and the field stays not found', () => {
    const links: PageLink[] = Array.from({ length: 1_600 }, (_, i) => ({ href: `mailto:p${i}@andere-firma.de`, text: `${'a '.repeat(88)}q p${i}@andere-firma.de`, footer: false }));
    let status = '';
    const ms = cpuMs(() => {
      status = extractImpressumFields(text, links, new Set(['muster-werkstatt.de'])).email.status;
    });
    expect(status).toBe('not-found');
    expect(ms).toBeLessThan(1_000);
  });

  it("1,600 links of Cloudflare's e-mail protection with a text of 99 words of the page: fast", () => {
    // "p@andere-firma.de" with the key 0x00: the address bytes in hex after "00".
    const hex = `00${[...'p@andere-firma.de'].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
    const links: PageLink[] = Array.from({ length: 1_600 }, () => ({ href: `https://www.muster-werkstatt.de/cdn-cgi/l/email-protection#${hex}`, text: `${'a '.repeat(98)}q`, footer: false }));
    let status = '';
    const ms = cpuMs(() => {
      status = extractImpressumFields(text, links, new Set(['muster-werkstatt.de'])).email.status;
    });
    expect(status).toBe('not-found');
    expect(ms).toBeLessThan(1_000);
  });

  it('a link that shows its address is still found where the page shows it, whatever the spaces', () => {
    const page = 'Impressum\nMuster Werkstatt GmbH\nMusterweg 12\n87654 Musterhausen\nE-Mail:  kontakt@andere-domain.de\n';
    const found = extractImpressumFields(page, [{ href: 'mailto:kontakt@andere-domain.de', text: 'kontakt@andere-domain.de' }], new Set(['muster-werkstatt.de'])).email;
    expect(found.status).toBe('found');
    const spaced = extractImpressumFields('Impressum\nMuster Werkstatt GmbH\nMusterweg 12\n87654 Musterhausen\nSchreiben Sie an  Büro   kontakt@andere-domain.de heute', [{ href: 'mailto:kontakt@andere-domain.de', text: 'an Büro kontakt@andere-domain.de' }], new Set(['muster-werkstatt.de'])).email;
    expect(spaced.status).toBe('found');
  });

  it('the linear search gives the same places as indexOf', () => {
    const hay = 'abababcabababd abab';
    for (const needle of ['abababd', 'ab', 'c', 'x', 'abab', ' abab', 'd a']) {
      for (const from of [0, 1, 7, 14, 40]) expect(indexOfLinear(hay, needle, from)).toBe(hay.indexOf(needle, from));
    }
    const repetitive = 'a '.repeat(50_000);
    expect(indexOfLinear(repetitive, `${'a '.repeat(98)}q`, 0)).toBe(-1);
    expect(indexOfLinear(`${repetitive}q`, `${'a '.repeat(98)}q`, 0)).toBe(100_000 - 196);
  });
});

describe('finding 13: a Permissions-Policy header with a long run of spaces', () => {
  it.each([64_000, 200_000])('%i spaces inside the value are parsed in linear time', (n) => {
    const value = `a=()${' '.repeat(n)},b=()`;
    let status = '';
    const ms = cpuMs(() => {
      status = checkPermissionsPolicy(value, undefined).status;
    });
    expect(status).toBe('present');
    expect(ms).toBeLessThan(500);
  });

  it('tabs and spaces at both ends are still ignored', () => {
    expect(checkPermissionsPolicy(' \t geolocation=() \t ', undefined).status).toBe('present');
    expect(checkPermissionsPolicy('\t', undefined).status).toBe('missing');
  });

  it('a header value longer than the limit is not kept and not analysed: "bitte manuell prüfen", never "fehlt"', () => {
    const value = `geolocation=()${' '.repeat(200_000)},camera=()`;
    const capture = shopCapture({ mainDocument: { status: 200, headers: { 'strict-transport-security': 'max-age=31536000', 'permissions-policy': value, 'content-security-policy-report-only': 'd'.repeat(20_000) }, redirectChain: [] } });
    const limited = limitCapture(capture);
    expect(limited.mainDocument?.headers['permissions-policy']).toBeUndefined();
    expect(limited.mainDocument?.headersCut).toEqual(['content-security-policy-report-only', 'permissions-policy']);
    let built: BuiltReport | null = null;
    const ms = cpuMs(() => {
      built = build(capture);
    });
    expect(ms).toBeLessThan(1_000);
    const report = (built as unknown as BuiltReport).report;
    expect(validateReport(report)).toEqual([]);
    const header = report.security?.headers.find((h) => h.key === 'permissions-policy');
    expect(header).toMatchObject({ status: 'manual', counts: false, value: null, textId: 'security-header-too-long' });
    // The report-only form of the CSP was left out and the header itself is not set: not "fehlt" either.
    expect(report.security?.headers.find((h) => h.key === 'csp')).toMatchObject({ status: 'manual', textId: 'security-header-too-long' });
    expect(report.security?.headers.find((h) => h.key === 'hsts')?.status).toBe('present');
    expect(report.truncated.page).toContain('headers');
  });

  it('a header of ordinary length is kept as it is', () => {
    const csp = `default-src 'self'; ${'img-src https://bilder.roesterei-muster.example; '.repeat(60)}`;
    const limited = limitCapture(shopCapture({ mainDocument: { status: 200, headers: { 'content-security-policy': csp }, redirectChain: [] } }));
    expect(limited.mainDocument?.headers['content-security-policy']).toBe(csp);
    expect(limited.mainDocument?.headersCut).toBeUndefined();
  });
});

describe('finding 25: a quick check makes at most 45 requests', () => {
  // A site whose http address, homepage and Impressum each pass five redirects, every step on a new host.
  function world(): { fetch: typeof fetch; counts: { doh: number; site: number } } {
    const counts = { doh: 0, site: 0 };
    const html = (title: string, impressum: string): string =>
      `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>${'Wir backen jeden Tag frisch. '.repeat(40)}</p></main><footer><a href="${impressum}">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer></body></html>`;
    const fn = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === 'cloudflare-dns.com') {
        counts.doh += 1;
        const answer = url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.215.14' }] : [];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200, headers: { 'content-type': 'application/dns-json' } });
      }
      counts.site += 1;
      const m = /^([a-z])(\d)\.kette-pruefung\.de$/.exec(url.hostname);
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      if (m === null) return new Response('not found', { status: 404, headers });
      const kind = m[1] as string;
      const n = Number(m[2]);
      if (url.protocol === 'http:') return new Response(null, { status: 302, headers: { location: `http://p${kind === 's' ? 1 : n + 1}.kette-pruefung.de/` } });
      if (kind === 's') return new Response(null, { status: 302, headers: { location: 'https://h1.kette-pruefung.de/' } });
      if (kind === 'h' && n < 5) return new Response(null, { status: 302, headers: { location: `https://h${n + 1}.kette-pruefung.de/` } });
      if (kind === 'h') return new Response(html('Kette', 'https://i0.kette-pruefung.de/impressum'), { status: 200, headers });
      if (kind === 'i' && n < 5) return new Response(null, { status: 302, headers: { location: `https://i${n + 1}.kette-pruefung.de/impressum` } });
      return new Response(html('Impressum', '/impressum'), { status: 200, headers });
    }) as typeof fetch;
    return { fetch: fn, counts };
  }

  it('without a budget the crafted site needs more than 50 requests (the review counted 52)', async () => {
    const w = world();
    const guard = createUrlGuard({ resolve: createDohResolver(w.fetch) });
    const capture = await quickCapture('https://s0.kette-pruefung.de/', { guard, userAgent: UA, fetch: w.fetch });
    expect(capture.ok).toBe(true);
    expect(w.counts.doh + w.counts.site).toBeGreaterThan(50);
  });

  it('with the budget of the queue object: at most 44 requests, the homepage is read, the Impressum is "bitte manuell prüfen"', async () => {
    const w = world();
    const fetchBudget = createFetchBudget(QUICK_CHECK_FETCHES, w.fetch);
    const guard = createUrlGuard({ resolve: createDohResolver(fetchBudget.fetch) });
    const site = 'https://s0.kette-pruefung.de/';
    const capture = await quickCapture(site, { guard, userAgent: UA, fetchBudget });
    expect(QUICK_CHECK_FETCHES).toBe(44);
    expect(w.counts.doh + w.counts.site).toBeLessThanOrEqual(QUICK_CHECK_FETCHES);
    expect(fetchBudget.used()).toBe(w.counts.doh + w.counts.site);
    expect(fetchBudget.refused()).toBeGreaterThan(0);
    // The homepage and the redirect check finished within the budget.
    expect(capture.ok).toBe(true);
    expect(capture.httpProbe?.outcome).toBeDefined();
    expect(capture.impressum?.ok).toBe(false);
    expect(capture.impressum?.failure?.reason).toBe('page-limit');
    const { report } = buildReport({ id: ID, createdAt: '2026-11-24T10:00:00.000Z', siteUrl: site, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated });
    expect(validateReport(report)).toEqual([]);
    expect(report.state).toBe('quick');
    expect(report.legal?.impressum.state).toBe('failed');
    expect(report.findings.find((f) => f.id === 'legal:impressum')).toMatchObject({ kind: 'manual', risk: null, textId: 'legal-impressum-failed' });
  });

  it('an ordinary site stays far below the budget', async () => {
    const calls: string[] = [];
    const page = '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bäckerei Beispiel</title></head><body><main><p>Willkommen in der Bäckerei.</p></main><footer><a href="/impressum">Impressum</a></footer></body></html>';
    const plain = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url.href);
      if (url.hostname === 'cloudflare-dns.com') return new Response(JSON.stringify({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.215.14' }] : [] }), { status: 200 });
      if (url.protocol === 'http:') return new Response(null, { status: 301, headers: { location: `https://${url.hostname}/` } });
      return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as typeof fetch;
    const fetchBudget = createFetchBudget(QUICK_CHECK_FETCHES, plain);
    const capture = await quickCapture('https://www.baeckerei-beispiel.de/', { guard: createUrlGuard({ resolve: createDohResolver(fetchBudget.fetch) }), userAgent: UA, fetchBudget });
    expect(capture.ok).toBe(true);
    expect(capture.impressum?.ok).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(6);
    expect(fetchBudget.refused()).toBe(0);
  });
});

describe('finding 51: one failing analysis does not end the scan', () => {
  it('130,000 requests of the site itself do not throw: the capture is over the limit and the report says so', () => {
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0 }, ...Array.from({ length: 130_000 }, (_, i) => ({ url: `${SHOP}f/${i}.js`, resourceType: 'script', startMs: 10 + (i % 2_000) }))];
    const { report } = build(shopCapture({ requests: makeCapture({ requests }).requests }));
    expect(report.state).toBe('failed');
    expect(report.failure?.reason).toBe('page-limit');
    expect(validateReport(report)).toEqual([]);
  });

  it('a snapshot with links: null is read as a page without links, not as an exception', () => {
    const base = shopCapture();
    const broken = { ...base, page: { ...base.page, links: null } } as unknown as Capture;
    const analysis = analyzeCapture(broken, DEFAULT_RULES);
    expect(analysis.state).toBe('analyzed');
    expect(analysis.errors).toBeUndefined();
    expect(analysis.legal?.links.impressum).toBeNull();
    expect(validateReport(build(broken).report)).toEqual([]);
  });

  it('an analysis that throws leaves its part "nicht geprüft"; the other parts and the report stand', () => {
    const throwing = new Proxy(DEFAULT_RULES, {
      get(target, key, receiver) {
        if (key === 'match') {
          return () => {
            throw new TypeError('rules broke');
          };
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const analysis = analyzeCapture(shopCapture(), throwing);
    expect(analysis.state).toBe('analyzed');
    expect(analysis.thirdParty).toBeNull();
    expect(analysis.errors?.thirdParty).toContain('rules broke');
    expect(analysis.legal).not.toBeNull();
    expect(analysis.security).not.toBeNull();
    const { report } = build(shopCapture(), 'full', throwing);
    expect(validateReport(report)).toEqual([]);
    expect(report.state).toBe('complete');
    expect(report.sections.thirdParty).toEqual({ status: 'not-checked', reason: 'analyzer-error' });
    expect(report.sections.legal.status).toBe('checked');
    expect(report.sections.security.status).toBe('checked');
    expect(report.measures.find((m) => m.id === 'third-party-before-consent')?.result).toBe('not-checked');
    expect(report.measures.find((m) => m.id === 'impressum-fields')?.result).toBe('pass');
    expect(report.findings.find((f) => f.id === 'scan:not-analysed:thirdparty')).toMatchObject({ kind: 'not-checked', area: 'privacy', textId: 'section-not-analysed', risk: null });
    expect(report.services).toEqual([]);
    expect(report.timeline).toBeNull();
  });
});

describe('finding 54: values of the page do not break the schema or the size of the report', () => {
  it('a version of axe that is not a version, a contrast requirement that is not one, and counts beyond the schema', () => {
    const axe = axeResult({ 'image-alt': { violations: 0, incomplete: 0, passes: 5_000_000, impact: null, examples: [], incompleteExamples: [] } });
    const contrast = { ratio: 2.9, expected: `4.5:1${'x'.repeat(30)}`, fgColor: '#9aa5b1', bgColor: '#ffffff', fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: null };
    const capture = shopCapture({
      axe: { ...axe, axeVersion: 'v'.repeat(41), images: { described: 5_000_000, decorative: 0 }, lowestContrast: { violation: contrast, pass: null } },
      consentBanner: { detected: true, toolId: `usercentrics<script>${'x'.repeat(80)}`, method: 'selector', selector: 's'.repeat(5_000), visibleAtMs: 1_400, toolsInDom: ['usercentrics'] },
    });
    const { report } = build(capture);
    expect(validateReport(report)).toEqual([]);
    expect(report.scan.axeVersion).toBeNull();
    expect(report.timeline?.bannerToolId).toBeNull();
    const lowest = report.measures.find((m) => m.id === 'lowest-contrast');
    expect(lowest?.actual).toEqual({ type: 'ratio', ratio: 2.9, expected: null });
    expect(report.measures.find((m) => m.id === 'images-described')?.actual).toEqual({ type: 'of', count: 100_000, total: 100_000 });
  });

  it('the usual values pass unchanged', () => {
    const { report } = build(shopCapture());
    expect(report.scan.axeVersion).toBe('4.14.1');
    expect(report.timeline?.bannerToolId).toBe('usercentrics');
    expect(report.measures.find((m) => m.id === 'lowest-contrast')?.actual).toEqual({ type: 'ratio', ratio: 2.9, expected: '4.5:1' });
  });

  it('80 services with ten long hosts each and long initiators: the report is made smaller, not thrown away', () => {
    const label = (c: string): string => c.repeat(60);
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0 }];
    for (let service = 0; service < 90; service += 1) {
      for (let host = 0; host < 10; host += 1) {
        const name = `${label(String.fromCharCode(97 + host))}.${label('h')}.${label('s')}${host}.dienst${service}.example`;
        // Five requests of each service have a long initiator: they become the evidence of its hint.
        requests.push({ url: `https://${name}/${'p'.repeat(90)}`, resourceType: 'script', startMs: 100 + service, initiator: host < 5 ? { type: 'script', url: `https://${name}/${'i'.repeat(95)}` } : null } as never);
      }
    }
    const capture = shopCapture({ requests: makeCapture({ requests }).requests });
    // The page is within the limits of a capture: only the report would be too large.
    expect(limitCapture(capture).ok).toBe(true);
    const built = build(capture);
    const report = built.report;
    expect(validateReport(report)).toEqual([]);
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(REPORT_LIMITS.maxReportChars);
    expect(report.counts.services).toBe(90);
    expect(report.truncated.services).toBe(true);
    expect(report.services.length).toBeGreaterThan(0);
    // It was fitted: the examples were shortened first (ten hosts per service otherwise).
    expect(report.services.every((s) => s.hosts.length <= 2)).toBe(true);
    expect(report.findings.every((f) => f.evidence.length <= 1)).toBe(true);
    expect(report.priorities.every((id) => report.findings.some((f) => f.id === id))).toBe(true);
  });
});

describe('finding 61: a list that is cut says so', () => {
  it('107 third-party hosts: the counts are of all, the lists are cut, and the report says which', () => {
    const requests = [{ url: SHOP, resourceType: 'document', isNavigation: true, startMs: 0 }, ...Array.from({ length: 107 }, (_, i) => ({ url: `https://cdn.anbieter-${i}.example/lib.js`, resourceType: 'script', startMs: 100 + i }))];
    const { report } = build(shopCapture({ requests: makeCapture({ requests }).requests }));
    expect(validateReport(report)).toEqual([]);
    expect(report.counts.services).toBe(107);
    expect(report.services).toHaveLength(REPORT_LIMITS.services);
    expect(report.findings).toHaveLength(REPORT_LIMITS.findings);
    expect(report.counts.findings + report.counts.manual + report.counts.hints + report.counts.notChecked).toBeGreaterThan(REPORT_LIMITS.findings);
    expect(report.truncated).toEqual({ findings: true, services: true, page: [] });
  });

  it('an ordinary report says that nothing is cut', () => {
    expect(build(shopCapture()).report.truncated).toEqual({ findings: false, services: false, page: [] });
    expect(build(shopCapture({ ok: false, failure: { reason: 'blocked', message: 'x', status: 403 } })).report.truncated).toEqual({ findings: false, services: false, page: [] });
  });

  it('a text or a list of links read only up to the limit is named', () => {
    const base = shopCapture();
    if (base.page === null || base.impressum === undefined || base.impressum === null || base.impressum.page === null) throw new Error('no page');
    const report = build({ ...base, page: { ...base.page, textTruncated: true }, impressum: { ...base.impressum, page: { ...base.impressum.page, textTruncated: true, linksTruncated: true } } }).report;
    expect(report.truncated.page).toEqual(['homepage-text', 'impressum-text', 'impressum-links']);
    expect(validateReport(report)).toEqual([]);
  });
});

describe('backlog: a page without a declared encoding that is not UTF-8 is read as windows-1252', () => {
  const latin1 = (text: string) => Uint8Array.from([...text].map((c) => (c === '€' ? 0x80 : c === '–' ? 0x96 : c.charCodeAt(0))));
  const IMPRESSUM = '<!doctype html><html lang="de"><head><title>Impressum</title></head><body><main><h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p><p>Müller & Söhne GmbH<br>Königstraße 12<br>87654 Musterhausen</p><p>Geschäftsführer: Jürgen Müller</p><p>E-Mail: buero@mueller-soehne-muster.de</p></main></body></html>';

  it('umlauts of an old ISO-8859-1 page are kept; valid UTF-8 and a declared encoding are read as before', () => {
    expect(decodeHtml(latin1('<p>Geschäftsführer: Jürgen Müller – 5 €</p>'), 'text/html')).toBe('<p>Geschäftsführer: Jürgen Müller – 5 €</p>');
    expect(decodeHtml(new TextEncoder().encode('<p>Geschäftsführer – 5 €</p>'), 'text/html')).toBe('<p>Geschäftsführer – 5 €</p>');
    // Declared UTF-8 with a broken byte stays UTF-8 with a replacement character: a declaration is not second-guessed.
    expect(decodeHtml(latin1('<p>Grüße</p>'), 'text/html; charset=utf-8')).toBe('<p>Gr��e</p>');
    expect(decodeHtml(latin1('<meta charset="utf-8"><p>Grüße</p>'), null)).toContain('Gr��e');
  });

  it('the quick check of such a site finds the address with its umlauts', async () => {
    const site = 'https://www.mueller-soehne-muster.de/';
    const home = '<!doctype html><html lang="de"><head><title>Müller & Söhne – Bäckerei</title></head><body><main><p>Brot und Brötchen aus Musterhausen, jeden Morgen frisch für Sie gebacken.</p></main><footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutzerklärung</a></footer></body></html>';
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('http://')) return new Response(null, { status: 301, headers: { location: site } });
      return new Response(latin1(url.endsWith('/impressum') ? IMPRESSUM : home), { status: 200, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const capture = await quickCapture(site, { guard: createUrlGuard({ resolve: async () => ['93.184.215.14'] }), userAgent: UA, fetch: fakeFetch });
    expect(capture.page?.title).toBe('Müller & Söhne – Bäckerei'.replace('–', '–'));
    expect(capture.impressum?.page?.text).toContain('Königstraße 12');
    const { report } = buildReport({ id: ID, createdAt: '2026-11-24T10:00:00.000Z', siteUrl: site, mode: 'quick', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated });
    expect(validateReport(report)).toEqual([]);
    expect(report.legal?.fields.address).toEqual({ status: 'found', quote: 'Königstraße 12\n87654 Musterhausen' });
    expect(report.legal?.datenschutzLink?.text).toBe('Datenschutzerklärung');
  });
});
