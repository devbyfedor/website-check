import { describe, expect, it } from 'vitest';
import { analyzeLegal } from '../src/analyzers/legal.ts';
import type { PageLink } from '../src/capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { chooseImpressumTarget, findLegalLinks, findLink, normalizeLinkText } from '../src/legal/links.ts';
import { quickCapture } from '../src/quick/quick-capture.ts';
import { buildReport } from '../src/report/build.ts';
import type { Report } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';
import { SHOP, shopCapture } from './report-helpers.ts';

/**
 * Session fix-a3: the legal links of the homepage (review findings 7, 14, 15 and the link part of 16).
 * Invented sites on `.example` names only; the end-to-end cases use a fake resolver and a fake fetch.
 */

const SITE = 'https://www.kanzlei-muster.example/';
const AGENCY = 'https://www.pixelwerk-agentur.example/';
const SHY = '­';

function reportWith(links: PageLink[]): Report {
  const base = shopCapture();
  const capture = shopCapture({ page: { ...base.page!, links } });
  const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
  expect(validateReport(report)).toEqual([]);
  return report;
}

describe('finding 7: a label that only contains "Impressum" is not the Impressum of the site', () => {
  const modal: PageLink = { href: `${SITE}#`, text: 'Impressum', footer: true };
  const teaser: PageLink = { href: `${SITE}blog/impressum-pflicht/`, text: 'Impressum Pflicht' };
  const own: PageLink = { href: `${SITE}impressum/`, text: 'Impressum', footer: true };

  it('a blog teaser "Impressum Pflicht" next to an Impressum that opens as a modal gives no link', () => {
    expect(findLink('impressum', [teaser, modal], SITE)).toBeNull();
    expect(chooseImpressumTarget([teaser, modal], SITE)).toEqual({ action: 'none' });
  });

  it('a service "Impressum erstellen" and a link "Impressum Generator" to another site give no link', () => {
    expect(findLink('impressum', [{ href: `${SITE}leistungen/impressum-erstellen/`, text: 'Impressum erstellen' }, modal], SITE)).toBeNull();
    expect(findLink('impressum', [modal, { href: `${AGENCY}impressum-generator/`, text: 'Impressum Generator', footer: true }], SITE)).toBeNull();
    expect(findLink('impressum', [{ href: `${SITE}blog/impressum-pflicht/`, text: 'Weiterlesen: Impressum Pflicht für Vereine und Firmen' }], SITE)).toBeNull();
  });

  it('the report says "Impressum-Link nicht gefunden" and reads no fields from the article', () => {
    const base = shopCapture();
    const article = 'Impressum Pflicht: Was muss rein?\nMax Mustermann\nMusterstraße 1\n12345 Musterstadt\nE-Mail: max@mustermann.example\nHandelsregister: HRB 12345, Amtsgericht Musterstadt\nUSt-IdNr.: DE123456789';
    const capture = shopCapture({
      page: { ...base.page!, links: [{ href: `${SHOP}blog/impressum-pflicht/`, text: 'Impressum Pflicht' }, { href: `${SHOP}#`, text: 'Impressum', footer: true }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }] },
      impressum: { ...base.impressum!, url: `${SHOP}blog/impressum-pflicht/`, finalUrl: `${SHOP}blog/impressum-pflicht/`, page: { ...base.impressum!.page!, url: `${SHOP}blog/impressum-pflicht/`, title: 'Impressum Pflicht: Was muss rein?', text: article } },
    });
    const legal = analyzeLegal(capture);
    expect(legal.impressum.state).toBe('no-link');
    expect(Object.values(legal.fields).map((f) => f.status)).toEqual(['not-found', 'not-found', 'not-found', 'not-found']);
    const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(report.findings.find((f) => f.id === 'legal:impressum')).toMatchObject({ kind: 'manual', textId: 'legal-impressum-no-link' });
    expect(report.measures.find((m) => m.id === 'impressum-fields')).toMatchObject({ result: 'manual', actual: null });
    expect(report.pages.impressum).toBe('not-checked');
  });

  it('end to end (quick check): the article is never requested', async () => {
    const doc = (title: string, body: string) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
    const home = doc('Kanzlei Muster', `<header><nav><a href="/leistungen/">Leistungen</a></nav></header><main><h1>Kanzlei Muster</h1><p>${'Ihre Kanzlei in Beispielburg. '.repeat(80)}</p><ul><li><a href="/blog/impressum-pflicht/">Impressum Pflicht</a></li></ul></main><footer><a href="#" class="js-modal">Impressum</a> <a href="/datenschutz/">Datenschutz</a></footer>`);
    const calls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      return url === SITE ? new Response(home, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    }) as typeof fetch;
    const guard = createUrlGuard({ resolve: async () => ['93.184.215.14'], exempt: (url) => url.hostname.endsWith('.example') });
    const capture = await quickCapture(SITE, { guard, userAgent: 'Mozilla/5.0 test', fetch: fetchFn, httpProbe: false });
    expect(calls).toEqual([SITE]);
    expect(analyzeLegal(capture).impressum.state).toBe('no-link');
  });

  it('an icon link to /impressum/ wins over the teaser (address fallback)', () => {
    const icon: PageLink = { href: `${SITE}impressum/`, text: '', footer: true };
    expect(findLink('impressum', [teaser, icon], SITE)).toMatchObject({ href: icon.href, matchedBy: 'href' });
  });

  it('the Impressum link of the site wins over the exact link of another site in a footer box', () => {
    const header: PageLink = { href: `${SITE}impressum/`, text: 'Impressum', footer: false };
    const credit: PageLink = { href: `${AGENCY}impressum/`, text: 'Impressum', footer: true };
    expect(findLink('impressum', [header, credit], SITE)?.href).toBe(header.href);
    expect(findLink('impressum', [credit, own], SITE)?.href).toBe(own.href);
    // Also against a combined label of the site itself.
    const combined: PageLink = { href: `${SITE}rechtliches/`, text: 'Impressum & Datenschutz', footer: false };
    expect(findLink('impressum', [credit, combined], SITE)?.href).toBe(combined.href);
  });

  it('controls: a combined label, an exact link next to a teaser, and an Impressum that lies on another site', () => {
    for (const text of ['Impressum & Datenschutz', 'Kontakt / Impressum', 'Zum Impressum', 'Impressum | AGB | Datenschutz', 'Rechtliche Hinweise & Impressum']) {
      expect(findLink('impressum', [{ href: `${SITE}rechtliches/`, text, footer: true }], SITE), text).toMatchObject({ matchedBy: 'text' });
    }
    expect(findLink('impressum', [teaser, own], SITE)?.href).toBe(own.href);
    expect(findLink('impressum', [{ href: `${AGENCY}impressum/`, text: 'Impressum', footer: true }], SITE)).toMatchObject({ href: `${AGENCY}impressum/`, certain: true });
    // A text about the page with an address that is the page itself: an article would have more words in its address.
    expect(findLink('impressum', [{ href: `${SITE}impressum/`, text: 'Impressum der Kanzlei Muster' }], SITE)).toMatchObject({ matchedBy: 'href' });
  });
});

