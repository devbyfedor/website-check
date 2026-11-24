import { CAPTURE_LIMITS, limitAxe } from '../capture/limits.ts';
import { AXE_HTML_MAX, AXE_MAX_EXAMPLES, AXE_RULES, type AxeCapture, type AxeContrast, type AxeExample, type AxeImages, type AxeRuleId, type AxeRuleResult, type AxeScope, type AxeStatus } from './types.ts';

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
 * Session fix-a2: an image passes `image-alt` with a text alternative, but also with `alt=""` or
 * `role="presentation"`, which say "decoration" and give no description. The reporter counts the two
 * kinds apart (`images`), from axe's own check `presentational-role` (the role axe computed, with an
 * empty alt as the implicit presentation role) and the alt attribute itself, so "Bilder mit Beschreibung"
 * counts only described images.
 *
 * Session fix-a4: the page controls what axe returns (selectors of its elements, or a `window.axe` of its
 * own), so the expression copies only the known fields into its answer, each through a guard that uses
 * nothing but `typeof` and the length of a primitive string, with counted loops for the lists.
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
    return Object.assign({ status: 'error', error: 'axe-core is not available in the page', axeVersion: axe && typeof axe.version === 'string' && axe.version.length <= 40 ? axe.version : null, runMs: null }, empty);
  }
  // Frames are not checked (iframes: false); a page whose content sits in a frameset or in one
  // large iframe must not look clean, so the analyzer needs to know.
  const scope = (() => {
    try {
      const frames = Array.from(document.querySelectorAll('iframe, frame'));
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      let largest = 0;
      for (const f of frames) {
        const r = f.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        largest = Math.max(largest, (w * h) / (vw * vh));
      }
      return { frameset: !!document.querySelector('frameset'), frames: frames.length, largestFrameShare: Math.round(largest * 100) / 100 };
    } catch (e) { return null; }
  })();
  const SHORT = ${CAPTURE_LIMITS.shortText};
  const TARGET_MAX = ${CAPTURE_LIMITS.axeTargetLength};
  const TARGET_PARTS = ${CAPTURE_LIMITS.axeTargetParts};
  const S = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  const cut = (v, max) => { if (typeof v !== 'string') return ''; if (v.length <= max) return v; let c = ''; try { c = v.slice(0, max); } catch (e) { c = ''; } return S(c, max); };
  const str = (v) => (typeof v === 'string' && v.length <= SHORT ? v : null);
  const num = (v) => (typeof v === 'number' && v === v ? v : 0);
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
        for (const s of Array.isArray(part) ? part : [part]) if (typeof s === 'string' && target.length < TARGET_PARTS) target[target.length] = cut(s, TARGET_MAX);
      }
    } catch (e) { target = []; }
    const source = typeof node.source === 'string' ? node.source : '';
    return { target, html: cut(source, HTML_MAX), contrast: withContrast ? contrastOf(nodeResult) : null };
  };
  const lower = (a, b) => (b && typeof b.ratio === 'number' && (!a || b.ratio < a.ratio) ? b : a);
  // Why an image passes image-alt: 'decorative' when axe's check for a presentation role holds (alt="",
  // role=presentation or none), 'described' when another check gave it a name; null when neither is known.
  // For a passing element axe lists only the checks that hold (without a result field).
  // axe's check has-alt holds for any alt attribute, an empty one too: such an image is marked as decoration
  // even where axe does not give it the presentation role (a focusable image, one with a global ARIA
  // attribute), so the attribute itself is read from the element.
  const imageKindOf = (nodeResult) => {
    const checks = [].concat(nodeResult.any || []);
    const held = (id) => checks.some((c) => c && c.id === id && c.result !== false);
    if (held('presentational-role')) return 'decorative';
    if (held('aria-label') || held('aria-labelledby') || held('non-empty-title')) return 'described';
    if (!held('has-alt')) return null;
    let alt = null;
    try {
      const element = nodeResult.node && nodeResult.node.element;
      alt = element && typeof element.getAttribute === 'function' ? element.getAttribute('alt') : null;
    } catch (e) { alt = null; }
    if (typeof alt !== 'string') return null;
    return alt.trim() === '' ? 'decorative' : 'described';
  };
  axe.addReporter('${AXE_REPORTER}', (raw, options, callback) => {
    const grouped = axe.utils.aggregateResult(raw);
    const ruleOf = (group, id) => (grouped[group] || []).find((r) => r && r.id === id) || null;
    const nodesOf = (group, id) => { const r = ruleOf(group, id); return r && Array.isArray(r.nodes) ? r.nodes : []; };
    const rules = {};
    let lowViolation = null;
    let lowPass = null;
    let images = { described: 0, decorative: 0 };
    for (const id of RULES) {
      const violations = nodesOf('violations', id);
      const incomplete = nodesOf('incomplete', id);
      const passes = nodesOf('passes', id);
      const isContrast = id === 'color-contrast';
      if (isContrast) {
        for (const n of violations) lowViolation = lower(lowViolation, contrastOf(n));
        for (const n of passes) lowPass = lower(lowPass, contrastOf(n));
      }
      if (id === 'image-alt') {
        for (const n of passes) {
          const kind = imageKindOf(n);
          if (kind === null || images === null) images = null;
          else images[kind] += 1;
        }
      }
      const v = ruleOf('violations', id);
      const i = ruleOf('incomplete', id);
      rules[id] = {
        violations: violations.length, incomplete: incomplete.length, passes: passes.length,
        impact: str((v && v.impact) || (i && i.impact) || null),
        examples: violations.slice(0, MAX).map((n) => exampleOf(n, isContrast)),
        incompleteExamples: incomplete.slice(0, MAX).map((n) => exampleOf(n, isContrast)),
      };
    }
    const ruleErrors = [];
    for (let k = 0; Array.isArray(raw) && k < raw.length && ruleErrors.length < 20; k += 1) { const r = raw[k]; if (r && r.error) ruleErrors[ruleErrors.length] = cut(String(r.id), SHORT); }
    callback({ rules, ruleErrors, images, lowestContrast: { violation: lowViolation, pass: lowPass } });
  });
  // What goes back to the scanner: the known fields of the result and nothing else, each within its limit.
  const tidyContrast = (c) => (c && typeof c === 'object'
    ? { ratio: typeof c.ratio === 'number' && c.ratio === c.ratio ? c.ratio : null, expected: str(c.expected), fgColor: str(c.fgColor), bgColor: str(c.bgColor), fontSize: str(c.fontSize), fontWeight: str(c.fontWeight), messageKey: str(c.messageKey) }
    : null);
  const tidyExamples = (list) => {
    const out = [];
    for (let k = 0; list && typeof list === 'object' && k < list.length && k < MAX; k += 1) {
      const e = list[k] || {};
      const target = [];
      for (let t = 0; e.target && typeof e.target === 'object' && t < e.target.length && t < TARGET_PARTS; t += 1) target[target.length] = cut(e.target[t], TARGET_MAX);
      out[out.length] = { target: target, html: cut(e.html, HTML_MAX), contrast: tidyContrast(e.contrast) };
    }
    return out;
  };
  const tidy = (result) => {
    const r = result && typeof result === 'object' ? result : {};
    const rules = {};
    for (let k = 0; k < RULES.length; k += 1) {
      const rule = r.rules && typeof r.rules === 'object' ? r.rules[RULES[k]] : null;
      if (!rule || typeof rule !== 'object') continue;
      rules[RULES[k]] = { violations: num(rule.violations), incomplete: num(rule.incomplete), passes: num(rule.passes), impact: str(rule.impact), examples: tidyExamples(rule.examples), incompleteExamples: tidyExamples(rule.incompleteExamples) };
    }
    const ruleErrors = [];
    for (let k = 0; r.ruleErrors && typeof r.ruleErrors === 'object' && k < r.ruleErrors.length && k < 20; k += 1) ruleErrors[ruleErrors.length] = cut(r.ruleErrors[k], SHORT);
    const images = r.images && typeof r.images === 'object' ? { described: num(r.images.described), decorative: num(r.images.decorative) } : null;
    const low = r.lowestContrast && typeof r.lowestContrast === 'object' ? r.lowestContrast : {};
    return { rules: rules, ruleErrors: ruleErrors, images: images, lowestContrast: { violation: tidyContrast(low.violation), pass: tidyContrast(low.pass) } };
  };
  const version = () => { let v = null; try { v = axe.version; } catch (e) { v = null; } return str(v); };
  try {
    const result = tidy(await axe.run(document, { runOnly: { type: 'rule', values: RULES }, iframes: false, preload: false, reporter: '${AXE_REPORTER}' }));
    return { status: 'ok', error: null, axeVersion: version(), rules: result.rules, ruleErrors: result.ruleErrors, images: result.images, lowestContrast: result.lowestContrast, scope: scope, runMs: Math.round(performance.now() - started) };
  } catch (e) {
    return { status: 'error', error: cut(String((e && e.message) || e), 300), axeVersion: version(), runMs: Math.round(performance.now() - started), rules: {}, ruleErrors: [], lowestContrast: { violation: null, pass: null } };
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
  images?: unknown;
  scope?: unknown;
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

/** The split of the passing images, only when it is two counts that add up to the passes of `image-alt`. */
function imagesOf(value: unknown, passes: number): AxeImages | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const described = v['described'];
  const decorative = v['decorative'];
  if (typeof described !== 'number' || typeof decorative !== 'number') return null;
  if (!Number.isInteger(described) || !Number.isInteger(decorative) || described < 0 || decorative < 0) return null;
  return described + decorative === passes ? { described, decorative } : null;
}

