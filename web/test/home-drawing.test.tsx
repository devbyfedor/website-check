import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeDrawing } from '../components/home/home-drawing';
import { LayerProvider } from '../components/home/layers';

// The home drawing must draw the same elements in the same order and with the same delays as the
// reference (design/README.md, rule 1: animation timings). npm run motion compares the running
// animations in a browser; this test catches a changed delay or a lost element without one.

const ROOT = join(import.meta.dirname, '..', '..');
const reference = readFileSync(join(ROOT, 'design', 'reference', 'start.html'), 'utf8');

function drawing(html: string): string {
  const start = html.indexOf('<svg viewBox="0 0 600 450"');
  return html.slice(start, html.indexOf('</svg>', start));
}

// Every element with an animation delay, in document order: its tag, the attributes that place it,
// and the delay in seconds.
function timeline(svg: string): string[] {
  const out: string[] = [];
  for (const m of svg.matchAll(/<(path|circle|text|g)\b([^>]*)>/g)) {
    const attrs = m[2]!;
    const delay = /animation-delay:\s*([\d.]+)s/.exec(attrs)?.[1];
    if (!delay) continue;
    const place = ['d', 'cx', 'cy', 'x', 'y']
      .map((a) => new RegExp(`\\s${a}="([^"]*)"`).exec(attrs)?.[1])
      .filter(Boolean)
      .join(' ');
    out.push(`${m[1]} ${place} @${Number(delay)}s`);
  }
  return out;
}

describe('home drawing', () => {
  const app = renderToStaticMarkup(
    <LayerProvider>
      <HomeDrawing />
    </LayerProvider>,
  );

  it('animates the same 25 elements in the order and with the delays of the reference', () => {
    const expected = timeline(drawing(reference));
    expect(expected).toHaveLength(25);
    expect(timeline(drawing(app))).toEqual(expected);
  });

  it('has the paths, shapes and texts of the reference', () => {
    const shapes = (svg: string) => [...svg.matchAll(/<(path|circle|rect|text)\b[^>]*?\s(?:d|cx|x)="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]}`);
    const texts = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.trim());
    expect(shapes(drawing(app))).toEqual(shapes(drawing(reference)));
    expect(texts(drawing(app))).toEqual(texts(drawing(reference)));
  });
});
