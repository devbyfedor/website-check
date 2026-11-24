// What the scan screen (design/reference/pruefung.html) shows of one scan. Two sources feed it: the example of
// the reference (example-scan.ts, built for the checks only), with the times of its compressed run, and the real
// scan from the API (web/lib/scan-view.ts, session B2 part 2), with times of its own. Times are seconds after the
// element appeared (for the example: after the page appeared), as the reference writes its animation delays.

// The parts of the drawing a red mark can circle: the heading, the source code at the end of the page,
// the line under the heading.
export type MarkPlace = 'heading' | 'source' | 'subline';

export interface PlotMark {
  place: MarkPlace;
  /** The numbers of the priorities at this place, written beside the mark ("1", or "1, 2" when two share it). */
  numbers: readonly number[];
  draw: { delay: number; duration: number }; // the red outline
  numberDelay: number; // the number beside it
}

/**
 * A text of the screen. A plain string is our own text; in a list, `{ page }` is a string that came from the scanned
 * site or the visitor (docs/report-schema.md, "Strings of the scanned page"): shown as a text node of its own in
 * <bdi>, never as markup.
 */
export type Phrase = string | readonly (string | { page: string })[];

export interface ScanStep {
  title: Phrase;
  detail?: Phrase;
  finding?: boolean; // red, with "!" instead of a tick
  /** The row lights up after this many seconds (its tick 0.05 s later); null: the row waits for the report. */
  delay: number | null;
}

export type ScanProgress =
  // The example: the bar grows over the whole compressed run, as in the reference.
  | { kind: 'timed'; delay: number; duration: number }
  // The real scan (session B2 part 2): empty while the scan waits; from the start of the scan it grows in real
  // time over the 30 s of the scale and stops short of the end; full once the report is there. `since` is how
  // long the scan had run when the bar started to grow, fixed for the life of the bar.
  | { kind: 'live'; phase: 'waiting' | 'running' | 'done'; since: number };

export interface ScanScreenData {
  /** The address being measured; null until the API has named it. */
  domain: string | null;
  /** True for an address from the API: shown in <bdi>. */
  domainFromApi?: boolean;
  drawingLabel: string; // the text description of the drawing (its aria-label)
  /** 1 for the example; below 1 the drawing, the pen and the carriage run faster (all within 5 s, session B2 part 2). */
  motionScale?: number;
  marks: PlotMark[];
  steps: ScanStep[];
  progress: ScanProgress;
  report: { summary: Phrase; href: string; delay: number } | null; // "Bericht öffnen" once the report is ready
  /** The real scan only: the status line (role="status"); undefined on the example page, which has none. */
  status?: string;
}

// A time in seconds as a CSS time value, without the rounding noise of sums such as 0.4 + 0.05.
export const seconds = (s: number): string => `${Number(s.toFixed(3))}s`;
