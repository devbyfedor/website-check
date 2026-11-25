import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { REPORT_TEXT_IDS, type Finding, type Report } from '@website-check/scanner';
import exampleJson from '../components/report/example-report.json';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states';
import { CheckList } from '../components/report/check-list';
import { ReportScreen } from '../components/report/report-screen';
import { CHECK_TEXTS, CHECKS_TEXTS as T } from '../lib/report-checks-texts';
import { checkItems, type CheckItem } from '../lib/report-checks-view';

// Session B5 part 2 (Fedor's decision): the manual checks and hints get texts of their own, as a list under the finding
// details; the same hint for several items is one item. A state the design does not show (/bericht/beispiel/
// pruefen-und-hinweise); npm run check:report looks at it in a browser.

const EXAMPLE = exampleJson as unknown as Report;
const reportOf = (slug: string): Report => {
  const shown = EXAMPLE_REPORT_STATES.find((s) => s.slug === slug)?.show();
  if (shown === undefined || !('report' in shown)) throw new Error(`no report state ${slug}`);
  return shown.report;
};
const plain = (p: CheckItem['title']): string => (typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The text ids the report builder gives a finding of kind `manual` or `hint` (scanner/src/report/build.ts). */
const MANUAL_OR_HINT_IDS = [
  'third-party-frame-unknown',
  'third-party-unknown',
  'third-party-grey-zone',
  'third-party-unconfirmed',
  'a11y-frame-not-checked',
  'a11y-image-alt-decorative',
  'a11y-manual-check',
  'a11y-manual-check-contrast',
  'security-https-manual',
  'security-http-redirect-manual',
  'security-http-redirect-in-page',
  'security-http-unavailable',
  'security-headers',
  'legal-impressum-no-link',
  'legal-impressum-no-link-empty-page',
  'legal-impressum-no-link-links-cut',
  'legal-impressum-no-link-quick',
  'legal-impressum-same-page',
  'legal-impressum-pdf',
  'legal-impressum-failed',
  'legal-field-not-found',
  'legal-datenschutz-no-link',
  'legal-datenschutz-uncertain',
  'legal-accessibility-statement-uncertain',
  'legal-accessibility-statement-not-found',
] as const;

describe('the list of manual checks and hints', () => {
  it('has a title and a text for every text id of a manual check or a hint', () => {
    for (const id of MANUAL_OR_HINT_IDS) {
      expect(REPORT_TEXT_IDS, id).toContain(id);
      const t = CHECK_TEXTS[id];
      expect(t?.title, id).toBeTruthy();
      expect(t?.text, id).toBeTruthy();
    }
  });

  it('shows the example report’s manual check and hint (the Erklärung zur Barrierefreiheit, jsDelivr), not its findings without a card', () => {
    const items = checkItems(EXAMPLE);
    expect(items.map((i) => [i.tag, plain(i.title)])).toEqual([
      [T.tagManual, 'Erklärung zur Barrierefreiheit nicht gefunden'],
      [T.tagHint, 'jsDelivr: Graubereich'],
    ]);
    // Google Tag Manager, the images and the security headers are findings without a card: not in this list.
    expect(items.some((i) => /Tag Manager|Bilder|Header/.test(plain(i.title)))).toBe(false);
  });

  it('groups the same hint for several items, at the place of the first, and keeps manual checks before hints', () => {
    const items = checkItems(reportOf('pruefen-und-hinweise'));
    const titles = items.map((i) => plain(i.title));
    expect(titles).toEqual([
      'Im Impressum nicht gefunden: Anschrift, E-Mail-Adresse',
      'Link zur Datenschutzerklärung nicht gefunden',
      'Link zur Barrierefreiheit gefunden',
      'Eingebetteter Bereich nicht geprüft',
      'Kontrast an 6 Stellen unklar',
      '3 Bilder als Schmuckbilder markiert',
      'Barriere unklar: Links, Schaltflächen',
      'Hotjar: Anfragen ohne Antwort',
      'Meta Pixel: Herkunft der Anfrage unklar',
      'Graubereich: jsDelivr, unpkg, cdnjs',
      'Unbekannte Dienste: bewertung-muster.example, termin-muster.example',
      'Unter http:// nicht erreichbar',
    ]);
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf('hint')).toBeGreaterThan(kinds.lastIndexOf('manual'));
    // No item uses the text for an unknown id, and no placeholder stays in a text.
    for (const i of items) {
      expect(plain(i.title), plain(i.title)).not.toBe(T.otherTitle);
      expect(plain(i.title) + plain(i.text)).not.toMatch(/\{[a-zA-Z]+\}/);
    }
    // The card (Google Fonts) is not repeated in the list.
    expect(titles.some((t) => t.includes('Google Fonts'))).toBe(false);
  });

  it('shows the name of an unknown service as a string of the page, and a known one as our text', () => {
    const items = checkItems(reportOf('pruefen-und-hinweise'));
    const unknown = items.find((i) => plain(i.title).startsWith('Unbekannte Dienste: '));
    expect(Array.isArray(unknown?.title) && unknown.title.some((p) => typeof p !== 'string')).toBe(true);
    const grey = items.find((i) => plain(i.title).startsWith('Graubereich: '));
    expect(typeof grey?.title).toBe('string');
  });

  it('says what to check for an id this page does not know, and has no item without a manual check or hint', () => {
    const r = structuredClone(EXAMPLE);
    const f = r.findings.find((x) => x.kind === 'manual') as Finding;
    f.textId = 'neu-pruefung' as Finding['textId'];
    expect(checkItems(r)[0]).toMatchObject({ title: T.otherTitle, text: T.otherManual });
    const none = structuredClone(EXAMPLE);
    none.findings = none.findings.filter((x) => x.kind !== 'manual' && x.kind !== 'hint');
    expect(checkItems(none)).toEqual([]);
    expect(renderToStaticMarkup(<CheckList report={none} />)).toBe('');
  });

  it('renders the head with the count, the tag, the title as h3 and the text; nothing in it takes focus', () => {
    const r = reportOf('pruefen-und-hinweise');
    const html = renderToStaticMarkup(<CheckList report={r} />);
    expect(html).toContain(`>${T.heading}</h2>`);
    expect(text(html)).toContain(T.count(checkItems(r).length));
    expect(html.match(/<h3/g)?.length).toBe(checkItems(r).length);
    expect(html).not.toMatch(/<a |<button|tabindex/);
    expect(text(html)).toContain(T.tagManual);
    expect(text(html)).toContain(T.tagHint);
  });

  it('stands under the finding details and before the help block of the report', () => {
    const html = renderToStaticMarkup(<ReportScreen report={reportOf('pruefen-und-hinweise')} timeZone="Europe/Berlin" />);
    const list = html.indexOf(`>${T.heading}</h2>`);
    expect(list).toBeGreaterThan(html.indexOf('id="fund-1"'));
    expect(list).toBeLessThan(html.indexOf('Sie möchten das nicht selbst umsetzen?') === -1 ? Infinity : html.indexOf('Sie möchten das nicht selbst umsetzen?'));
  });
});
