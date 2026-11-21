import { AXE_HTML_MAX, AXE_MAX_EXAMPLES, AXE_RULES, type AxeCapture, type AxeContrast, type AxeExample, type AxeRuleId, type AxeRuleResult, type AxeStatus } from './types.ts';

/**
 * JavaScript that capture adapters evaluate in the page after `axe.min.js` of the pinned
 * axe-core is injected. A plain string, so the local Playwright adapter and the Cloudflare
 * adapter run exactly the same code (a function's `toString()` would break in the Worker
 * bundle, which wraps nested functions with a helper that the page does not have).
 *
 * It runs `axe.run` on the top-level document with only the seven rules of the brief and
 * `iframes: false`: content of embedded third-party frames (maps, videos, captchas) is not the
 * site's own code. A custom reporter groups the raw results with axe's own
 * `axe.utils.aggregateResult` (the same grouping as the standard reporters) and keeps counts plus
 * at most `AXE_MAX_EXAMPLES` examples per rule. So axe never builds selectors for all passing
 * elements, and only a few kilobytes go back over the browser protocol.
 *
 * The page is only read: axe does not change the DOM, and with these rules it loads nothing
 * (`preload` is off and none of the seven rules preloads assets).
 */

/** Name of the reporter registered by `AXE_RUN_EXPRESSION`. */
export const AXE_REPORTER = 'website-check-compact';

/** Options of the run; the comparison with a standard run (`npm run scan:local -- --axe-reference`) uses the same rules and `iframes: false`. */
export const AXE_RUN_OPTIONS = {
  runOnly: { type: 'rule', values: [...AXE_RULES] },
  iframes: false,
  preload: false,
} as const;

export const AXE_RUN_EXPRESSION = `(async () => {
  const RULES = ${JSON.stringify(AXE_RULES)};
  const MAX = ${AXE_MAX_EXAMPLES};
  const HTML_MAX = ${AXE_HTML_MAX};
  const started = performance.now();
  const empty = { rules: {}, ruleErrors: [], lowestContrast: { violation: null, pass: null } };
  const axe = window.axe;
  if (!axe || typeof axe.run !== 'function' || !axe.utils || typeof axe.utils.aggregateResult !== 'function' || typeof axe.addReporter !== 'function') {
    return Object.assign({ status: 'error', error: 'axe-core is not available in the page', axeVersion: (axe && axe.version) || null, runMs: null }, empty);
  }
  const str = (v) => (typeof v === 'string' ? v : null);
  const contrastOf = (nodeResult) => {
    const checks = [].concat(nodeResult.any || [], nodeResult.all || [], nodeResult.none || []);
    for (const check of checks) {
      if (!check || check.id !== 'color-contrast' || !check.data || typeof check.data !== 'object') continue;
      const d = check.data;
      return {
        ratio: typeof d.contrastRatio === 'number' && d.contrastRatio > 0 ? d.contrastRatio : null,
        expected: str(d.expectedContrastRatio), fgColor: str(d.fgColor), bgColor: str(d.bgColor),
        fontSize: str(d.fontSize), fontWeight: str(d.fontWeight), messageKey: str(d.messageKey),
      };
    }
    return null;
  };
  const exampleOf = (nodeResult, withContrast) => {
    const node = nodeResult.node || {};
    let target = [];
    try {
      const selector = node.selector;
      for (const part of Array.isArray(selector) ? selector : [selector]) {
        for (const s of Array.isArray(part) ? part : [part]) if (typeof s === 'string') target.push(s);
      }
    } catch (e) { target = []; }
    const source = typeof node.source === 'string' ? node.source : '';
    return { target, html: source.length > HTML_MAX ? source.slice(0, HTML_MAX) : source, contrast: withContrast ? contrastOf(nodeResult) : null };
  };
  const lower = (a, b) => (b && typeof b.ratio === 'number' && (!a || b.ratio < a.ratio) ? b : a);
  axe.addReporter('${AXE_REPORTER}', (raw, options, callback) => {
    const grouped = axe.utils.aggregateResult(raw);
    const ruleOf = (group, id) => (grouped[group] || []).find((r) => r && r.id === id) || null;
    const nodesOf = (group, id) => { const r = ruleOf(group, id); return r && Array.isArray(r.nodes) ? r.nodes : []; };
    const rules = {};
    let lowViolation = null;
    let lowPass = null;
    for (const id of RULES) {
      const violations = nodesOf('violations', id);
      const incomplete = nodesOf('incomplete', id);
      const passes = nodesOf('passes', id);
      const isContrast = id === 'color-contrast';
      if (isContrast) {
        for (const n of violations) lowViolation = lower(lowViolation, contrastOf(n));
        for (const n of passes) lowPass = lower(lowPass, contrastOf(n));
      }
      const v = ruleOf('violations', id);
      const i = ruleOf('incomplete', id);
      rules[id] = {
        violations: violations.length, incomplete: incomplete.length, passes: passes.length,
        impact: (v && v.impact) || (i && i.impact) || null,
        examples: violations.slice(0, MAX).map((n) => exampleOf(n, isContrast)),
        incompleteExamples: incomplete.slice(0, MAX).map((n) => exampleOf(n, isContrast)),
      };
    }
    const ruleErrors = (Array.isArray(raw) ? raw : []).filter((r) => r && r.error).map((r) => String(r.id));
    callback({ rules, ruleErrors, lowestContrast: { violation: lowViolation, pass: lowPass } });
  });
  try {
    const result = await axe.run(document, { runOnly: { type: 'rule', values: RULES }, iframes: false, preload: false, reporter: '${AXE_REPORTER}' });
    return Object.assign({ status: 'ok', error: null, axeVersion: axe.version || null }, result, { runMs: Math.round(performance.now() - started) });
  } catch (e) {
    return Object.assign({ status: 'error', error: String((e && e.message) || e).slice(0, 300), axeVersion: axe.version || null, runMs: Math.round(performance.now() - started) }, empty);
  }
})()`;

