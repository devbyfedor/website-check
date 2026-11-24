import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { SCANNER_VERSION } from '../src/index.ts';
import { buildReport } from '../src/report/build.ts';
import { pageAddress } from '../src/report/page-address.ts';
import { validateReport } from '../src/report/validate.ts';
import { SHOP, SHOP_URL, shopCapture } from './report-helpers.ts';

/**
 * Review finding 90 (session fix-a5): addresses of the page are kept in the stored report without the query,
 * the fragment and a session id in the path. Built from the privacy reproduction of the review: an invented
 * shop that adds a session id to its homepage and its Impressum link for a visitor without cookies, and an
 * analytics request with a client id, a user id and the page address with an e-mail in it.
 */

const SESSION = '0123456789abcdef0123456789abcdef';
const TOKEN = 'SECRET-TOKEN-123456';
const EMAIL = 'erika.musterfrau';

function reportWithSessionIds() {
  const base = shopCapture();
  const capture = shopCapture({
    finalUrl: `${SHOP}?PHPSESSID=${SESSION}&utm_source=x`,
    requests: [
      { ...base.requests[0]!, url: `${SHOP}?PHPSESSID=${SESSION}&utm_source=x` },
      ...base.requests.slice(1, 6),
      {
        ...base.requests[6]!,
        url: `https://region1.google-analytics.com/g/collect?v=2&tid=G-TEST123&cid=1122334455.6677889900&uid=kunde-4711&dl=https%3A%2F%2Fwww.roesterei-muster.example%2F%3Femail%3D${EMAIL}%2540muster.example`,
        initiator: { type: 'script', url: `https://www.googletagmanager.com/gtag/js?id=G-TEST123&sid=${SESSION}` },
      },
      ...base.requests.slice(7),
    ],
    page: {
      ...base.page!,
      links: [
        { href: `${SHOP}impressum/?sessionToken=${TOKEN}#oben`, text: 'Impressum', footer: true },
        { href: `${SHOP}datenschutz/;jsessionid=${SESSION}?x=1`, text: 'Datenschutz', footer: true },
      ],
    },
    impressum: { ...base.impressum!, url: `${SHOP}impressum/?sessionToken=${TOKEN}#oben`, finalUrl: `${SHOP}impressum/?sessionToken=${TOKEN}`, page: { ...base.impressum!.page!, url: `${SHOP}impressum/?sessionToken=${TOKEN}` } },
  });
  return buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-20T11:59:58.000Z', siteUrl: SHOP_URL, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: SCANNER_VERSION, rulesUpdated: RULES_FILE.updated, visit: { country: 'IT', colo: 'MXP' } }).report;
}

describe('finding 90: the stored report keeps no query, fragment or session id of the page', () => {
  it('no session id, token, client id, user id or e-mail of the review reproduction is in the report', () => {
    const report = reportWithSessionIds();
    expect(validateReport(report)).toEqual([]);
    const text = JSON.stringify(report);
    for (const needle of [SESSION, TOKEN, EMAIL, 'cid=', 'uid=', 'dl=', 'utm_source', 'PHPSESSID', 'jsessionid', '#oben']) expect(text, needle).not.toContain(needle);
  });

  it('the page and its legal links keep scheme, host and path', () => {
    const report = reportWithSessionIds();
    expect(report.site.finalUrl).toBe(SHOP);
    expect(report.legal?.impressumLink?.href).toBe(`${SHOP}impressum/`);
    expect(report.legal?.datenschutzLink?.href).toBe(`${SHOP}datenschutz/`);
    expect(report.legal?.impressum.url).toBe(`${SHOP}impressum/`);
  });

  it('request evidence keeps the path that names the service; Google Fonts keep the font names the fix needs', () => {
    const report = reportWithSessionIds();
    const urls = report.findings.flatMap((f) => f.evidence.flatMap((e) => (e.type === 'request' ? [e.url, e.via] : [])));
    expect(urls).toContain('https://region1.google-analytics.com/g/collect');
    expect(urls).toContain('https://www.googletagmanager.com/gtag/js');
    expect(urls).toContain('https://fonts.googleapis.com/css2?family=Lato:wght@400;700');
  });
});

describe('pageAddress', () => {
  it('drops query, fragment, user name and password', () => {
    expect(pageAddress('https://user:pass@beispiel.example:8443/a/b.html?x=1&y=2#frag')).toBe('https://beispiel.example:8443/a/b.html');
    expect(pageAddress('http://beispiel.example/?')).toBe('http://beispiel.example/');
  });

  it('drops a session id in a path segment', () => {
    expect(pageAddress(`https://beispiel.example/shop;jsessionid=${SESSION}/impressum`)).toBe('https://beispiel.example/shop/impressum');
    expect(pageAddress(`https://beispiel.example/impressum;PHPSESSID=${SESSION}`)).toBe('https://beispiel.example/impressum');
  });

  it('a legal link on "/" or a script keeps only page selectors with a plain value', () => {
    expect(pageAddress(`https://beispiel.example/?page_id=7&PHPSESSID=${SESSION}`, 'link')).toBe('https://beispiel.example/?page_id=7');
    expect(pageAddress('https://beispiel.example/index.php?id=12&L=0&cHash=abcdef0123456789', 'link')).toBe('https://beispiel.example/index.php?id=12&L=0');
    expect(pageAddress('https://beispiel.example/index.php?route=information/information&information_id=4', 'link')).toBe('https://beispiel.example/index.php?route=information/information&information_id=4');
    expect(pageAddress(`https://beispiel.example/?id=${'x'.repeat(41)}`, 'link')).toBe('https://beispiel.example/');
    expect(pageAddress('https://beispiel.example/impressum/?page_id=7', 'link')).toBe('https://beispiel.example/impressum/');
    // A request is never a link: the same address loses its query.
    expect(pageAddress('https://beispiel.example/?page_id=7')).toBe('https://beispiel.example/');
  });

  it('Google Fonts keep family and display only', () => {
    expect(pageAddress('https://fonts.googleapis.com/css?family=Open+Sans&display=swap&key=abc')).toBe('https://fonts.googleapis.com/css?family=Open+Sans&display=swap');
    expect(pageAddress('https://fonts.gstatic.com/s/lato/v24/lato.woff2?v=1')).toBe('https://fonts.gstatic.com/s/lato/v24/lato.woff2');
  });

  it('other schemes and unreadable addresses', () => {
    expect(pageAddress('data:image/png;base64,AAAA?x')).toBe('data:image/png;base64,AAAA?x');
    expect(pageAddress('blob:https://beispiel.example/123')).toBe('blob:https://beispiel.example/123');
    expect(pageAddress('wss://beispiel.example/socket?token=abc')).toBe('wss://beispiel.example/socket');
    expect(pageAddress('https://[bad/impressum?token=abc')).toBe('https://[bad/impressum');
  });
});
