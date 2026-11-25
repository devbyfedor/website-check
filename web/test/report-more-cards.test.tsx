import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Finding, Report } from '@website-check/scanner/report';
import exampleJson from '../components/report/example-report.json';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states';
import { ReportScreen } from '../components/report/report-screen';
import { checkItems } from '../lib/report-checks-view';
import { DETAIL_TEXTS as T } from '../lib/report-detail-texts';
import { cardedIds, findingCards, moreFindingCards } from '../lib/report-detail-view';
import { measured } from '../lib/report-view';

// Session C0 (Fedor's answer 2 of B5 part 2): every finding with a risk beyond "Drei Dinge" gets a full card like the
// three of the plan (what happens, why it matters, the system tabs), under a heading of its own after those cards and
// before "Bitte selbst prüfen". A state the design does not show (/bericht/beispiel/weitere-funde); npm run
// check:report looks at it, at every other state and at the saved reports in a browser.

const EXAMPLE = exampleJson as unknown as Report;
const reportOf = (slug: string): Report => {
  const shown = EXAMPLE_REPORT_STATES.find((s) => s.slug === slug)?.show();
  if (shown === undefined || !('report' in shown)) throw new Error(`no report state ${slug}`);
  return shown.report;
};
const render = (report: Report): string => renderToStaticMarkup(<ReportScreen report={report} timeZone="Europe/Berlin" />);
const text = (p: ReturnType<typeof findingCards>[number]['title']): string => (typeof p === 'string' ? p : p.map((x) => (typeof x === 'string' ? x : x.page)).join(''));
/** The findings with a risk, by the builder's rule for "Drei Dinge" (scanner/src/report/build.ts, `prioritiesOf`). */
const withRisk = (r: Report): Finding[] => r.findings.filter((f) => f.risk !== null && (f.kind === 'finding' || f.kind === 'manual'));
const REPORT_STATES = [
  { slug: 'beispiel', report: EXAMPLE },
  ...EXAMPLE_REPORT_STATES.flatMap((s) => {
    const shown = s.show();
    return 'report' in shown ? [{ slug: s.slug, report: shown.report }] : [];
  }),
];

