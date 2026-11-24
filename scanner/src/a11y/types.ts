/**
 * Accessibility part of the capture (session A3): what axe-core found on the page.
 *
 * The capture adapter injects a pinned axe-core into the top-level document after the network
 * is quiet and runs only the rules below. The page itself compacts the result (counts and at
 * most `AXE_MAX_EXAMPLES` examples per rule), so little data crosses the browser protocol.
 */

/** The seven axe rules of the brief, for the six error types (page language has two rules). */
export const AXE_RULES = ['color-contrast', 'image-alt', 'label', 'link-name', 'button-name', 'html-has-lang', 'html-lang-valid'] as const;

export type AxeRuleId = (typeof AXE_RULES)[number];

/** The pinned axe-core version (scanner/package.json, worker/package.json). */
export const AXE_VERSION = '4.14.1';

/** Examples per rule and result group. */
export const AXE_MAX_EXAMPLES = 5;

/** Length of an example's HTML snippet. */
export const AXE_HTML_MAX = 200;

/** Contrast values of one element, from axe's `color-contrast` check. */
export interface AxeContrast {
  /** Contrast ratio, as axe reports it (two decimals, rounded down); null when axe could not compute it. */
  ratio: number | null;
  /** Required ratio, for example `4.5:1` or `3:1` for large text. */
  expected: string | null;
  fgColor: string | null;
  bgColor: string | null;
  /** For example `12.0pt (16px)`. */
  fontSize: string | null;
  fontWeight: string | null;
  /** Why axe could not decide (incomplete results), for example `bgImage`. */
  messageKey: string | null;
}

export interface AxeExample {
  /** CSS selector path: one entry per document or open shadow root, from the top. */
  target: string[];
  /** Start of the element's HTML, at most `AXE_HTML_MAX` characters. */
  html: string;
  /** Only for `color-contrast`. */
  contrast: AxeContrast | null;
  /**
   * Session fix-a6 ("Feld B2"): the field of the element on the plan of the homepage, a 4 × 3 grid over the whole
   * page (columns A to D from the left, rows 1 to 3 from the top), by the centre of its box. Null or missing when
   * the element has no box (hidden, zero size) or the capture is older.
   */
  field?: string | null;
}

/**
 * Session fix-a6 ("Feld B2"): where the page shows elements that load a file from another host (image, iframe,
 * video, audio, embed, object; a script or stylesheet only when it has a box, which it normally does not). For
 * each such host (at most 60) the fields of its first five elements with a box, in document order.
 */
export interface AxePositions {
  hosts: Record<string, string[]>;
}

export interface AxeRuleResult {
  /** Elements that fail the rule. */
  violations: number;
  /** Elements axe could not decide ("bitte manuell prüfen"). */
  incomplete: number;
  /** Elements that pass the rule (for example images with a description). */
  passes: number;
  /** Highest impact among violations, or among incomplete results if there are no violations. */
  impact: string | null;
  examples: AxeExample[];
  incompleteExamples: AxeExample[];
}

export interface AxeScope {
  /** The document is a frameset. */
  frameset: boolean;
  /** Number of iframe and frame elements in the top-level document. */
  frames: number;
  /** Largest share of the window covered by one iframe (0 to 1, two decimals). */
  largestFrameShare: number;
}

export interface AxeImages {
  described: number;
  decorative: number;
}

export type AxeStatus =
  /** axe ran; `rules` holds every rule. */
  | 'ok'
  /** axe threw or could not be injected. */
  | 'error'
  /** axe did not finish in the time left for the page. */
  | 'timeout'
  /** Not run: no page, or no time left before the page's hard limit. */
  | 'skipped';

export interface AxeCapture {
  status: AxeStatus;
  /** Short error text for `error`, `timeout` and `skipped`. */
  error: string | null;
  /** Version reported by the injected axe-core. */
  axeVersion: string | null;
  /** Every rule of `AXE_RULES` when the status is `ok`, otherwise empty. */
  rules: Partial<Record<AxeRuleId, AxeRuleResult>>;
  /**
   * Rules that threw inside axe. axe then replaces the whole result of that rule with one
   * undecided node, so its counts say nothing about the page.
   */
  ruleErrors: string[];
  /**
   * What the top-level document holds besides its own content (read in the same call as axe):
   * a page whose content is in a frameset or in one large iframe was not really checked.
   * Missing in captures made before this field existed.
   */
  scope?: AxeScope | null;
  /**
   * Session fix-a2: the images that pass `image-alt`, split by why they pass. `described` have a text
   * alternative (alt text, aria-label, aria-labelledby, title); `decorative` are marked as decoration
   * (`alt=""`, `role="presentation"` or `role="none"`) and have none. Both add up to the passes of the rule.
   * Null or missing when the split is unknown (a capture made before this field existed).
   */
  images?: AxeImages | null;
  /** Session fix-a6 ("Feld B2"); missing in older captures. */
  positions?: AxePositions | null;
  /** Lowest contrast among the failing elements and among the passing ones. */
  lowestContrast: { violation: AxeContrast | null; pass: AxeContrast | null };
  timing: {
    /** Evaluating the axe-core source in the page, measured by the adapter. */
    injectMs: number | null;
    /** `axe.run` inside the page (performance.now). */
    runMs: number | null;
    /** Everything the adapter spent on axe, from the injection to the result. */
    totalMs: number;
  };
}
