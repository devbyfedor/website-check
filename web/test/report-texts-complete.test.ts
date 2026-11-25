import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@website-check/scanner';
import { PRIORITY_TEXT_IDS, REPORT_TEXT_IDS, type Finding, type Report, type TextId } from '@website-check/scanner/report';
import exampleJson from '../components/report/example-report.json';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states';
import { FIX_SYSTEMS, FIX_TEXTS, HEADER_STEPS } from '../lib/report-detail-texts';
import { findingCards } from '../lib/report-detail-view';

// Session texts-fix (Fedor): every text id the report builder can give has a text, no text holds a forbidden word of the
// brief, and every step by system names its source in docs/content-drafts.md.

const ROOT = join(import.meta.dirname, '..', '..');
const DRAFTS = readFileSync(join(ROOT, 'docs', 'content-drafts.md'), 'utf8');
const EXAMPLE = exampleJson as unknown as Report;

/** The sections of docs/content-drafts.md: the ids in backticks of each `###` heading, and the text up to the next heading. */
function sections(md: string): { ids: string[]; body: string }[] {
  const out: { ids: string[]; body: string }[] = [];
  const parts = md.split(/^(?=#{2,3} )/m);
  for (const part of parts) {
    const [heading = '', ...rest] = part.split('\n');
    if (!heading.startsWith('### ')) continue;
    out.push({ ids: [...heading.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]!), body: rest.join('\n') });
  }
  return out;
}

describe('every text id of the report builder has a text', () => {
  const list = sections(DRAFTS);

  it.each([...REPORT_TEXT_IDS])('%s has a section in docs/content-drafts.md marked as a draft', (id) => {
    const s = list.find((x) => x.ids.includes(id));
    expect(s, `no section for ${id}`).toBeDefined();
    expect(s!.body).toContain('Status: Entwurf');
  });

  it('the list holds every text id of the example report and of every example state (findings, headers, notice)', () => {
    const reports = [EXAMPLE, ...EXAMPLE_REPORT_STATES.map((s) => s.show()).flatMap((x) => ('report' in x ? [x.report] : []))];
    const known = new Set<string>(REPORT_TEXT_IDS);
    const seen = new Set<string>();
    for (const r of reports) {
      for (const f of r.findings) seen.add(f.textId);
      for (const h of r.security?.headers ?? []) if (h.textId !== null) seen.add(h.textId);
      if (r.notice !== null) seen.add(r.notice.textId);
      // A finding with a risk can be among "Drei Dinge": its id is one of the ids with a card.
      for (const f of r.findings) if (f.risk !== null && !f.textId.startsWith('neu-')) expect(PRIORITY_TEXT_IDS as readonly string[]).toContain(f.textId);
    }
    // The state "fund-ohne-anleitung" shows a report with ids the page does not know (a newer scanner); it is left out.
    const unknown = [...seen].filter((id) => !known.has(id) && !id.startsWith('neu-'));
    expect(unknown).toEqual([]);
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });
});

/** A report with one priority: the first finding of the example, given the text id and the values of a finding of that kind. */
function withPriority(textId: TextId, fixTextId: string | null = null): Report {
  const r = structuredClone(EXAMPLE);
  const f = r.findings.find((x) => x.id === r.priorities[0])!;
  const third = textId.startsWith('third-party-');
  Object.assign(f, {
    textId,
    fixTextId: third ? fixTextId : null,
    area: third ? 'privacy' : textId.startsWith('a11y-') ? 'accessibility' : textId.startsWith('legal-') ? 'mandatory-information' : 'security',
    serviceKey: third ? f.serviceKey : null,
    params: third
      ? { service: 'Beispieldienst', provider: 'Beispielanbieter', category: 'analytics', count: 2, firstStartMs: 300, beforeBanner: true }
      : { count: 3, ratio: 2.9, expected: '4.5:1', value: 'de_DE', present: 2, total: 5 },
  } satisfies Partial<Finding>);
  r.priorities = [f.id];
  return r;
}

describe('every finding that can be among "Drei Dinge" has a whole card', () => {
  it.each([...PRIORITY_TEXT_IDS])('%s: "Was passiert", "Warum das wichtig ist" and steps', (id) => {
    const card = findingCards(withPriority(id, 'fix-hotjar'))[0]!;
    expect(card.happens).not.toBeNull();
    expect(card.why).not.toBeNull();
    expect(card.fix.kind).not.toBe('missing');
    const steps = card.fix.kind === 'general' ? card.fix.steps : card.fix.kind === 'systems' ? card.fix.general : null;
    expect(steps?.length ?? 0).toBeGreaterThan(0);
  });

  it('every known service of a class with a risk has steps: its own, or those of its class', () => {
    const risky = DEFAULT_RULES.services.filter((s) => ['precedent', 'consent-required', 'usually-consent'].includes(s.riskClass));
    expect(risky.length).toBeGreaterThanOrEqual(30);
    for (const s of risky) {
      const card = findingCards(withPriority(`third-party-${s.riskClass}` as TextId, `fix-${s.id}`))[0]!;
      expect(card.fix.kind, s.id).not.toBe('missing');
      if (card.fix.kind === 'systems') for (const system of FIX_SYSTEMS) expect(card.fix.steps[system] ?? card.fix.general, `${s.id} ${system}`).not.toBeNull();
    }
  });

  it('the card of the security headers has one step for every header that does not count', () => {
    const r = withPriority('security-headers');
    const open = r.security!.headers.filter((h) => !h.counts && h.textId !== null);
    expect(open.length).toBeGreaterThan(0);
    const card = findingCards(r)[0]!;
    expect(card.fix.kind).toBe('general');
    const steps = card.fix.kind === 'general' ? card.fix.steps : [];
    expect(steps.length).toBe(open.length + 2);
    for (const id of REPORT_TEXT_IDS.filter((x) => x.startsWith('security-header-'))) expect(HEADER_STEPS[id], id).toBeDefined();
  });
});

// Product rule 4 of the brief.
const FORBIDDEN = ['Sie verstoßen gegen', 'illegal', 'rechtswidrig', 'Abmahngefahr', 'abmahnsicher', 'rechtssicher', 'garantiert', 'DSGVO-konform'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx|json|md)$/.test(name) ? [path] : [];
  });
}