describe('finding 14: only a link to the policy of the site itself is the Datenschutzerklärung', () => {
  const IMP: PageLink = { href: `${SHOP}impressum/`, text: 'Impressum', footer: true };
  const CAPTCHA = 'https://www.captcha-anbieter.example/privacy';
  const found = (links: PageLink[]) => {
    const report = reportWith([IMP, ...links]);
    return { href: report.legal?.datenschutzLink?.href ?? null, check: report.findings.find((f) => f.id === 'legal:datenschutz')?.textId ?? null };
  };

  it('the policy of a captcha or payment provider never wins over the link of the site', () => {
    const own = `${SHOP}policies/privacy-policy`;
    expect(found([{ href: CAPTCHA, text: 'Datenschutzbestimmungen', footer: true }, { href: own, text: 'Datenschutzerklärung', footer: true }])).toEqual({ href: own, check: null });
    expect(found([{ href: CAPTCHA, text: 'Privacy Policy', footer: true }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
    expect(found([{ href: CAPTCHA, text: 'Datenschutzerklärung' }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz' }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
    expect(found([{ href: 'https://www.zahlungsanbieter.example/privacy', text: 'Datenschutzrichtlinie', footer: true }, { href: `${SHOP}datenschutz/`, text: 'Datenschutzhinweis', footer: true }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
    // An icon link of the site (address only) also comes before the text link of the provider.
    expect(found([{ href: CAPTCHA, text: 'Datenschutzerklärung', footer: true }, { href: `${SHOP}datenschutz/`, text: '', footer: true }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
  });

  it('only the policy of another site: the report shows no link and asks for a manual check', () => {
    expect(found([{ href: CAPTCHA, text: 'Datenschutzbestimmungen' }])).toEqual({ href: null, check: 'legal-datenschutz-uncertain' });
    expect(findLink('datenschutz', [{ href: CAPTCHA, text: 'Datenschutzbestimmungen' }], SHOP)).toMatchObject({ certain: false, uncertain: 'other-site' });
  });

  it('a compound word is not the policy: a service, a product, a blog teaser', () => {
    const own = `${SHOP}datenschutz/`;
    expect(found([{ href: `${SHOP}leistungen/datenschutzberatung`, text: 'Datenschutzberatung', footer: true }, { href: own, text: 'Datenschutzhinweis', footer: true }])).toEqual({ href: own, check: null });
    expect(found([{ href: `${SHOP}kategorie/datenschutz`, text: 'Datenschutz' }, { href: own, text: 'Datenschutzhinweis', footer: true }])).toEqual({ href: own, check: null });
    expect(found([{ href: `${SHOP}produkte/datenschutzfolie`, text: 'Datenschutzfolie' }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
    expect(found([{ href: `${SHOP}blog/datenschutz-im-verein`, text: 'Datenschutz im Verein' }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
    expect(found([{ href: `${SHOP}leistungen/datenschutzberatung`, text: 'Datenschutzberatung' }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
  });

  it('an anchor of the homepage (the button of a consent tool) is not the policy', () => {
    const own = `${SHOP}datenschutz/`;
    expect(found([{ href: `${SHOP}#uc-corner-modal-show`, text: 'Datenschutz', footer: true }, { href: own, text: 'Datenschutzerklärung', footer: true }])).toEqual({ href: own, check: null });
    expect(found([{ href: `${SHOP}#consent-change`, text: 'Cookies & Datenschutz', footer: true }])).toEqual({ href: null, check: 'legal-datenschutz-uncertain' });
    expect(findLink('datenschutz', [{ href: `${SHOP}#consent-change`, text: 'Cookies & Datenschutz', footer: true }], SHOP)).toMatchObject({ certain: false, uncertain: 'same-page' });
    expect(found([{ href: `${SHOP}#cmp`, text: 'Privacy Center', footer: true }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
    expect(found([{ href: `${SHOP}#CookieDeclaration`, text: 'Datenschutz-Auswahl ändern', footer: true }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
  });

  it('controls: the plain footer link, consent settings and a long article title', () => {
    expect(found([{ href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
    expect(found([{ href: `${SHOP}datenschutz/`, text: 'Datenschutz & Cookies', footer: true }])).toEqual({ href: `${SHOP}datenschutz/`, check: null });
    expect(found([{ href: `${SHOP}#cmp`, text: 'Datenschutz-Einstellungen', footer: true }, { href: `${SHOP}dsb`, text: 'Datenschutzbeauftragter', footer: true }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
    expect(found([{ href: `${SHOP}blog/x`, text: 'Was der Datenschutz für kleine Vereine bedeutet' }])).toEqual({ href: null, check: 'legal-datenschutz-no-link' });
  });
});

describe('finding 15: only the name of the statement is a found Erklärung zur Barrierefreiheit', () => {
  const HOTEL = 'https://www.hotel-muster.example/';
  const one = (link: PageLink) => findLink('accessibilityStatement', [link], HOTEL);

  it('information about the building, a service and a blog article are found links, never certain', () => {
    const cases: PageLink[] = [
      { href: `${HOTEL}hotel/barrierefreiheit`, text: 'Informationen zur Barrierefreiheit', footer: true },
      { href: `${HOTEL}praxis/anfahrt`, text: 'Hinweise zur Barrierefreiheit' },
      { href: `${HOTEL}besuch/rollstuhl`, text: 'Angaben zur Barrierefreiheit' },
      { href: `${HOTEL}leistungen/bfsg`, text: 'Erklärung zur Barrierefreiheit erstellen lassen' },
      { href: `${HOTEL}leistungen/bfsg`, text: 'Barrierefreiheitserklärung erstellen' },
      { href: `${HOTEL}blog/bfsg-2025`, text: 'Erklärung zur Barrierefreiheit: Pflicht ab 2025' },
      { href: `${HOTEL}blog/erklaerung-zur-barrierefreiheit-pflicht-2025`, text: 'Weiterlesen' },
      { href: `${HOTEL}leistungen/barrierefreiheitserklaerung-erstellen`, text: 'Mehr erfahren' },
      { href: `${HOTEL}blog/erklaerung-zur-barrierefreiheit-pflicht-2025`, text: '' },
      { href: `${HOTEL}barrierefreiheitserklaerung`, text: 'Barrierefreiheitserklärung erstellen lassen' },
    ];
    for (const link of cases) expect(one(link)?.certain ?? false, `${link.text} -> ${link.href}`).toBe(false);
  });

  it('the statement of another site (an authority, a platform) is not the statement of this site', () => {
    expect(one({ href: 'https://www.behoerde.example/erklaerung-zur-barrierefreiheit', text: 'Erklärung zur Barrierefreiheit' })).toMatchObject({ certain: false, uncertain: 'other-site' });
  });

  it('a shop with a link about the ramp and the parking: no "vorhanden", the row stays a manual check', () => {
    const base = shopCapture();
    const report = reportWith([...base.page!.links, { href: `${SHOP}laden/barrierefreiheit`, text: 'Informationen zur Barrierefreiheit', footer: true }]);
    expect(report.measures.find((m) => m.id === 'accessibility-statement')).toMatchObject({ result: 'manual', actual: { type: 'state', state: 'uncertain' } });
    expect(report.findings.find((f) => f.id === 'legal:accessibility-statement')).toMatchObject({ kind: 'manual', textId: 'legal-accessibility-statement-uncertain' });
    expect(report.legal?.accessibilityStatement).toMatchObject({ certain: false });
    const teaser = reportWith([...base.page!.links, { href: `${SHOP}blog/erklaerung-zur-barrierefreiheit-pflicht-2025`, text: 'Weiterlesen' }]);
    expect(teaser.measures.find((m) => m.id === 'accessibility-statement')?.result).toBe('manual');
  });

  it('controls: the name of the statement, the address of the statement, the topic alone, a long title', () => {
    expect(one({ href: `${HOTEL}barrierefreiheit`, text: 'Erklärung zur Barrierefreiheit', footer: true })).toMatchObject({ certain: true, uncertain: null });
    expect(one({ href: `${HOTEL}a11y`, text: 'Barrierefreiheitserklärung' })?.certain).toBe(true);
    expect(one({ href: `${HOTEL}a11y`, text: 'Accessibility Statement' })?.certain).toBe(true);
    expect(one({ href: `${HOTEL}barrierefreiheitserklaerung/`, text: 'Barrierefreiheit', footer: true })?.certain).toBe(true);
    expect(one({ href: `${HOTEL}erklaerung-zur-barrierefreiheit`, text: '' })?.certain).toBe(true);
    expect(one({ href: `${HOTEL}barrierefreiheit`, text: 'Barrierefreiheit', footer: true })).toMatchObject({ certain: false, uncertain: 'topic' });
    expect(one({ href: `${HOTEL}digitale-barrierefreiheit/`, text: 'Digitale Barrierefreiheit', footer: true })?.certain).toBe(false);
    expect(one({ href: `${HOTEL}blog/bfsg-2025`, text: 'Was gehört in eine Erklärung zur Barrierefreiheit?' })).toBeNull();
  });

  it('a real statement in the footer wins over a service teaser in the body', () => {
    const teaser: PageLink = { href: `${HOTEL}leistungen/bfsg`, text: 'Erklärung zur Barrierefreiheit erstellen lassen' };
    const statement: PageLink = { href: `${HOTEL}erklaerung-zur-barrierefreiheit`, text: 'Erklärung zur Barrierefreiheit', footer: true };
    expect(findLink('accessibilityStatement', [teaser, statement], HOTEL)).toMatchObject({ href: statement.href, certain: true });
  });
});

describe('finding 16: a soft hyphen inside a word does not hide a legal link', () => {
  it('the link text is read without invisible characters', () => {
    expect(normalizeLinkText(`Im${SHY}pressum`)).toBe('impressum');
    expect(normalizeLinkText(`Daten​schutz⁠erklärung﻿`)).toBe('datenschutzerklärung');
  });

  it('links found by their text, whatever the address', () => {
    const P = 'https://www.muster-immobilien.example/';
    const links: PageLink[] = [
      { href: `${P}rechtliches`, text: `Im${SHY}pressum`, footer: true },
      { href: `${P}rechtliches#ds`, text: `Daten${SHY}schutz${SHY}erklärung`, footer: true },
      { href: `${P}service/a11y`, text: `Erklärung zur Barriere${SHY}freiheit`, footer: true },
    ];
    const found = findLegalLinks(links, P);
    expect(found.impressum).toMatchObject({ href: `${P}rechtliches`, matchedBy: 'text' });
    expect(found.datenschutz).toMatchObject({ href: `${P}rechtliches#ds`, matchedBy: 'text', certain: true });
    expect(found.accessibilityStatement).toMatchObject({ href: `${P}service/a11y`, matchedBy: 'text', certain: true });
    expect(findLink('impressum', [{ href: `${P}?page_id=7`, text: `Im${SHY}pres${SHY}sum`, footer: true }], P)).not.toBeNull();
    expect(findLink('accessibilityStatement', [{ href: `${P}service/a11y`, text: `Barriere${SHY}freiheits${SHY}erklärung` }], P)?.certain).toBe(true);
  });

  it('the report of a shop with the footer link "Im­pressum" has no "Impressum-Link nicht gefunden"', () => {
    const base = shopCapture();
    const links: PageLink[] = [{ href: `${SHOP}shop/`, text: 'Shop' }, { href: `${SHOP}rechtliches/`, text: `Im${SHY}pressum`, footer: true }, { href: `${SHOP}datenschutz/`, text: 'Datenschutz', footer: true }];
    const capture = shopCapture({ page: { ...base.page!, links }, impressum: { ...base.impressum!, url: `${SHOP}rechtliches/`, finalUrl: `${SHOP}rechtliches/`, page: { ...base.impressum!.page!, url: `${SHOP}rechtliches/` } } });
    const { report } = buildReport({ id: 'abcdefghijklmnopqrstuvwxyz', createdAt: '2026-11-24T09:00:00.000Z', siteUrl: SHOP, mode: 'full', capture, rules: DEFAULT_RULES, scannerVersion: '0.1.0', rulesUpdated: RULES_FILE.updated });
    expect(report.findings.find((f) => f.id === 'legal:impressum')).toBeUndefined();
    expect(report.legal?.impressum.state).toBe('analyzed');
    expect(report.priorities.some((p) => String(p).includes('legal:impressum'))).toBe(false);
  });
});
