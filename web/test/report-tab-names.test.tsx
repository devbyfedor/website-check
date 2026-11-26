import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Report } from '@website-check/scanner/report';
import exampleJson from '../components/report/example-report.json';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states';
import { ReportScreen } from '../components/report/report-screen';
import { findingCards, moreFindingCards, type FindingCard } from '../lib/report-detail-view';

// Session C0 (Fedor's answer 2): every tab list of the system tabs is named "System wählen:" of the reference plus the
// title of its card, so the tab lists of a page never share a name. Checked here on the markup of every report state;
// npm run check:report checks the names Chrome computes on every state and on the saved reports.

const EXAMPLE = exampleJson as unknown as Report;
const REPORT_STATES = [
  { slug: 'beispiel', report: EXAMPLE },
  ...EXAMPLE_REPORT_STATES.flatMap((s) => {
    const shown = s.show();
    return 'report' in shown ? [{ slug: s.slug, report: shown.report }] : [];
  }),
];
const render = (report: Report): string => renderToStaticMarkup(<ReportScreen report={report} timeZone="Europe/Berlin" />);
const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const flat = (s: string): string => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : decode(m[1]!);
};
const titleText = (c: FindingCard): string => (typeof c.title === 'string' ? c.title : c.title.map((x) => (typeof x === 'string' ? x : x.page)).join(''));

interface TabList {
  id: string | null;
  label: string | null;
  labelledBy: string | null;
  name: string;
}

// The accessible name of each tab list, by the steps of accname 1.2 that its markup uses: aria-labelledby with its ids
// in order, joined by a space; the id of the list itself gives its aria-label (step 2B is not taken again inside the
// traversal, step 2D is), any other id the text of the element it names (a heading with text and <bdi>).
function tabLists(html: string): TabList[] {
  return [...html.matchAll(/<div\b[^>]*\brole="tablist"[^>]*>/g)].map(([tag]) => {
    const id = attr(tag, 'id');
    const label = attr(tag, 'aria-label');
    const labelledBy = attr(tag, 'aria-labelledby');
    const parts = (labelledBy ?? '').split(/\s+/).filter((x) => x !== '');
    const name =
      parts.length === 0
        ? (label ?? '')
        : parts
            .map((ref) => {
              if (ref === id) return label ?? '';
              const found = [...html.matchAll(new RegExp(`<(h[1-6]|span|div|p)\\b[^>]*\\sid="${ref}"[^>]*>([\\s\\S]*?)</\\1>`, 'g'))];
              if (found.length !== 1) throw new Error(`id ${ref} found ${found.length} times`);
              return flat(found[0]![2]!);
            })
            .join(' ')
            .trim();
    return { id, label, labelledBy, name };
  });
}

describe('the names of the tab lists (session C0, Fedor’s answer 2)', () => {
  it('the example: "System wählen:" and the title of the card, the first as in the reference plus its title', () => {
    const lists = tabLists(render(EXAMPLE));
    expect(lists.map((l) => l.name)).toEqual([
      'System wählen: Google Fonts laden vor der Einwilligung',
      'System wählen: Google Analytics startet vor der Einwilligung',
      'System wählen: Google Tag Manager startet vor der Einwilligung',
    ]);
    expect(lists.map((l) => l.id)).toEqual(['fund-1-systeme', 'fund-2-systeme', 'fund-4-systeme']);
    expect(lists.map((l) => l.labelledBy)).toEqual(['fund-1-systeme fund-1-titel', 'fund-2-systeme fund-2-titel', 'fund-4-systeme fund-4-titel']);
  });

  it.each(REPORT_STATES.map((s) => [s.slug, s.report] as const))('%s: every tab list has a name of its own, that of its card', (_slug, report) => {
    const html = render(report);
    const lists = tabLists(html);
    const tabbed = [...findingCards(report), ...moreFindingCards(report)].filter((c) => c.fix.kind === 'systems');
    expect(lists).toHaveLength(tabbed.length);
    expect(lists.map((l) => l.name)).toEqual(tabbed.map((c) => `System wählen: ${titleText(c)}`));
    expect(new Set(lists.map((l) => l.name)).size).toBe(lists.length);
    // Only our own text goes into the attribute; the title (with the strings of the page in <bdi>) stays in the heading.
    for (const l of lists) expect(l.label).toBe('System wählen:');
    for (const c of tabbed) expect(html.match(new RegExp(`\\sid="${c.id}-titel"`, 'g'))).toHaveLength(1);
  });

  it('the checks are not empty: a state with four tab lists, and states with one and none', () => {
    const counts = REPORT_STATES.map((s) => tabLists(render(s.report)).length);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(4);
    expect(counts).toContain(0);
    expect(counts).toContain(1);
  });

  it('a title with a string of the page: the name holds the string, the attribute does not', () => {
    const r = structuredClone(EXAMPLE);
    const f = r.findings.find((x) => x.id === 'third-party:google-fonts')!;
    // An unknown service key: the title is "{service} …" with the name from the page.
    f.serviceKey = 'cdn.beispiel-dienst.example';
    f.params = { ...f.params, service: 'Dienst <b>&amp; Co' };
    const html = render(r);
    const first = tabLists(html)[0]!;
    expect(first.name.startsWith('System wählen: ')).toBe(true);
    expect(first.name).toContain('Dienst <b>&amp; Co');
    expect(first.label).toBe('System wählen:');
    expect(html).toMatch(/<h2 id="fund-1-titel"[^>]*>[^]*?<bdi[^>]*>Dienst &lt;b&gt;&amp;amp; Co<\/bdi>/);
  });
});
