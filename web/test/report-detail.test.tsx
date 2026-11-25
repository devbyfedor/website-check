import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Finding, Report } from '@website-check/scanner/report';
import exampleJson from '../components/report/example-report.json';
import { ReportScreen } from '../components/report/report-screen';
import { Revisions, WORK_ORDER } from '../components/report/stage-d';
import { countWords, FIX_TEXTS, secondsText } from '../lib/report-detail-texts';
import { detectedSystem, findingCards, serviceRows, sourceAddresses, titleBlock } from '../lib/report-detail-view';
import { STAGE_D_MARKERS } from '../lib/report-stage-d-texts';

// The lower part of the report (session B4 part 1) with the example of the reference: every text and value must be the
// one of design/reference/bericht.html, except what schema v1 does not express (named below, each with its gap of
// docs/report-schema.md). npm run visual, motion and a11y compare the built page in a browser.

const ROOT = join(import.meta.dirname, '..', '..');
const reference = readFileSync(join(ROOT, 'design', 'reference', 'bericht.html'), 'utf8');
const EXAMPLE = exampleJson as unknown as Report;
const strip = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const text = (p: string | readonly (string | { page: string })[]): string => (typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));
const clone = (): Report => structuredClone(EXAMPLE);
const render = (report: Report, opts: { details?: boolean; stageD?: boolean } = {}): string =>
  renderToStaticMarkup(
    <ReportScreen
      report={report}
      timeZone="Europe/Berlin"
      details={opts.details ?? true}
      {...(opts.stageD ? { stageD: { revisions: <Revisions report={report} timeZone="Europe/Berlin" />, workOrder: WORK_ORDER } } : {})}
    />,
  );

// The rows of the reference's Stückliste: position, name, small line, provider, data, starts, tag class, tag.
const ROW = /<tr><td><span class="pos">(\d+)<\/span><\/td><td><b>(.*?)<\/b><br><span[^>]*>(.*?)<\/span><\/td><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><td><span class="tag t-(\w+)">(.*?)<\/span><\/td><\/tr>/g;
const referenceRows = [...reference.matchAll(ROW)].map((m) => ({ position: Number(m[1]), name: m[2], small: m[3], provider: m[4], data: m[5], starts: m[6], tone: m[7], tag: m[8] }));

describe('the Stückliste of the example', () => {
  it('the reference has the five rows the test reads', () => {
    expect(referenceRows.map((r) => r.name)).toEqual(['Google Fonts', 'Google Tag Manager', 'Google Analytics 4', 'YouTube', 'jsDelivr']);
  });

  it('is the reference, except what schema v1 does not express', () => {
    const rows = serviceRows(EXAMPLE).map((r) => ({ ...r, name: text(r.name) }));
    // Each app row with the reference row it stands for. Not expressible: the YouTube row ("erst nach Klick", "wird
    // eingeholt": a service that waits for a click, gap 3), so jsDelivr is position 4, not 5; the names of the rules
    // data ("Google Tag Manager / Google tag (gtag.js)", "Google Analytics", "jsDelivr (incl. BootstrapCDN)") where
    // the reference has shorter names, and "Google Analytics 4", which the scan does not tell.
    const pairs: [number, number, string | null][] = [
      [0, 0, null],
      [1, 1, 'Google Tag Manager / Google tag (gtag.js)'],
      [2, 2, 'Google Analytics'],
      [3, 4, 'jsDelivr (incl. BootstrapCDN)'],
    ];
    expect(rows).toHaveLength(4);
    for (const [a, r, name] of pairs) {
      const app = rows[a]!;
      const ref = referenceRows[r]!;
      expect(app.name).toBe(name ?? ref.name);
      expect(app.small).toBe(ref.small);
      expect(app.provider).toBe(ref.provider);
      expect(app.data).toBe(ref.data);
      expect(app.starts).toBe(ref.starts);
      expect(app.tag.text).toBe(ref.tag);
      expect(`t-${app.tag.tone}`).toBe(`t-${ref.tone}`);
    }
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4]);
  });

  it('shows the name of an unknown service as a string of the page, never as markup', () => {
    const r = clone();
    r.services[0] = { ...r.services[0]!, known: false, name: '<img src=x onerror=alert(1)>‮evil', provider: null, category: 'unknown', dataLocation: 'unknown' };
    const html = render(r);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<bdi class="wrap-anywhere">&lt;img src=x onerror=alert(1)&gt;‮evil</bdi>');
    expect(serviceRows(r)[0]).toMatchObject({ provider: 'unbekannt', small: 'unbekannter Dienst', data: 'nicht bekannt' });
  });
});

