import {
  CAPTURE_SETTINGS,
  classifyMainDocument,
  classifyNavigationError,
  DEFAULT_CONSENT_TOOLS,
  desktopChromeUserAgent,
  pageEvidenceOf,
  type Capture,
  type CaptureEnvironment,
  type CaptureFailure,
  type CaptureVisit,
  type ConsentBannerObservation,
  type ConsentTool,
  type PageSnapshot,
  type PopupGuardState,
  type SnapshotResult,
  type UrlGuard,
  createDohResolver,
  createUrlGuard,
} from '@website-check/scanner';

/** Options of both Cloudflare strategies; defaults are the shared capture settings. */
export interface CloudCaptureOptions {
  maxWaitMs?: number;
  quietWindowMs?: number;
  hardLimitMs?: number;
  consentTools?: readonly ConsentTool[];
  /** The pinned axe-core source; without it the accessibility check is not run (strategy a only). */
  axeSource?: string | null;
  /** Check the redirect from http:// to https:// with `fetch`, in parallel to the page (no browser time). */
  httpProbe?: boolean;
  /**
   * Session A5: the SSRF guard of this capture (the address, every redirect and navigation of the
   * main document, the redirect check). Default: a new guard that resolves names with DNS over HTTPS.
   */
  guard?: UrlGuard;
  /** Session A5 part 3: open the Impressum in a second tab of the same context (strategy a only). */
  impressum?: boolean;
  /** Lab only (Fedor, A5 part 3): measure what reading element positions for "Feld B2" costs; nothing goes into the capture. */
  measureFieldPositions?: boolean;
  /** Session A5 part 3: where the browser runs (one trace per browser session), copied into the capture. */
  visit?: CaptureVisit | null;
  /**
   * Session A5 part 3: the popup guard of the browser, installed once per browser by the queue and shared by
   * parallel scans (one set of the scanner's own pages). Without it the capture installs a guard of its own.
   */
  popupGuard?: { ownTargets: Set<string>; state: PopupGuardState };
}

export interface CloudSettings {
  maxWaitMs: number;
  quietWindowMs: number;
  hardLimitMs: number;
  tools: readonly ConsentTool[];
  axeSource: string | null;
  httpProbe: boolean;
  guard: UrlGuard;
  impressum: boolean;
  measureFieldPositions: boolean;
  visit: CaptureVisit | null;
}

/** What the Worker saw while capturing, for the measurement (not part of the capture). */
export interface CaptureStats {
  /** Browser protocol events the Worker handled for this page (best effort). */
  events: number;
  /** In-page polls (strategy b only). */
  polls: number;
  /** Emulation commands the browser rejected (should be empty). */
  emulationFailed: string[];
  /** Wall time of the capture in the Worker, ms (Worker clocks only advance on I/O). */
  wallMs: number;
  /** How long the capture waited for the http redirect check after the page was done (0 if it was faster). */
  probeWaitMs?: number;
  /** Windows the page opened itself that the popup guard refused (their documents were never sent). */
  popupsBlocked?: number;
  /** Browser time of the homepage tab: from creating the browser context until the tab is closed. */
  homepageMs?: number;
  /** Browser time of the Impressum tab (open to close), when one was opened. */
  impressumMs?: number;
  /**
   * Session fix-a1 (strategy a): requests of an iframe whose address Puppeteer learned only after they
   * started, placed at the end of the capture; and requests whose document stayed unknown.
   */
  framesPlacedLate?: number;
  framesUnknown?: number;
  /** Lab only: time and size of reading element positions for "Feld B2" (one evaluation in the page). */
  fieldPositions?: { ms: number; elements: number; boxes: number; failed: boolean };
}

export interface CloudCaptureResult {
  capture: Capture;
  stats: CaptureStats;
}

export function resolveSettings(options: CloudCaptureOptions): CloudSettings {
  return {
    maxWaitMs: options.maxWaitMs ?? CAPTURE_SETTINGS.maxWaitMs,
    quietWindowMs: options.quietWindowMs ?? CAPTURE_SETTINGS.quietWindowMs,
    hardLimitMs: options.hardLimitMs ?? CAPTURE_SETTINGS.hardLimitMs,
    tools: options.consentTools ?? DEFAULT_CONSENT_TOOLS,
    axeSource: options.axeSource ?? null,
    httpProbe: options.httpProbe ?? false,
    guard: options.guard ?? createUrlGuard({ resolve: createDohResolver() }),
    impressum: options.impressum ?? false,
    measureFieldPositions: options.measureFieldPositions ?? false,
    visit: options.visit ?? null,
  };
}

/** Same environment as the local adapter: a normal desktop Chrome of the browser's version. */
export function cloudEnvironment(chromeVersion: string): CaptureEnvironment {
  return {
    browser: `chromium ${chromeVersion}`,
    userAgent: desktopChromeUserAgent(chromeVersion),
    locale: CAPTURE_SETTINGS.locale,
    timezoneId: CAPTURE_SETTINGS.timezoneId,
    viewport: { ...CAPTURE_SETTINGS.viewport },
  };
}

/**
 * Banner observation from the in-page probe. `toCaptureMs` converts an epoch time of the
 * browser's clock into capture time.
 */
export function bannerObservation(snapshot: SnapshotResult | null, toCaptureMs: (epochMs: number) => number): ConsentBannerObservation {
  const probe = snapshot?.probe ?? null;
  return {
    detected: probe?.found != null,
    toolId: probe?.found?.toolId ?? null,
    method: probe?.found?.method ?? null,
    selector: probe?.found?.selector ?? null,
    visibleAtMs: probe?.found ? Math.max(0, Math.round(toCaptureMs(probe.found.at))) : null,
    toolsInDom: Object.keys(probe?.present ?? {}).sort(),
    ...(snapshot?.signals ? { signals: snapshot.signals } : {}),
  };
}

export function pageSnapshotOf(snapshot: SnapshotResult | null): PageSnapshot | null {
  if (snapshot === null) return null;
  return {
    ...(snapshot.url ? { url: snapshot.url } : {}),
    title: snapshot.title,
    lang: snapshot.lang,
    text: snapshot.text,
    textTruncated: snapshot.textTruncated,
    links: snapshot.links,
    linksTruncated: snapshot.linksTruncated,
    ...(snapshot.securityMeta ? { securityMeta: snapshot.securityMeta } : {}),
    ...(snapshot.platform ? { platform: snapshot.platform } : {}),
  };
}

/** Shared by both strategies: the page snapshot also recognises check pages with HTTP 200. */
export function failureOf(
  navigationError: string | null,
  main: { status: number; headers: Record<string, string> } | null,
  snapshot: SnapshotResult | null,
  requests?: number,
): CaptureFailure | null {
  if (navigationError !== null) return { reason: classifyNavigationError(navigationError), message: navigationError };
  if (main === null) return { reason: 'other', message: 'no main document response' };
  return classifyMainDocument(main.status, main.headers, snapshot?.title ?? '', pageEvidenceOf(snapshot, requests));
}

export function errorText(error: unknown): string {
  return error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // Worded like Playwright's timeouts, so `classifyNavigationError` gives 'timeout' for both adapters.
    timer = setTimeout(() => reject(new Error(`Timeout ${ms} ms exceeded`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