describe('no text holds a forbidden word of the brief', () => {
  const sources = [join(ROOT, 'docs', 'content-drafts.md'), ...files(join(ROOT, 'web', 'lib')), ...files(join(ROOT, 'web', 'components')), ...files(join(ROOT, 'web', 'app')), ...files(join(ROOT, 'scanner', 'data'))];

  it('the texts of the site, the drafts and the rules data', () => {
    expect(sources.length).toBeGreaterThan(30);
    const hits: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, 'utf8').toLowerCase();
      for (const word of FORBIDDEN) if (text.includes(word.toLowerCase())) hits.push(`${path}: ${word}`);
    }
    expect(hits).toEqual([]);
  });

  it('the check finds a forbidden word', () => {
    expect(FORBIDDEN.some((w) => 'Das ist rechtssicher.'.toLowerCase().includes(w.toLowerCase()))).toBe(true);
  });
});

describe('every step by system names its source', () => {
  it('each step of FIX_TEXTS stands in docs/content-drafts.md with a link on its line', () => {
    const lines = DRAFTS.split('\n');
    for (const [fix, bySystem] of Object.entries(FIX_TEXTS)) {
      for (const [system, steps] of Object.entries(bySystem)) {
        for (const step of steps ?? []) {
          // A new scan claims nothing (the reference's WordPress step adds only what the new scan should show).
          if (step.startsWith('Starten Sie eine neue Prüfung.')) continue;
          // Session B5 part 2 (Fedor): the WordPress steps of the reference have official sources too, so every step needs a link.
          const source = /Quelle: https:\/\/\S+/;
          expect(lines.some((l) => l.includes(step)), `${fix} ${system}: "${step}" not in docs/content-drafts.md`).toBe(true);
          expect(lines.some((l) => l.includes(step) && source.test(l)), `${fix} ${system}: no source next to "${step}"`).toBe(true);
        }
      }
    }
  });
});