describe('the finding details of the example', () => {
  const cards = findingCards(EXAMPLE);
  const fund = reference.slice(reference.indexOf('<section id="fund-1"'), reference.indexOf('</section>', reference.indexOf('<section id="fund-1"')));
  const h3Text = (h: string) => strip(fund.slice(fund.indexOf(`<h3 class="h3s">${h}</h3>`)).replace(/^<h3[^>]*>.*?<\/h3>/, '').replace(/<\/div>[\s\S]*$/, ''));

  it('one card per priority, numbered as in "Drei Dinge", the targets of its links', () => {
    expect(cards.map((c) => [c.number, c.id, text(c.title), c.field])).toEqual([
      [1, 'fund-1', 'Google Fonts laden vor der Einwilligung', 'B2'],
      [2, 'fund-2', 'Google Analytics startet vor der Einwilligung', 'A3'],
      [3, 'fund-3', 'Zu schwacher Kontrast an 14 Stellen', 'A2'],
    ]);
    for (const n of [1, 2, 3]) expect(reference).toContain(`href="#fund-${n}"`);
  });

  it('the first card is fund-1 of the reference', () => {
    const c = cards[0]!;
    expect(c.happens).toBe(h3Text('Was passiert'));
    expect(c.why).toBe(h3Text('Warum das wichtig ist'));
    expect(c.targetActual).toEqual({ target: '0 Anfragen an Google', actual: '2 Anfragen, vor dem Banner', bad: true });
    expect(strip(fund)).toContain('Soll0 Anfragen an Google');
    expect(strip(fund)).toContain('Ist2 Anfragen, vor dem Banner');
    // "Gefunden im Quelltext": the address of the request in the source; the reference's tag is gap 2.
    const refCode = decode(/<pre class="code">(.*?)<\/pre>/.exec(fund)![1]!);
    expect(c.source).toEqual(['https://fonts.googleapis.com/css2?family=Lato:wght@400;700']);
    expect(refCode).toContain(c.source[0]);
    expect(c.fix?.kind).toBe('systems');
    if (c.fix?.kind !== 'systems') throw new Error('no tabs');
    expect(c.fix.detected).toBe('wordpress');
    expect(c.fix.selected).toBe('wordpress');
    // Every step of every system, as in the reference (its panels in order: WordPress, Shopify, Wix, Jimdo, Shopware).
    const panels = [...fund.matchAll(/<ol class="steps">([\s\S]*?)<\/ol>/g)].map((m) => [...m[1]!.matchAll(/<li>(.*?)<\/li>/g)].map((l) => decode(l[1]!)));
    expect(panels).toHaveLength(5);
    expect([c.fix.steps.wordpress, c.fix.steps.shopify, c.fix.steps.wix, c.fix.steps.jimdo, c.fix.steps.shopware]).toEqual(panels);
  });

  it('the second and third card: drafts, the Prüfmaß of the same thing, and no part without a text', () => {
    const [, ga, contrast] = cards;
    expect(ga!.happens).toBe(
      'Ihre Startseite stellt drei Anfragen an Server von Google, die erste 3,2 Sekunden nach dem Aufruf. Google erhält dabei die IP-Adresse jedes Besuchers, ohne dass dieser zugestimmt hat.',
    );
    expect(ga!.targetActual).toEqual({ target: '0 Anfragen an Google', actual: '3 Anfragen, ohne Einwilligung', bad: true });
    expect(ga!.source).toEqual([]); // the requests of Google Analytics are made by the Google tag
    expect(ga!.fix).toBeNull(); // fix-google-analytics is not written yet
    expect(text(contrast!.happens!)).toBe('An 14 Stellen hebt sich der Text zu wenig vom Hintergrund ab, der schwächste Wert liegt bei 2,9 : 1 statt mindestens 4,5 : 1.');
    expect(contrast!.targetActual).toEqual({ target: 'mind. 4,5 : 1', actual: '2,9 : 1', bad: true });
    expect(contrast!.fix).toEqual({ kind: 'general', steps: expect.any(Array) });
  });

  it('a request after the banner, or without a banner seen, is "ohne Einwilligung", never "vor dem Banner"', () => {
    for (const beforeBanner of [false, null]) {
      const r = clone();
      r.findings[0]!.params.beforeBanner = beforeBanner;
      const c = findingCards(r)[0]!;
      expect(c.happens).toContain('ohne dass dieser zugestimmt hat');
      expect(c.targetActual?.actual).toBe('2 Anfragen, ohne Einwilligung');
    }
  });

  it('"Gefunden im Quelltext" only for a request the parser found in the homepage itself', () => {
    const f = structuredClone(EXAMPLE.findings[0]!) as Finding;
    for (const e of f.evidence) if (e.type === 'request') e.initiatorType = 'script';
    expect(sourceAddresses(f, EXAMPLE)).toEqual([]);
    const g = structuredClone(EXAMPLE.findings[0]!) as Finding;
    for (const e of g.evidence) if (e.type === 'request') e.via = 'https://other.example/';
    expect(sourceAddresses(g, EXAMPLE)).toEqual([]);
  });

  it('fills a value of the page once and shows it as text', () => {
    const r = clone();
    const lang: Finding = { ...structuredClone(r.findings[3]!), id: 'a11y:html-lang-valid', textId: 'a11y-html-lang-valid', params: { value: '{value}<b>x</b>' }, field: null, evidence: [] };
    r.findings.push(lang);
    r.priorities = [lang.id];
    const c = findingCards(r)[0]!;
    expect(c.happens).toEqual(['Ihre Seite gibt als Sprache „', { page: '{value}<b>x</b>' }, '“ an, das ist kein gültiger Sprachcode.']);
    expect(render(r)).toContain('<bdi class="wrap-anywhere">{value}&lt;b&gt;x&lt;/b&gt;</bdi>');
  });

  it('a card leaves out what it has no text for, never shows a text id', () => {
    const r = clone();
    r.findings[0]!.textId = 'third-party-something-new';
    r.findings[0]!.fixTextId = 'fix-unknown-service';
    const c = findingCards(r)[0]!;
    expect(c.happens).toBeNull();
    expect(c.why).toBeNull();
    expect(c.fix).toBeNull();
    expect(render(r)).not.toContain('third-party-something-new');
  });
});