function scopeOf(value: unknown): AxeScope | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const share = typeof v['largestFrameShare'] === 'number' && Number.isFinite(v['largestFrameShare']) ? Math.min(1, Math.max(0, v['largestFrameShare'])) : 0;
  return { frameset: v['frameset'] === true, frames: count(v['frames']), largestFrameShare: share };
}

/** An axe result that did not run: no rules, no counts. */
export function axeNotRun(status: Exclude<AxeStatus, 'ok'>, error: string, timing: Partial<AxeCapture['timing']> = {}, axeVersion: string | null = null): AxeCapture {
  return {
    status,
    error: error.slice(0, 300),
    axeVersion: axeVersion === null ? null : axeVersion.slice(0, CAPTURE_LIMITS.shortText),
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
  // Session fix-a4: whatever the page returned, the capture keeps it only within the limits.
  return limitAxe({
    status: 'ok',
    error: null,
    axeVersion,
    rules,
    ruleErrors: Array.isArray(o.ruleErrors) ? o.ruleErrors.filter((r): r is string => typeof r === 'string') : [],
    images: imagesOf(o.images, rules['image-alt']?.passes ?? 0),
    lowestContrast: { violation: contrastOf(lowest.violation), pass: contrastOf(lowest.pass) },
    scope: scopeOf(o.scope),
    timing: { injectMs: timing.injectMs, runMs, totalMs: timing.totalMs },
  }) as AxeCapture;
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
