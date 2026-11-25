import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BfsgScreen } from '../components/bfsg/bfsg-screen';
import { answerBfsg, BFSG_START, BFSG_VERDICTS, bfsgView, resetBfsg, type Answer, type BfsgState, type QuestionNumber } from '../lib/bfsg-view';

// The BFSG decision scheme (brief, B5: unit tests for all four paths and the reset). The logic is compared with the
// reference's own script for every combination of answers, the page with the reference's texts and states.

const ROOT = join(import.meta.dirname, '..', '..');
const reference = readFileSync(join(ROOT, 'design', 'reference', 'bfsg.html'), 'utf8');

const press = (state: BfsgState, ...steps: [QuestionNumber, 'ja' | 'nein'][]): BfsgState => steps.reduce((s, [q, a]) => answerBfsg(s, q, a), state);

describe('the four paths and the reset', () => {
  it('starts with question 1 to answer, the others dimmed and disabled, no exit and "Noch keine Antwort."', () => {
    const v = bfsgView(BFSG_START);
    expect(v.cards).toEqual(['cur', 'off', 'off']);
    expect(v.reachable).toEqual([true, false, false]);
    expect(v.exits).toEqual([false, false, false, false]);
    expect(v.across).toEqual([false, false, false]);
    expect(v.down).toEqual([false, false, false]);
    expect(v.verdict).toBe('Noch keine Antwort.');
  });

  it('path 1: no sale to consumers ends at "Gilt in der Regel nicht"', () => {
    const v = bfsgView(press(BFSG_START, [1, 'nein']));
    expect(v.exits).toEqual([true, false, false, false]);
    expect(v.across).toEqual([true, false, false]);
    expect(v.down).toEqual([false, false, false]);
    expect(v.cards).toEqual(['done', 'off', 'off']);
    expect(v.reachable).toEqual([true, false, false]);
    expect(v.verdict).toBe('Ergebnis: Das BFSG gilt für Ihre Website in der Regel nicht.');
  });

  it('path 2: consumers and 10 or more employees: the BFSG applies', () => {
    const v = bfsgView(press(BFSG_START, [1, 'ja'], [2, 'ja']));
    expect(v.exits).toEqual([false, true, false, false]);
    expect(v.across).toEqual([false, true, false]);
    expect(v.down).toEqual([true, false, false]);
    expect(v.cards).toEqual(['done', 'done', 'off']);
    expect(v.reachable).toEqual([true, true, false]);
    expect(v.verdict).toBe('Ergebnis: Das BFSG gilt für Sie.');
  });

  it('path 3: fewer than 10 employees, turnover and balance sheet both over 2 million: the BFSG applies', () => {
    const v = bfsgView(press(BFSG_START, [1, 'ja'], [2, 'nein'], [3, 'ja']));
    expect(v.exits).toEqual([false, false, true, false]);
    expect(v.across).toEqual([false, false, true]);
    expect(v.down).toEqual([true, true, false]);
    expect(v.cards).toEqual(['done', 'done', 'done']);
    expect(v.reachable).toEqual([true, true, true]);
    expect(v.verdict).toBe('Ergebnis: Das BFSG gilt für Sie.');
  });

  it('path 4: a micro-enterprise is exempt', () => {
    const v = bfsgView(press(BFSG_START, [1, 'ja'], [2, 'nein'], [3, 'nein']));
    expect(v.exits).toEqual([false, false, false, true]);
    expect(v.across).toEqual([false, false, false]);
    expect(v.down).toEqual([true, true, true]);
    expect(v.cards).toEqual(['done', 'done', 'done']);
    expect(v.verdict).toBe('Ergebnis: Sie sind als Kleinstunternehmen ausgenommen.');
  });

  it('the paths in between: question 2 or 3 opened but not answered yet', () => {
    expect(bfsgView(press(BFSG_START, [1, 'ja'])).cards).toEqual(['done', 'cur', 'off']);
    expect(bfsgView(press(BFSG_START, [1, 'ja'])).verdict).toBe(BFSG_VERDICTS.none);
    expect(bfsgView(press(BFSG_START, [1, 'ja'], [2, 'nein'])).cards).toEqual(['done', 'done', 'cur']);
    expect(bfsgView(press(BFSG_START, [1, 'ja'], [2, 'nein'])).verdict).toBe(BFSG_VERDICTS.none);
  });

  it('"Neu beginnen" goes back to the start from every path', () => {
    for (const path of [[[1, 'nein']], [[1, 'ja'], [2, 'ja']], [[1, 'ja'], [2, 'nein'], [3, 'ja']], [[1, 'ja'], [2, 'nein'], [3, 'nein']]] as [QuestionNumber, 'ja' | 'nein'][][]) {
      const reached = press(BFSG_START, ...path);
      expect(reached).not.toEqual(BFSG_START);
      expect(resetBfsg()).toEqual(BFSG_START);
      expect(bfsgView(resetBfsg())).toEqual(bfsgView(BFSG_START));
    }
    // A new object each time, so that the start state can never be changed through it.
    expect(resetBfsg()).not.toBe(BFSG_START);
  });

  it('an answer clears every answer below it, as in the reference', () => {
    expect(press(BFSG_START, [1, 'ja'], [2, 'nein'], [3, 'ja'], [1, 'nein'])).toEqual({ q1: 'nein', q2: '', q3: '' });
    expect(press(BFSG_START, [1, 'ja'], [2, 'nein'], [3, 'ja'], [2, 'ja'])).toEqual({ q1: 'ja', q2: 'ja', q3: '' });
    expect(press(BFSG_START, [1, 'ja'], [2, 'nein'], [3, 'ja'], [3, 'nein'])).toEqual({ q1: 'ja', q2: 'nein', q3: 'nein' });
  });

  it('an answer to a question that cannot be reached changes nothing', () => {
    expect(press(BFSG_START, [2, 'ja'])).toEqual(BFSG_START);
    expect(press(BFSG_START, [3, 'nein'])).toEqual(BFSG_START);
    expect(press(BFSG_START, [1, 'nein'], [2, 'ja'])).toEqual({ q1: 'nein', q2: '', q3: '' });
    expect(press(BFSG_START, [1, 'ja'], [2, 'ja'], [3, 'nein'])).toEqual({ q1: 'ja', q2: 'ja', q3: '' });
  });
});

