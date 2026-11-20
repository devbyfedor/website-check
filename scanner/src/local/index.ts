/**
 * Node-only part of the scanner: the local Playwright capture adapter and the helpers of the
 * local runner. Never import this from the Worker.
 */
export {
  captureWithPlaywright,
  desktopChromeUserAgent,
  launchLocalBrowser,
  LOCAL_CAPTURE_DEFAULTS,
  type LocalCaptureOptions,
  type LocalCaptureResult,
} from './playwright-capture.ts';
export { parseSitesFile, type SiteEntry, type SitesFileResult } from './sites-file.ts';
export { renderSummaryMarkdown, summarizeRun, type RunSummary, type SiteRunResult } from './summary.ts';
