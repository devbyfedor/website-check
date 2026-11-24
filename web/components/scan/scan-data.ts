// What the scan screen (design/reference/pruefung.html) shows of one scan. In B2 part 1 the only source
// is the example of the reference (example-scan.ts, built for the checks only); in part 2 the API
// replaces it. Times are seconds after the page appeared, as the reference writes its animation delays.

// The parts of the drawing a red mark can circle: the heading, the source code at the end of the page,
// the line under the heading.
export type MarkPlace = 'heading' | 'source' | 'subline';

export interface PlotMark {
  place: MarkPlace;
  number: number;
  draw: { delay: number; duration: number }; // the red outline
  numberDelay: number; // the number beside it
}

export interface ScanStep {
  title: string;
  detail?: string;
  finding?: boolean; // red, with "!" instead of a tick
  delay: number; // the row lights up; its tick is drawn 0.05 s later
}

export interface ScanScreenData {
  domain: string;
  drawingLabel: string; // the text description of the drawing (its aria-label)
  marks: PlotMark[];
  steps: ScanStep[];
  progress: { delay: number; duration: number }; // the bar above the steps
  report: { summary: string; href: string; delay: number } | null; // "Bericht öffnen" once the report is ready
}

// A time in seconds as a CSS time value, without the rounding noise of sums such as 0.4 + 0.05.
export const seconds = (s: number): string => `${Number(s.toFixed(3))}s`;
