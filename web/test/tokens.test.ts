import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every value of design/tokens.css must reach the app unchanged (brief, B1: Tailwind CSS v4 with
// the values from design/tokens.css). A token added to tokens.css fails here until it is mapped.

const ROOT = join(import.meta.dirname, '..', '..');
const tokensCss = readFileSync(join(ROOT, 'design', 'tokens.css'), 'utf8');
const globalsCss = readFileSync(join(ROOT, 'web', 'app', 'globals.css'), 'utf8');

function declarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1]!, m[2]!);
  return out;
}

function normalize(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/(^|[^\d])\.(\d)/g, '$10.$2')
    .trim()
    .toLowerCase();
}

// Token in design/tokens.css → variable in web/app/globals.css.
const MAP: Record<string, string> = {
  '--wc-blueprint': '--color-blueprint',
  '--wc-blueprint-deep': '--color-blueprint-deep',
  '--wc-blueprint-ink': '--color-blueprint-ink',
  '--wc-chalk': '--color-chalk',
  '--wc-chalk-muted': '--color-chalk-muted',
  '--wc-cyan': '--color-cyan',
  '--wc-pencil-light': '--color-pencil-light',
  '--wc-placeholder-on-blueprint': '--color-placeholder-on-blueprint',
  '--wc-paper': '--color-paper',
  '--wc-ink': '--color-ink',
  '--wc-ink-body': '--color-ink-body',
  '--wc-ink-muted': '--color-ink-muted',
  '--wc-line': '--color-line',
  '--wc-link': '--color-link',
  '--wc-pencil': '--color-pencil',
  '--wc-rule': '--color-rule',
  '--wc-code-bg': '--color-code-bg',
  '--wc-own-request': '--color-own-request',
  '--wc-font-body': '--font-body',
  '--wc-font-head': '--font-head',
  '--wc-grid-image': '--wc-grid-image',
  '--wc-grid-size': '--wc-grid-size',
  '--wc-sheet-shadow': '--shadow-sheet',
  '--wc-container': '--container-page',
  '--wc-gutter': '--spacing-gutter',
  '--wc-draw-duration': '--wc-draw-duration',
  '--wc-draw-ease': '--ease-draw',
  '--wc-pop-duration': '--wc-pop-duration',
};

// The font families are the self-hosted ones from next/font (app/fonts.ts).
function fontFamiliesAsInApp(value: string): string {
  return value
    .replace(/'Barlow Semi Condensed'/g, 'var(--font-barlow-semi-condensed)')
    .replace(/'Barlow'/g, 'var(--font-barlow)');
}

describe('design tokens', () => {
  const tokens = declarations(tokensCss);
  const app = declarations(globalsCss);

  it('reads the tokens file', () => {
    expect(tokens.size).toBeGreaterThanOrEqual(28);
  });

  it('maps every token of design/tokens.css', () => {
    const unmapped = [...tokens.keys()].filter((name) => !(name in MAP));
    expect(unmapped).toEqual([]);
  });

  it.each(Object.entries(MAP))('%s has the same value as %s', (token, variable) => {
    const expected = tokens.get(token);
    expect(expected, `${token} in design/tokens.css`).toBeDefined();
    const actual = app.get(variable);
    expect(actual, `${variable} in web/app/globals.css`).toBeDefined();
    const want = token.startsWith('--wc-font-') ? fontFamiliesAsInApp(expected!) : expected!;
    expect(normalize(actual!)).toBe(normalize(want));
  });
});