describe('the system tabs', () => {
  it('follow the WAI-ARIA tabs pattern in the markup: one tab in the Tab order, the panel named by it', () => {
    const html = render(EXAMPLE);
    expect(html).toContain('role="tablist" aria-label="System wählen"');
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
    expect(tabs).toHaveLength(5);
    expect(tabs.filter((t) => t.includes('aria-selected="true"') && t.includes('tabindex="0"'))).toHaveLength(1);
    expect(tabs.filter((t) => t.includes('aria-selected="false"') && t.includes('tabindex="-1"'))).toHaveLength(4);
    expect(tabs.every((t) => t.includes('aria-controls="fund-1-panel"'))).toBe(true);
    expect(html).toContain('role="tabpanel" id="fund-1-panel" aria-labelledby="fund-1-tab-wordpress" tabindex="0"');
    expect(html).toContain('WordPress <small>erkannt</small>');
    expect(html.match(/erkannt/g)).toHaveLength(1);
  });

  it('select the detected system, else the first without "erkannt"', () => {
    for (const [system, selected] of [['shopify', 'shopify'], ['shopware', 'shopware'], ['unknown', 'wordpress']] as const) {
      const r = clone();
      r.platform = { ...r.platform!, system, woocommerce: false };
      const fix = findingCards(r)[0]!.fix;
      if (fix?.kind !== 'systems') throw new Error('no tabs');
      expect(fix.selected).toBe(selected);
      expect(fix.detected).toBe(system === 'unknown' ? null : system);
      expect(render(r).includes('erkannt')).toBe(system !== 'unknown');
    }
    const r = clone();
    r.sections.platform = { status: 'not-checked', reason: 'quick-check' };
    expect(detectedSystem(r)).toBeNull();
  });

  it('have steps for Google Fonts only (the reference); every other fix text is still missing', () => {
    expect(Object.keys(FIX_TEXTS)).toEqual(['fix-google-fonts']);
  });
});