describe('the cards of the other findings with a risk', () => {
  it('the state weitere-funde: six cards after the three of the plan, in the order of the plan, numbered on', () => {
    const r = reportOf('weitere-funde');
    expect(findingCards(r).map((c) => c.findingId)).toEqual(['third-party:google-fonts', 'third-party:google-tag-manager', 'third-party:google-analytics']);
    const more = moreFindingCards(r);
    expect(more.map((c) => c.number)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(more.map((c) => c.id)).toEqual(['fund-4', 'fund-5', 'fund-6', 'fund-7', 'fund-8', 'fund-9']);
    // High risk first (the Meta Pixel, a finding, before the Impressum link, a manual check), then medium, then low.
    expect(more.map((c) => c.findingId)).toEqual(['third-party:meta-pixel', 'legal:impressum', 'third-party:youtube-nocookie', 'a11y:color-contrast', 'a11y:image-alt', 'security:headers']);
    expect(more.map((c) => c.fix.kind)).toEqual(['general', 'general', 'systems', 'general', 'general', 'general']);
    // Every card has what happens, why it matters and steps: no card is a bare title.
    for (const c of more) {
      expect(c.happens, c.id).not.toBeNull();
      expect(c.why, c.id).not.toBeNull();
      expect(c.fix.kind, c.id).not.toBe('missing');
    }
  });

  it('the example of the reference: Google Tag Manager, the images and the security headers after its three cards', () => {
    expect(EXAMPLE.priorities).toEqual(['third-party:google-fonts', 'third-party:google-analytics', 'a11y:color-contrast']);
    const more = moreFindingCards(EXAMPLE);
    expect(more.map((c) => [c.id, c.findingId])).toEqual([
      ['fund-4', 'third-party:google-tag-manager'],
      ['fund-5', 'a11y:image-alt'],
      ['fund-6', 'security:headers'],
    ]);
    expect(text(more[0]!.title)).toContain('Google Tag Manager');
    expect(more[0]!.fix.kind).toBe('systems');
  });

  it('every finding with a risk of every report state has exactly one card, and no other finding has one', () => {
    let cards = 0;
    for (const { slug, report } of REPORT_STATES) {
      const shown = [...findingCards(report), ...moreFindingCards(report)];
      if (!measured(report)) {
        expect(shown, slug).toEqual([]);
        continue;
      }
      expect(shown.map((c) => c.findingId).sort(), slug).toEqual(withRisk(report).map((f) => f.id).sort());
      expect([...cardedIds(report)].sort(), slug).toEqual(withRisk(report).map((f) => f.id).sort());
      expect(new Set(shown.map((c) => c.id)).size, slug).toBe(shown.length);
      cards += shown.length;
    }
    expect(cards).toBeGreaterThan(30);
  });

  it('a report with at most three findings with a risk has no further cards and no heading', () => {
    const r = reportOf('zwei-punkte');
    expect(withRisk(r).length).toBeLessThanOrEqual(3);
    expect(moreFindingCards(r)).toEqual([]);
    expect(render(r)).not.toContain(T.moreHeading);
  });

  it('a report that measured nothing (an almost empty page) has none', () => {
    const r = reportOf('fast-leer');
    expect(moreFindingCards(r)).toEqual([]);
    expect(findingCards(r)).toEqual([]);
  });

  it('a manual check with a risk that got a card is not in "Bitte selbst prüfen" too', () => {
    const r = reportOf('weitere-funde');
    expect(cardedIds(r).has('legal:impressum')).toBe(true);
    expect(checkItems(r).map((i) => i.key)).toEqual(['third-party:jsdelivr']);
  });
});

describe('the page with the further cards', () => {
  const html = render(reportOf('weitere-funde'));
  const card = (id: string) => html.slice(html.indexOf(`<section id="${id}"`), html.indexOf('</section>', html.indexOf(`<section id="${id}"`)));

  it('the heading with its count in the form of the head of the Stückliste, then the cards, then "Bitte selbst prüfen"', () => {
    expect(T.moreHeading).toBe('Weitere Punkte mit Risiko');
    expect(T.moreCount(1)).toBe('1 Punkt');
    expect(html).toContain('<section class="flex flex-col gap-14" data-part="more-findings" aria-labelledby="weitere-funde">');
    expect(html).toMatch(new RegExp(`<h2 id="weitere-funde" class="[^"]+">${T.moreHeading}</h2>`));
    expect(html).toContain(`>${T.moreCount(6)}</span>`);
    const at = (s: string) => html.indexOf(s);
    expect(at('id="fund-3"')).toBeLessThan(at('data-part="more-findings"'));
    expect(at('data-part="more-findings"')).toBeLessThan(at('id="fund-4"'));
    expect(at('id="fund-9"')).toBeLessThan(at('data-part="checks"'));
    expect(at('data-part="checks"')).toBeLessThan(at('href="/anfrage"'));
  });

  it('each card is a card of the plan with its number, its title one level lower (h3, its parts h4), the same classes', () => {
    const plan = card('fund-1');
    const more = card('fund-6');
    const h2s = /<h2 class="([^"]+)">/.exec(plan)![1]!;
    const h3s = /<h3 class="([^"]+)">Was passiert<\/h3>/.exec(plan)![1]!;
    expect(more).toContain('aria-hidden="true">6</span>');
    expect(more).toContain(`<h3 class="${h2s}">`);
    expect(more).not.toContain('<h2');
    expect(more).toContain(`<h4 class="${h3s}">Was passiert</h4>`);
    expect(more).toContain(`<h4 class="${h3s}">Warum das wichtig ist</h4>`);
    expect(more).toContain('>Montageanleitung</h4>');
    expect(more).not.toContain('>Was passiert</h3>');
    expect(more).not.toContain('>Montageanleitung</h3>');
    // The system tabs of the YouTube card by the WAI-ARIA tabs pattern, with ids of their own.
    expect(more).toContain('role="tablist"');
    expect(more).toContain('role="tabpanel" id="fund-6-panel" aria-labelledby="fund-6-tab-wordpress" tabindex="0"');
    // A card of general steps (the Meta Pixel) keeps the box of the plan's cards with its h4.
    expect(card('fund-4')).toContain('>Montageanleitung</h4>');
    expect(card('fund-4')).toMatch(/<ol class="[^"]+"><li>/);
  });

  it('the outline of the page never skips a level', () => {
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    expect(levels.filter((l) => l === 4).length).toBeGreaterThan(6);
  });

  it('the links of "Drei Dinge" still lead to the three cards of the plan only', () => {
    expect([...html.matchAll(/href="#(fund-\d+)"/g)].map((m) => m[1])).toEqual(['fund-1', 'fund-2', 'fund-3']);
  });
});