// The reference's `renderVals` (design/reference/bfsg.html), taken from the file and run with a state.
function referenceVals(state: BfsgState): Record<string, unknown> {
  const body = /renderVals\(\) \{([\s\S]*?)\n {4}return \{/.exec(reference)?.[1];
  const values = /\n {4}return (\{[\s\S]*?\n {4}\});/.exec(reference)?.[1];
  if (!body || !values) throw new Error('renderVals not found in bfsg.html');
  // Only the values, not the click handlers: the handlers name `this.setState`, which is not called here.
  return new Function('state', `const self = { state }; return (function () {${body}\n return ${values}; }).call(self);`)(state) as Record<string, unknown>;
}

describe('the logic is the reference script', () => {
  const answers: Answer[] = ['', 'ja', 'nein'];
  const states: BfsgState[] = answers.flatMap((q1) => answers.flatMap((q2) => answers.map((q3) => ({ q1, q2, q3 }))));

  it.each(states.map((s) => [`${s.q1 || '-'} ${s.q2 || '-'} ${s.q3 || '-'}`, s] as const))('answers %s', (_name, state) => {
    const r = referenceVals(state);
    const v = bfsgView(state);
    const cls = (c: string) => c.split(' ').slice(1).join(' ');
    expect(v.cards).toEqual([cls(r.c1 as string), cls(r.c2 as string), cls(r.c3 as string)]);
    expect(v.exits).toEqual([r.x1, r.x2, r.x3, r.x4].map((c) => c === 'ex hit'));
    expect(v.across).toEqual([r.h1, r.h2, r.h3].map((c) => c === 'hline on'));
    expect(v.down).toEqual([r.v12, r.v23, r.v34].map((c) => c === 'vline on'));
    expect(v.reachable).toEqual([true, !r.d2, !r.d3]);
    expect(v.verdict).toBe(r.verdict);
  });

  it('the answers clear the same answers as the reference handlers', () => {
    // a1y and a1n clear q2 and q3, a2y and a2n clear q3, a3y and a3n nothing; reset clears all three.
    expect(reference).toContain("a1y: () => this.setState({ q1: 'ja', q2: '', q3: '' })");
    expect(reference).toContain("a1n: () => this.setState({ q1: 'nein', q2: '', q3: '' })");
    expect(reference).toContain("a2y: () => this.setState({ q2: 'ja', q3: '' })");
    expect(reference).toContain("a2n: () => this.setState({ q2: 'nein', q3: '' })");
    expect(reference).toContain("a3y: () => this.setState({ q3: 'ja' })");
    expect(reference).toContain("a3n: () => this.setState({ q3: 'nein' })");
    expect(reference).toContain("reset: () => this.setState({ q1: '', q2: '', q3: '' })");
  });
});

// Review of B5 part 1: the markup of every state, element by element, against the reference's script. The reference
// marks each element it changes with `data-dc-class` (c1, y1, n1, h1, x1, v12, …); in the unit tests the CSS modules
// give the plain class names, so each element of the app carries the class string the reference's script would set.
describe('the markup of every state is the reference script', () => {
  const keys = [...reference.matchAll(/data-dc-class="(\w+)"/g)].map((m) => m[1]!);
  const answers: Answer[] = ['', 'ja', 'nein'];
  const states: BfsgState[] = answers.flatMap((q1) => answers.flatMap((q2) => answers.map((q3) => ({ q1, q2, q3 }))));

  it('the reference marks 19 elements of the scheme', () => {
    expect(keys).toEqual(['c1', 'y1', 'n1', 'h1', 'x1', 'v12', 'c2', 'y2', 'n2', 'h2', 'x2', 'v23', 'c3', 'y3', 'n3', 'h3', 'x3', 'v34', 'x4']);
  });

  it.each(states.map((s) => [`${s.q1 || '-'} ${s.q2 || '-'} ${s.q3 || '-'}`, s] as const))('answers %s', (_name, state) => {
    const r = referenceVals(state);
    const html = renderToStaticMarkup(<BfsgScreen initial={state} />);
    // Cards, buttons, arrows and exits in the order of the page, with their classes (the CSS modules of the unit tests
    // name a class "_yn_f77ee0"; its name is "yn").
    const plain = html.replace(/class="([^"]*)"/g, (_m, c: string) => `class="${c.replace(/_([a-z]+)_[0-9a-f]+/g, '$1')}"`);
    const classes = [...plain.matchAll(/class="((?:qc|yn|hline|ex|vline)(?: [a-z]+)?)"/g)].map((m) => m[1]);
    expect(classes).toEqual(keys.map((k) => r[k]));
    const buttons = [...plain.matchAll(/<button type="button" class="yn(?: sel)?" aria-pressed="(true|false)"( disabled="")?/g)].map((m) => [m[1] === 'true', m[2] !== undefined]);
    expect(buttons).toEqual([
      [r.y1p, false],
      [r.n1p, false],
      [r.y2p, r.d2],
      [r.n2p, r.d2],
      [r.y3p, r.d3],
      [r.n3p, r.d3],
    ]);
  });
});

// The text of the page between the header and the end of the footer, without tags and white space.
const text = (html: string): string =>
  html
    .slice(html.indexOf('<main'), html.lastIndexOf('</footer>'))
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, '');