/** What `AXE_RUN_EXPRESSION` returns (before validation). */
export interface AxeRunOutput {
  status: 'ok' | 'error';
  error: string | null;
  axeVersion: string | null;
  rules: Record<string, unknown>;
  ruleErrors: unknown[];
  lowestContrast: { violation: unknown; pass: unknown };
  runMs: number | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function contrastOf(value: unknown): AxeContrast | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return {
    ratio: typeof v['ratio'] === 'number' && Number.isFinite(v['ratio']) ? v['ratio'] : null,
    expected: text(v['expected']),
    fgColor: text(v['fgColor']),
    bgColor: text(v['bgColor']),
    fontSize: text(v['fontSize']),
    fontWeight: text(v['fontWeight']),
    messageKey: text(v['messageKey']),
  };
}

function examplesOf(value: unknown): AxeExample[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, AXE_MAX_EXAMPLES).map((item) => {
    const v = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const target = Array.isArray(v['target']) ? v['target'].filter((s): s is string => typeof s === 'string') : [];
    const html = text(v['html']) ?? '';
    return { target, html: html.slice(0, 200), contrast: contrastOf(v['contrast']) };
  });
}

function ruleOf(value: unknown): AxeRuleResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  return {
    violations: count(v['violations']),
    incomplete: count(v['incomplete']),
    passes: count(v['passes']),
    impact: text(v['impact']),
    examples: examplesOf(v['examples']),
    incompleteExamples: examplesOf(v['incompleteExamples']),
  };
}

/** An axe result that did not run: no rules, no counts. */
export function axeNotRun(status: Exclude<AxeStatus, 'ok'>, error: string, timing: Partial<AxeCapture['timing']> = {}, axeVersion: string | null = null): AxeCapture {
  return {
    status,
    error: error.slice(0, 300),
    axeVersion,
    rules: {},
    ruleErrors: [],
    lowestContrast: { violation: null, pass: null },
    timing: { injectMs: timing.injectMs ?? null, runMs: timing.runMs ?? null, totalMs: timing.totalMs ?? 0 },
  };
}

/**
 * Validates what the page returned and turns it into the capture's `axe` field. Anything that
 * does not look like a complete result (a page that replaced `window.axe`, a missing rule)
 * becomes `error`, so the report says "bitte manuell prüfen" instead of showing zero problems.
 */
export function axeCaptureFrom(output: unknown, timing: { injectMs: number | null; totalMs: number }): AxeCapture {
  if (typeof output !== 'object' || output === null) return axeNotRun('error', 'axe returned no result', timing);
  const o = output as Partial<AxeRunOutput>;
  const axeVersion = text(o.axeVersion);
  const runMs = typeof o.runMs === 'number' ? o.runMs : null;
  if (o.status !== 'ok') return axeNotRun('error', text(o.error) ?? 'axe failed', { ...timing, runMs }, axeVersion);
  const rules: Partial<Record<AxeRuleId, AxeRuleResult>> = {};
  const raw = (typeof o.rules === 'object' && o.rules !== null ? o.rules : {}) as Record<string, unknown>;
  for (const id of AXE_RULES) {
    const rule = ruleOf(raw[id]);
    if (rule === null) return axeNotRun('error', `axe result without rule ${id}`, { ...timing, runMs }, axeVersion);
    rules[id] = rule;
  }
  const lowest = (typeof o.lowestContrast === 'object' && o.lowestContrast !== null ? o.lowestContrast : { violation: null, pass: null }) as { violation?: unknown; pass?: unknown };
  return {
    status: 'ok',
    error: null,
    axeVersion,
    rules,
    ruleErrors: Array.isArray(o.ruleErrors) ? o.ruleErrors.filter((r): r is string => typeof r === 'string') : [],
    lowestContrast: { violation: contrastOf(lowest.violation), pass: contrastOf(lowest.pass) },
    timing: { injectMs: timing.injectMs, runMs, totalMs: timing.totalMs },
  };
}

/** Time left for axe before the page's hard limit, keeping a margin for closing the page. */
export const AXE_TIME = {
  /** Never wait longer than this for axe, even on a page that got quiet early. */
  maxMs: 8_000,
  /** Kept free before the hard limit for collecting the rest and closing the page. */
  marginMs: 1_000,
  /** Below this, axe is not started at all (`skipped`). */
  minMs: 1_500,
} as const;

/** Milliseconds axe may use, or 0 if it should be skipped. */
export function axeBudgetMs(elapsedMs: number, hardLimitMs: number): number {
  const left = Math.min(AXE_TIME.maxMs, hardLimitMs - elapsedMs - AXE_TIME.marginMs);
  return left >= AXE_TIME.minMs ? left : 0;
}
