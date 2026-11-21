import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from 'playwright';
import { AXE_RULES, type AxeCapture, type AxeRuleId } from '../a11y/types.ts';

/**
 * A separate, standard axe-core run for the comparison of session A3: the official Playwright
 * integration `@axe-core/playwright` with its own copy of axe-core (`axe.js` of the same pinned
 * version), the default v1 reporter, the same seven rules and `iframes: false`, on the same page
 * load as our run. Legacy mode is used because AxeBuilder's partial mode walks into iframes
 * without passing `iframes: false` on (`axe.utils.getFrameContexts(context)` without options);
 * legacy mode is a plain `axe.run(document, options)` in the top-level page.
 */

export interface ReferenceRule {
  violations: number;
  incomplete: number;
  passes: number;
  /** Selector paths of the first five violations, flattened like ours. */
  targets: string[][];
}

export interface ReferenceRun {
  axeVersion: string | null;
  ms: number;
  rules: Record<AxeRuleId, ReferenceRule> | null;
  error: string | null;
}

type V1Node = { target?: unknown[] };
type V1Rule = { id: string; nodes?: V1Node[] };

function flatten(target: unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const part of target ?? []) {
    for (const s of Array.isArray(part) ? part : [part]) if (typeof s === 'string') out.push(s);
  }
  return out;
}

export async function runReferenceAxe(page: Page): Promise<ReferenceRun> {
  const started = performance.now();
  try {
    const results = await new AxeBuilder({ page }).options({ iframes: false }).withRules([...AXE_RULES]).setLegacyMode(true).analyze();
    const of = (group: V1Rule[], id: string): V1Node[] => group.find((r) => r.id === id)?.nodes ?? [];
    const rules = Object.fromEntries(
      AXE_RULES.map((id) => {
        const violations = of(results.violations as V1Rule[], id);
        return [
          id,
          {
            violations: violations.length,
            incomplete: of(results.incomplete as V1Rule[], id).length,
            passes: of(results.passes as V1Rule[], id).length,
            targets: violations.slice(0, 5).map((n) => flatten(n.target)),
          },
        ];
      }),
    ) as Record<AxeRuleId, ReferenceRule>;
    return { axeVersion: results.testEngine?.version ?? null, ms: Math.round(performance.now() - started), rules, error: null };
  } catch (error) {
    return { axeVersion: null, ms: Math.round(performance.now() - started), rules: null, error: error instanceof Error ? error.message.split('\n')[0] ?? 'error' : String(error) };
  }
}

export interface AxeRuleComparison {
  rule: AxeRuleId;
  ours: number | null;
  reference: number | null;
  /** Our second run on the same page right after the reference (tells a changing page from a difference). */
  oursAgain: number | null;
  same: boolean;
  /** Incomplete counts, for information. */
  incomplete: { ours: number | null; reference: number | null };
  /** The first five violation selectors are the same. */
  sameExamples: boolean;
}

export interface AxeComparison {
  /** Every rule has the same number of violations in our run and in the reference run. */
  allSame: boolean;
  versions: { ours: string | null; reference: string | null };
  rules: AxeRuleComparison[];
}

export function compareAxeRuns(ours: AxeCapture | null, reference: ReferenceRun, oursAgain: AxeCapture | null): AxeComparison {
  const rules = AXE_RULES.map((rule): AxeRuleComparison => {
    const mine = ours?.status === 'ok' ? (ours.rules[rule] ?? null) : null;
    const theirs = reference.rules?.[rule] ?? null;
    const again = oursAgain?.status === 'ok' ? (oursAgain.rules[rule]?.violations ?? null) : null;
    const same = mine !== null && theirs !== null && mine.violations === theirs.violations;
    const sameExamples =
      mine !== null && theirs !== null && JSON.stringify(mine.examples.map((e) => e.target)) === JSON.stringify(theirs.targets);
    return {
      rule,
      ours: mine?.violations ?? null,
      reference: theirs?.violations ?? null,
      oursAgain: again,
      same,
      incomplete: { ours: mine?.incomplete ?? null, reference: theirs?.incomplete ?? null },
      sameExamples,
    };
  });
  return { allSame: rules.every((r) => r.same), versions: { ours: ours?.axeVersion ?? null, reference: reference.axeVersion }, rules };
}