describe('the page', () => {
  const page = (state: BfsgState = BFSG_START): string => renderToStaticMarkup(<BfsgScreen initial={state} />);

  it('has every text of the reference in its order', () => {
    expect(text(page())).toBe(text(reference));
  });

  it('marks the BFSG link of the header as the current page', () => {
    const html = page();
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(nav).toMatch(/<a href="\/bfsg" class="[^"]+" aria-current="page">BFSG-Check<\/a>/);
    expect((nav.match(/aria-current/g) ?? []).length).toBe(1);
    expect(nav).toContain('So prüfen wir');
    expect(nav).toContain('Für Agenturen');
  });

  it('draws the start: the buttons of questions 2 and 3 disabled, none pressed, the verdict in a live region', () => {
    const html = page();
    expect((html.match(/<button type="button"[^>]*aria-pressed="false"[^>]*>/g) ?? []).length).toBe(6);
    expect((html.match(/aria-pressed="false" disabled=""/g) ?? []).length).toBe(4);
    expect(html).toContain('<p aria-live="polite" class="m-0 font-head text-[21px] font-semibold">Noch keine Antwort.</p>');
    expect(html).toContain('>Neu beginnen</button>');
    expect(html).toContain('<a class="');
    expect(html).toMatch(/<a class="[^"]+" href="\/">Website prüfen<\/a>/);
  });

  it.each([
    ['path 1', [[1, 'nein']], 'Ergebnis: Das BFSG gilt für Ihre Website in der Regel nicht.', 'Gilt in der Regel nicht', 4],
    ['path 2', [[1, 'ja'], [2, 'ja']], 'Ergebnis: Das BFSG gilt für Sie.', 'Ihr Online-Angebot muss seit dem 28. Juni 2025 barrierefrei sein.', 2],
    ['path 3', [[1, 'ja'], [2, 'nein'], [3, 'ja']], 'Ergebnis: Das BFSG gilt für Sie.', 'Sie liegen über beiden Schwellen für Kleinstunternehmen.', 0],
    ['path 4', [[1, 'ja'], [2, 'nein'], [3, 'nein']], 'Ergebnis: Sie sind als Kleinstunternehmen ausgenommen.', 'Sie sind ausgenommen', 0],
  ] as [string, [QuestionNumber, 'ja' | 'nein'][], string, string, number][])('draws %s: the pressed buttons, the filled exit and the verdict', (_name, path, verdict, exitText, disabled) => {
    const html = page(press(BFSG_START, ...path));
    expect(html).toContain(`>${verdict}</p>`);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(path.length);
    expect((html.match(/ disabled=""/g) ?? []).length).toBe(disabled);
    // Exactly one exit is filled: a box with two class names (ex and hit), and it holds the text of this path.
    const hits = [...html.matchAll(/<div class="[^" ]+ [^" ]+"><h3[^>]*>([^<]*)<\/h3><p[^>]*>([^<]*)<\/p><\/div>/g)];
    expect(hits).toHaveLength(1);
    expect(hits[0]![1] + ' ' + hits[0]![2]).toContain(exitText);
  });
});
