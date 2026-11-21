import {
  CAPTURE_SETTINGS,
  classifyMainDocument,
  classifyNavigationError,
  DEFAULT_CONSENT_TOOLS,
  desktopChromeUserAgent,
  type Capture,
  type CaptureEnvironment,
  type CaptureFailure,
  type ConsentBannerObservation,
  type ConsentTool,
  type PageSnapshot,
  type SnapshotResult,
} from '@website-check/scanner';

/** Options of both Cloudflare strategies; defaults are the shared capture settings. */
export interface CloudCaptureOptions {
  maxWaitMs?: number;
  quietWindowMs?: number;
  hardLimitMs?: number;
  consentTools?: readonly ConsentTool[];
}

export interface CloudSettings {
  maxWaitMs: number;
  quietWindowMs: number;
  hardLimitMs: number;
  tools: readonly ConsentTool[];
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
    title: snapshot.title,
    lang: snapshot.lang,
    text: snapshot.text,
    textTruncated: snapshot.textTruncated,
    links: snapshot.links,
    linksTruncated: snapshot.linksTruncated,
  };
}

export function failureOf(
  navigationError: string | null,
  main: { status: number; headers: Record<string, string> } | null,
  title: string,
): CaptureFailure | null {
  if (navigationError !== null) return { reason: classifyNavigationError(navigationError), message: navigationError };
  if (main === null) return { reason: 'other', message: 'no main document response' };
  return classifyMainDocument(main.status, main.headers, title);
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
