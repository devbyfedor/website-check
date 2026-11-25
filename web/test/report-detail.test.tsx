import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Finding, Report, TextId } from '@website-check/scanner/report';
import exampleJson from '../components/report/example-report.json';
import { ReportScreen } from '../components/report/report-screen';
import { HAND_OVER, Revisions, WORK_ORDER } from '../components/report/stage-d';
import { WORDPRESS_FONTS_STEP_1 } from '../scripts/image-diff';
import { countWords, FIX_TEXTS, secondsText, SERVICE_FIX } from '../lib/report-detail-texts';
import { copyListText, detectedSystem, findingCards, helpView, serviceRows, showsLowerPart, sourceAddresses, titleBlock } from '../lib/report-detail-view';
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
const render = (report: Report, opts: { stageD?: boolean } = {}): string =>
  renderToStaticMarkup(
    <ReportScreen
      report={report}
      timeZone="Europe/Berlin"
      {...(opts.stageD ? { stageD: { revisions: <Revisions report={report} timeZone="Europe/Berlin" />, workOrder: WORK_ORDER, developer: HAND_OVER } } : {})}
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
    // eingeholt": a service that waits for a click, gap 3), so jsDelivr is position 4, not 5; "Google Analytics" of
    // the rules data (the short names of B4 part 2) for the reference's "Google Analytics 4", a version the scan does
    // not tell.
    const pairs: [number, number, string | null][] = [
      [0, 0, null],
      [1, 1, null],
      [2, 2, 'Google Analytics'],
      [3, 4, null],
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

  it('a cut list counts every service found (review of B4 part 1)', () => {
    const r = clone();
    r.truncated.services = true;
    r.counts.services = 95;
    expect(render(r)).toContain('95 Dienste gefunden');
    expect(render(EXAMPLE)).toContain('4 Dienste gefunden');
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
    // The reference's panels in order: WordPress, Shopify, Wix, Jimdo, Shopware. The WordPress steps are final and the same;
    // session texts-fix replaced the drafts of the other four by steps the documentation confirms (Jimdo: none, so its tab
    // shows the general steps), docs/content-drafts.md, "Steps by system of the five services".
    const panels = [...fund.matchAll(/<ol class="steps">([\s\S]*?)<\/ol>/g)].map((m) => [...m[1]!.matchAll(/<li>(.*?)<\/li>/g)].map((l) => decode(l[1]!)));
    expect(panels).toHaveLength(5);
    // Session B5 part 2: the first WordPress step in the narrower wording the check confirmed (the decided wording that
    // npm run visual puts into the reference, web/scripts/image-diff.ts); steps 2 and 3 are the reference's.
    expect(c.fix.steps.wordpress).toEqual([WORDPRESS_FONTS_STEP_1.decided, ...panels[0]!.slice(1)]);
    expect(panels[0]![0]).toBe(WORDPRESS_FONTS_STEP_1.reference);
    const fonts = FIX_TEXTS['fix-google-fonts']!;
    expect([c.fix.steps.shopify, c.fix.steps.wix, c.fix.steps.shopware]).toEqual([fonts.shopify, fonts.wix, fonts.shopware]);
    expect(c.fix.steps.jimdo).toBeNull();
    expect(c.fix.general).toEqual(SERVICE_FIX['fix-google-fonts']);
  });

  it('the second and third card: drafts, the Prüfmaß of the same thing, and no part without a text', () => {
    const [, ga, contrast] = cards;
    expect(ga!.happens).toBe(
      'Ihre Startseite stellt drei Anfragen an Server von Google, die erste 3,2 Sekunden nach dem Aufruf. Google erhält dabei die IP-Adresse jedes Besuchers, ohne dass dieser zugestimmt hat.',
    );
    expect(ga!.targetActual).toEqual({ target: '0 Anfragen an Google', actual: '3 Anfragen, ohne Einwilligung', bad: true });
    expect(ga!.source).toEqual([]); // the requests of Google Analytics are made by the Google tag
    // Session texts-fix: the steps by system of Google Analytics (one of the five services found most often), the general
    // steps for the systems without confirmed ones.
    if (ga!.fix.kind !== 'systems') throw new Error('no tabs');
    expect(ga!.fix.selected).toBe('wordpress');
    expect(ga!.fix.steps.wordpress).toEqual(FIX_TEXTS['fix-google-analytics']!.wordpress);
    expect([ga!.fix.steps.jimdo, ga!.fix.steps.shopware]).toEqual([null, null]);
    expect(ga!.fix.general).toEqual(SERVICE_FIX['fix-google-analytics']);
    expect(text(contrast!.happens!)).toBe('An 14 Stellen hebt sich der Text zu wenig vom Hintergrund ab, der schwächste Wert liegt bei 2,9 : 1 statt mindestens 4,5 : 1.');
    // The ratio with no-break spaces, so it never wraps inside the narrow box at 390 px.
    expect(contrast!.targetActual).toEqual({ target: 'mind. 4,5 : 1', actual: '2,9 : 1', bad: true });
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

  it('"vor dem Banner" for every request only when each kept request started before it (review of B4 part 1)', () => {
    const r = clone();
    r.findings[0]!.params.count = 5; // the report keeps two of five requests
    expect(findingCards(r)[0]!.targetActual?.actual).toBe('5 Anfragen, die erste vor dem Banner');
    const s = clone();
    const second = s.findings[0]!.evidence[1]!;
    if (second.type === 'request') second.beforeBanner = false;
    expect(findingCards(s)[0]!.targetActual?.actual).toBe('2 Anfragen, die erste vor dem Banner');
    expect(findingCards(EXAMPLE)[0]!.targetActual?.actual).toBe('2 Anfragen, vor dem Banner');
  });

  it('one request has no "die erste" (review of B4 part 1)', () => {
    const r = clone();
    const ga = r.findings.find((f) => f.id === 'third-party:google-analytics')!;
    ga.params.count = 1;
    ga.evidence = ga.evidence.slice(0, 1);
    expect(findingCards(r)[1]!.happens).toBe(
      'Ihre Startseite stellt eine Anfrage an Server von Google, 3,2 Sekunden nach dem Aufruf. Google erhält dabei die IP-Adresse jedes Besuchers, ohne dass dieser zugestimmt hat.',
    );
    expect(findingCards(r)[1]!.targetActual?.actual).toBe('1 Anfrage, ohne Einwilligung');
  });

  it('the contrast card names the values of its own text, also for large text (review of B4 part 1)', () => {
    const r = clone();
    const c = r.findings.find((f) => f.id === 'a11y:color-contrast')!;
    c.params.expected = '3:1';
    c.params.ratio = 2.2;
    const card = findingCards(r)[2]!;
    expect(text(card.happens!)).toContain('liegt bei 2,2 : 1 statt mindestens 3 : 1.');
    expect(card.targetActual).toEqual({ target: 'mind. 3 : 1', actual: '2,2 : 1', bad: true });
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
    r.findings[0]!.textId = 'third-party-something-new' as unknown as TextId; // an id of a newer scanner
    r.findings[0]!.fixTextId = 'fix-unknown-service';
    const c = findingCards(r)[0]!;
    expect(c.happens).toBeNull();
    expect(c.why).toBeNull();
    expect(c.fix).toEqual({ kind: 'missing' });
    expect(render(r)).not.toContain('third-party-something-new');
    expect(render(r)).toContain('Für diesen Punkt haben wir noch keine Anleitung.');
  });

  // Session B4 part 2 (Fedor): a card is never empty; without a text it shows the fact that the scan found the point.
  it('a card without any text or value says that the scan found the point', () => {
    const r = clone();
    const f = r.findings.find((x) => x.id === r.priorities[0])!;
    f.textId = 'something-new' as unknown as TextId;
    f.area = 'security';
    f.serviceKey = null;
    f.fixTextId = null;
    const c = findingCards(r)[0]!;
    expect(c.happens).toBe('Die Prüfung hat diesen Punkt gefunden. Eine Beschreibung dazu schreiben wir noch.');
    expect([c.targetActual, c.why, c.source, c.fix]).toEqual([null, null, [], { kind: 'missing' }]);
    const html = render(r);
    expect(html).toContain('Die Prüfung hat diesen Punkt gefunden.');
    expect(html).not.toContain('something-new');
  });
});

describe('the system tabs', () => {
  it('follow the WAI-ARIA tabs pattern in the markup: one tab in the Tab order, the panel named by it', () => {
    const html = render(EXAMPLE);
    expect(html).toContain('role="tablist" aria-label="System wählen"');
    // Session texts-fix: the second card (Google Analytics) has tabs too; these are the tabs of the first.
    expect([...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)]).toHaveLength(10);
    const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('aria-controls="fund-1-panel"'));
    expect(tabs).toHaveLength(5);
    expect(tabs.filter((t) => t.includes('aria-selected="true"') && t.includes('tabindex="0"'))).toHaveLength(1);
    expect(tabs.filter((t) => t.includes('aria-selected="false"') && t.includes('tabindex="-1"'))).toHaveLength(4);
    expect(tabs.every((t) => t.includes('aria-controls="fund-1-panel"'))).toBe(true);
    expect(html).toContain('role="tabpanel" id="fund-1-panel" aria-labelledby="fund-1-tab-wordpress" tabindex="0"');
    expect(html).toContain('WordPress <small>erkannt</small>');
    expect(html.match(/erkannt/g)).toHaveLength(2); // one per card with tabs
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

  it('a detected Shopware 5 gets none of the Shopware 6 steps (review of B4 part 1), but the general steps (texts-fix)', () => {
    const r = clone();
    r.platform = { system: 'shopware', woocommerce: false, shopwareVersion: 5, shop: true };
    const fix = findingCards(r)[0]!.fix;
    if (fix?.kind !== 'systems') throw new Error('no tabs');
    expect(fix.selected).toBe('shopware');
    expect(fix.steps.shopware).toBeNull();
    expect(fix.general).toEqual(SERVICE_FIX['fix-google-fonts']);
    const html = render(r);
    expect(html).toContain('Binden Sie sie mit @font-face aus diesen Dateien ein');
    expect(html).not.toContain('Für Shopware 5 haben wir noch keine eigene Anleitung.');
    expect(html).not.toContain('In Shopware 6 legen Sie die Schriftdateien');
    r.platform = { ...r.platform, shopwareVersion: 6 };
    expect(render(r)).toContain('In Shopware 6 legen Sie die Schriftdateien');
  });

  it('have steps for the five services found most often only (session texts-fix)', () => {
    expect(Object.keys(FIX_TEXTS).sort()).toEqual(['fix-google-ads', 'fix-google-analytics', 'fix-google-fonts', 'fix-google-tag-manager', 'fix-youtube-nocookie']);
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

  it('every page shows the lower part (B4 part 2), without the parts of stage D', () => {
    const html = render(EXAMPLE);
    expect(html).toContain('Stückliste der fremden Dienste');
    expect(html).toContain('id="fund-1"');
    expect(html).toContain('Benennung');
    expect(html).toContain('Hilfe bei der Umsetzung anfragen');
    expect(html).not.toContain('An Entwickler weitergeben');
    expect([...html.matchAll(/<button type="button" class="[^"]*">(Als PDF speichern|Link kopieren|Liste für die Datenschutzerklärung kopieren)</g)]).toHaveLength(3);
    expect(render(EXAMPLE, { stageD: true })).toContain('An Entwickler weitergeben');
  });

  it('a report whose homepage was not checked shows its head, the note and the title block, no lower part', () => {
    const r = clone();
    r.pages.homepage = 'not-checked' as Report['pages']['homepage'];
    expect(showsLowerPart(r)).toBe(false);
    const html = render(r);
    expect(html).not.toContain('Stückliste');
    expect(html).not.toContain('id="fund-1"');
    expect(html).not.toContain('Hilfe bei der Umsetzung anfragen');
    expect(html).toContain('Benennung');
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

// Session B4 part 2: the copied list, the help text and the country next to the findings before consent.
describe('the copied list of the Stückliste', () => {
  it('has the form of the reference\'s script, with the data schema v1 holds', () => {
    // The reference: "Externe Dienste auf roesterei-muster.de (Prüfung vom 19.11.2026):", "1. Google Fonts (Google),
    // Schriften" … "5. jsDelivr, Skripte". The example has no YouTube row (gap 3) and "Google Analytics" (no version).
    expect(copyListText(EXAMPLE, 'Europe/Berlin')).toBe(
      [
        'Externe Dienste auf roesterei-muster.de (Prüfung vom 19.11.2026):',
        '1. Google Fonts (Google), Schriften',
        '2. Google Tag Manager (Google), lädt weitere Skripte',
        '3. Google Analytics (Google), Statistik',
        '4. jsDelivr, Skripte',
      ].join('\n'),
    );
    for (const line of ['Externe Dienste auf roesterei-muster.de (Prüfung vom 19.11.2026):', '1. Google Fonts (Google), Schriften', '2. Google Tag Manager (Google), lädt weitere Skripte', '5. jsDelivr, Skripte']) {
      expect(reference).toContain(`'${line}'`);
    }
  });

  it('takes the provider into the brackets of a short name, or leaves it out when the name before them is the provider', () => {
    const r = clone();
    r.services[0] = { ...r.services[0]!, name: 'Mouseflow (Ladeskript)', provider: 'Mouseflow', category: 'session-recording' };
    r.services[1] = { ...r.services[1]!, name: 'YouTube (erweiterter Datenschutzmodus)', provider: 'Google', category: 'video' };
    const lines = copyListText(r, 'Europe/Berlin').split('\n');
    expect(lines[1]).toBe('1. Mouseflow (Ladeskript), Aufzeichnung von Besuchen');
    expect(lines[2]).toBe('2. YouTube (erweiterter Datenschutzmodus, Google), Video');
  });

  it('keeps strings of the page plain: no control or direction characters, no line that starts a formula', () => {
    const r = clone();
    r.site.displayHost = 'evil\u202e.de';
    r.services[3] = { ...r.services[3]!, known: false, name: '=cmd|\u202ecalc\n2. fake\u2028=x', provider: null, category: 'unknown' };
    r.truncated.services = true;
    r.counts.services = 7;
    const lines = copyListText(r, 'Europe/Berlin').split('\n');
    expect(lines[0]).toBe('Externe Dienste auf evil.de (Prüfung vom 19.11.2026):');
    expect(lines[4]).toBe('4. =cmd|calc2. fake=x, unbekannter Dienst');
    expect(lines[5]).toBe('… und 3 weitere Dienste, die der Bericht nicht einzeln aufführt.');
    expect(lines).toHaveLength(6);
    for (const line of lines.slice(1)) expect(line).toMatch(/^(\d+\. |… )/);
  });
});

describe('the help block', () => {
  it('names what the priorities are about: the reference\'s text for those of the example', () => {
    expect(helpView(EXAMPLE)).toEqual({
      heading: 'Sie möchten das nicht selbst umsetzen?',
      text: 'Ich behebe die Funde für Sie: Schriften lokal einbinden, die Einwilligung richtig einstellen, Barrieren entfernen. Antwort per E-Mail.',
    });
    expect(strip(reference)).toContain('Ich behebe die Funde für Sie: Schriften lokal einbinden, die Einwilligung richtig einstellen, Barrieren entfernen. Antwort per E-Mail.');
  });

  it('no task for a point to check by hand (the Impressum link not found is "bitte manuell prüfen")', () => {
    const r = clone();
    const f = r.findings.find((x) => x.id === r.priorities[2])!;
    f.textId = 'legal-impressum-no-link';
    f.area = 'mandatory-information' as Finding['area'];
    f.kind = 'manual';
    r.priorities = [f.id];
    expect(helpView(r).text).toBe('Ich behebe die Funde für Sie. Antwort per E-Mail.');
  });

  it('only what applies, and a text of its own without priorities', () => {
    const r = clone();
    r.priorities = r.priorities.filter((id) => id.startsWith('a11y'));
    expect(helpView(r).text).toBe('Ich behebe die Funde für Sie: Barrieren entfernen. Antwort per E-Mail.');
    r.priorities = [];
    expect(helpView(r)).toEqual({ heading: 'Sie möchten Ihre Website genauer prüfen lassen?', text: 'Unsere automatische Prüfung sieht nur die Startseite und das Impressum. Ich sehe mir Ihre Website gern genauer an. Antwort per E-Mail.' });
  });
});

describe('the country next to a finding about data sent before consent', () => {
  it('stands under "vor der Einwilligung" and under "Was passiert" of such a finding only', () => {
    expect(serviceRows(EXAMPLE).map((x) => x.country)).toEqual([null, null, null, null]); // the reference names no country
    const r = clone();
    r.visit = { ...r.visit, country: 'IT' };
    const rows = serviceRows(r);
    const before = new Set(r.findings.filter((f) => f.kind === 'finding' && f.beforeConsent).map((f) => f.id));
    rows.forEach((row, i) => expect(row.country).toBe(before.has(r.services[i]!.findingId ?? '') ? 'Land des Aufrufs: Italien' : null));
    expect(rows.filter((x) => x.country !== null).length).toBe(3); // Google Fonts, the Google tag, Google Analytics
    expect(rows[3]!.country).toBeNull(); // jsDelivr: a hint (Graubereich), its data before consent is not a finding
    const cards = findingCards(r);
    for (const c of cards) {
      const f = r.findings.find((x) => x.id === r.priorities[c.number - 1])!;
      expect(c.country).toBe(f.kind === 'finding' && f.beforeConsent ? 'Land des Aufrufs: Italien' : null);
    }
    expect(render(r)).toContain('Land des Aufrufs: Italien');
    r.visit = { ...r.visit, country: 'XX' };
    expect(serviceRows(r).every((x) => x.country === null)).toBe(true);
  });
});
