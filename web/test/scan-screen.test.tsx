import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_SCAN } from '../components/scan/example-scan';
import { ScanScreen } from '../components/scan/scan-screen';

// The scan screen with the example data must draw the same elements in the same order, with the same
// delays and durations, texts and shapes as design/reference/pruefung.html (design/README.md, rule 1).
// npm run motion compares the running animations in a browser; this test catches a changed time or a
// lost element without one.

const ROOT = join(import.meta.dirname, '..', '..');
const WEB = join(ROOT, 'web');
const reference = readFileSync(join(ROOT, 'design', 'reference', 'pruefung.html'), 'utf8');
const app = renderToStaticMarkup(<ScanScreen scan={EXAMPLE_SCAN} />);

const body = (html: string): string => html.slice(html.indexOf('<header'), html.lastIndexOf('</footer>'));

// Every element with an inline animation delay, in document order: its tag, the attributes that place
// it, the delay and the duration in seconds.
function timeline(html: string): string[] {
  const out: string[] = [];
  for (const m of body(html).matchAll(/<(path|circle|text|g|li|section)\b([^>]*)>/g)) {
    const attrs = m[2]!;
    const delay = /animation-delay:\s*([\d.]+)s/.exec(attrs)?.[1];
    if (!delay) continue;
    const duration = /animation-duration:\s*([\d.]+)s/.exec(attrs)?.[1];
    const place = ['d', 'cx', 'cy', 'x', 'y']
      .map((a) => new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)?.[1])
      .filter(Boolean)
      .join(' ');
    out.push(`${m[1]} ${place} @${Number(delay)}s${duration ? ` for ${Number(duration)}s` : ''}`);
  }
  return out;
}

const svg = (html: string): string => {
  const start = html.indexOf('<svg viewBox="0 0 600 450"');
  return html.slice(start, html.indexOf('</svg>', start));
};
const texts = (html: string): string[] =>
  [...body(html).replace(/<style[\s\S]*?<\/style>/g, '').matchAll(/>([^<>]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);

describe('scan screen with the example of the reference', () => {
  it('animates the same elements in the order and with the delays and durations of the reference', () => {
    const expected = timeline(reference);
    // 24 in the drawing (the carriage, the pen and the time bar have their delay in the class),
    // 8 steps and their 8 ticks, the report panel.
    expect(expected).toHaveLength(41);
    expect(timeline(app)).toEqual(expected);
  });

  it('grows the time bar with the duration and delay of the reference', () => {
    // The reference sets them in its class (`.pbar { animation: grow 7.2s linear .2s forwards }`), the app
    // inline from the scan data.
    const [, duration, delay] = /\.pbar\s*\{[^}]*animation:\s*grow\s+([\d.]+)s\s+linear\s+([\d.]+)s/.exec(reference)!;
    const bar = /<div class="[^"]*pbar[^"]*"[^>]*style="([^"]*)"/.exec(app)?.[1] ?? '';
    expect(Number(/animation-delay:\s*([\d.]+)s/.exec(bar)?.[1])).toBe(Number(delay));
    expect(Number(/animation-duration:\s*([\d.]+)s/.exec(bar)?.[1])).toBe(Number(duration));
  });

  it('has the paths, shapes and texts of the reference in the drawing', () => {
    const shapes = (s: string) => [...s.matchAll(/<(path|circle|rect|text)\b[^>]*?\s(?:d|cx|x)="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(shapes(svg(app))).toEqual(shapes(svg(reference)));
    const label = (s: string) => /aria-label="([^"]*)"/.exec(s)?.[1];
    expect(label(svg(app))).toBe(label(svg(reference)));
  });

  it('shows every text of the reference page in the same order', () => {
    expect(texts(app)).toEqual(texts(reference));
  });
});

describe('the example data', () => {
  // A visitor must never see the example in place of their own scan: only the example page of the
  // checks (page.example.tsx, built with WC_EXAMPLES=1) may import it.
  it('is imported only by the example page', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'out', '.next', 'test'].includes(e.name)) continue;
        const path = join(dir, e.name);
        if (e.isDirectory()) walk(path);
        else if (/\.(tsx?|mjs|js)$/.test(e.name) && /example-scan['"]/.test(readFileSync(path, 'utf8'))) importers.push(path.slice(WEB.length + 1).replaceAll('\\', '/'));
      }
    };
    walk(WEB);
    expect(importers).toEqual(['app/pruefung/beispiel/page.example.tsx']);
  });
});