describe('help block, title block and stage D', () => {
  it('the title block is the reference', () => {
    const stb = /<div class="stb">([\s\S]*?)<\/div>\n<\/article>/.exec(reference)![1]!;
    const cells = [...stb.matchAll(/<span>(.*?)<\/span><strong>(.*?)<\/strong>/g)].map((m) => [m[1], m[2]]);
    expect(titleBlock(EXAMPLE, 'Europe/Berlin').map((c) => [c.label, text(c.value)])).toEqual(cells);
  });

  it('the help block leads to the address of the lead form and carries nothing of the report', () => {
    const html = render(EXAMPLE);
    expect(html).toMatch(/href="\/anfrage">Hilfe bei der Umsetzung anfragen<\/a>/);
    expect(html).not.toContain(EXAMPLE.id);
  });

  it('the example page shows the Revisionen and the Arbeitsauftrag of the reference', () => {
    const html = render(EXAMPLE, { stageD: true });
    const flat = (h: string) => strip(h).replace(/\s+/g, '');
    for (const t of [
      'RevisionenJede neue Prüfung wird eine Revision',
      'Rev.DatumÄnderungFunde',
      'A19.11.2026Erstprüfung7 Funde, davon 3 vorrangig',
      'BoffenNach Ihrer KorrekturErneut prüfen',
      'So erscheint ein erledigter Fund in der nächsten Revision:Google Fonts laden vor der Einwilligungbehoben in Rev. B',
      'Sie haben schon einen Entwickler? Der Arbeitsauftrag enthält jeden Fund mit Feld, Soll-Wert und Anleitung.',
      'Arbeitsauftrag für Ihren Entwickler',
    ]) {
      expect(flat(html)).toContain(t.replace(/\s+/g, ''));
      expect(flat(reference)).toContain(t.replace(/\s+/g, ''));
    }
    expect(html).toContain('aria-label="Revision A"');
    expect(html).toContain('aria-label="Revision B, noch offen"');
  });

  it('without the parts of stage D (every page but the example) no text of them', () => {
    const html = render(EXAMPLE);
    for (const m of STAGE_D_MARKERS) expect(html).not.toContain(m);
  });

  it('the live page of part 1 shows the upper part only (its lower part is B4 part 2)', () => {
    const html = render(EXAMPLE, { details: false });
    expect(html).not.toContain('Stückliste');
    expect(html).not.toContain('id="fund-1"');
    expect(html).not.toContain('class="stb');
    expect(html).toContain('Automatische Schnellprüfung. Keine Rechtsberatung und kein vollständiges Audit.');
  });
});

describe('numbers in words and seconds', () => {
  it('as the reference writes them', () => {
    expect(countWords(2, 'Datei', 'Dateien')).toBe('zwei Dateien');
    expect(countWords(1, 'Datei', 'Dateien')).toBe('eine Datei');
    expect(countWords(12, 'Anfrage', 'Anfragen')).toBe('zwölf Anfragen');
    expect(countWords(13, 'Anfrage', 'Anfragen')).toBe('13 Anfragen');
    expect(secondsText(309)).toBe('0,3 Sekunden');
    expect(secondsText(1000)).toBe('1 Sekunde');
    expect(secondsText(3210)).toBe('3,2 Sekunden');
    expect(secondsText(20)).toBe('weniger als 0,1 Sekunden');
  });
});
