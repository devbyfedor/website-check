import { chromium, type Browser, type BrowserContext, type Frame, type Request, type Response } from 'playwright';
import { classifyMainDocument, classifyNavigationError } from '../capture/failure.ts';
import {
  CAPTURE_SCHEMA_VERSION,
  type Capture,
  type CaptureEnvironment,
  type CaptureFailure,
  type CapturedRequest,
  type CaptureTimings,
  type ConsentBannerObservation,
  type PageSnapshot,
  type RedirectHop,
  type RequestInitiator,
} from '../capture/types.ts';
import { toInitiator, type CdpInitiator } from '../capture/cdp.ts';
import { SNAPSHOT_EXPRESSION, type SnapshotResult } from '../capture/page-scripts.ts';
import { CAPTURE_SETTINGS, desktopChromeUserAgent, LONG_LIVED_RESOURCE_TYPES } from '../capture/settings.ts';
import { buildBannerProbeScript } from '../consent/probe-script.ts';
import type { ConsentTool } from '../consent/tools.ts';
import { DEFAULT_CONSENT_TOOLS } from '../data.ts';

/**
 * Local capture adapter: Playwright with Chromium on the laptop.
 *
 * Opens one page in a fresh browser context (no cookies, no stored consent), never interacts
 * with it, records every request until the network is quiet (or at most `maxWaitMs`), and
 * returns a plain `Capture`. The Cloudflare adapter (stage A2) returns the same shape.
 */

/** The same settings as every other adapter (`scanner/src/capture/settings.ts`). */
export const LOCAL_CAPTURE_DEFAULTS = {
  locale: CAPTURE_SETTINGS.locale,
  timezoneId: CAPTURE_SETTINGS.timezoneId,
  viewport: CAPTURE_SETTINGS.viewport,
  maxWaitMs: CAPTURE_SETTINGS.maxWaitMs,
  quietWindowMs: CAPTURE_SETTINGS.quietWindowMs,
  hardLimitMs: CAPTURE_SETTINGS.hardLimitMs,
} as const;

export interface LocalCaptureOptions {
  maxWaitMs?: number;
  quietWindowMs?: number;
  hardLimitMs?: number;
  /** Default: the user agent of a normal desktop Chrome of the same version (see docs/decisions.md). */
  userAgent?: string;
  consentTools?: readonly ConsentTool[];
  /** Also return the final HTML and a viewport screenshot, for manual checks (local only). */
  artifacts?: boolean;
}

export interface LocalCaptureResult {
  capture: Capture;
  html: string | null;
  screenshot: Buffer | null;
}

export { desktopChromeUserAgent };

/** Launches the Playwright Chromium in headless mode (full browser, not the headless shell). */
export async function launchLocalBrowser(extraArgs: readonly string[] = []): Promise<Browser> {
  return chromium.launch({ channel: 'chromium', headless: true, args: [...extraArgs] });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function frameOf(request: Request): Frame | null {
  try {
    return request.frame();
  } catch {
    return null; // e.g. service worker requests have no frame
  }
}

function frameUrlsOf(frame: Frame, main: Frame): string[] {
  const urls: string[] = [];
  let current: Frame | null = frame;
  while (current !== null && current !== main) {
    const url = current.url();
    if (/^https?:/i.test(url)) urls.push(url);
    current = current.parentFrame();
  }
  return urls;
}

export async function captureWithPlaywright(browser: Browser, url: string, options: LocalCaptureOptions = {}): Promise<LocalCaptureResult> {
  const settings = {
    maxWaitMs: options.maxWaitMs ?? LOCAL_CAPTURE_DEFAULTS.maxWaitMs,
    quietWindowMs: options.quietWindowMs ?? LOCAL_CAPTURE_DEFAULTS.quietWindowMs,
    hardLimitMs: options.hardLimitMs ?? LOCAL_CAPTURE_DEFAULTS.hardLimitMs,
    artifacts: options.artifacts ?? false,
    tools: options.consentTools ?? DEFAULT_CONSENT_TOOLS,
  };
  const environment: CaptureEnvironment = {
    browser: `chromium ${browser.version()}`,
    userAgent: options.userAgent ?? desktopChromeUserAgent(browser.version()),
    locale: LOCAL_CAPTURE_DEFAULTS.locale,
    timezoneId: LOCAL_CAPTURE_DEFAULTS.timezoneId,
    viewport: { ...LOCAL_CAPTURE_DEFAULTS.viewport },
  };
  const context = await browser.newContext({
    locale: environment.locale,
    timezoneId: environment.timezoneId,
    viewport: environment.viewport,
    userAgent: environment.userAgent,
    serviceWorkers: 'block',
    acceptDownloads: false,
  });
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void context.close().catch(() => undefined);
  }, settings.hardLimitMs);
  try {
    return await runCapture(context, url, settings, environment, () => hardLimitHit);
  } finally {
    clearTimeout(hardTimer);
    await context.close().catch(() => undefined);
  }
}

async function runCapture(
  context: BrowserContext,
  url: string,
  settings: { maxWaitMs: number; quietWindowMs: number; artifacts: boolean; tools: readonly ConsentTool[] },
  environment: CaptureEnvironment,
  hardLimitHit: () => boolean,
): Promise<LocalCaptureResult> {
  const page = await context.newPage();
  await page.addInitScript({ content: buildBannerProbeScript(settings.tools) });
  const mainFrame = page.mainFrame();

  let t0 = performance.now();
  const rel = (): number => Math.max(0, Math.round(performance.now() - t0));
  const records: CapturedRequest[] = [];
  const byRequest = new Map<Request, CapturedRequest>();
  const inflight = new Set<Request>();
  let lastActivity = 0;
  let domContentLoadedMs: number | null = null;
  let loadMs: number | null = null;
  let crashed = false;
  const mainResponses: Response[] = [];

  page.on('domcontentloaded', () => {
    domContentLoadedMs ??= rel();
  });
  page.on('load', () => {
    loadMs ??= rel();
  });
  page.on('crash', () => {
    crashed = true;
  });
  page.on('request', (request) => {
    const frame = frameOf(request);
    const record: CapturedRequest = {
      seq: records.length,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startMs: rel(),
      endMs: null,
      status: null,
      failure: null,
      isMainFrame: frame === mainFrame,
      frameUrls: frame === null ? [] : frameUrlsOf(frame, mainFrame),
      isNavigation: request.isNavigationRequest(),
      initiator: null,
      redirectedFrom: request.redirectedFrom()?.url() ?? null,
    };
    records.push(record);
    byRequest.set(request, record);
    if (!LONG_LIVED_RESOURCE_TYPES.has(record.resourceType)) inflight.add(request);
    lastActivity = record.startMs;
  });
  page.on('response', (response) => {
    const request = response.request();
    const record = byRequest.get(request);
    const status = response.status();
    if (record !== undefined) record.status = status;
    // Main-frame documents only; HTTP redirect hops are read later through redirectedFrom().
    const isRedirect = status >= 300 && status < 400;
    if (!isRedirect && request.isNavigationRequest() && frameOf(request) === mainFrame) mainResponses.push(response);
  });
  page.on('requestfinished', (request) => {
    const record = byRequest.get(request);
    if (record !== undefined) record.endMs = rel();
    inflight.delete(request);
    lastActivity = rel();
  });
  page.on('requestfailed', (request) => {
    const record = byRequest.get(request);
    if (record !== undefined) {
      record.endMs = rel();
      record.failure = request.failure()?.errorText ?? 'failed';
    }
    inflight.delete(request);
    lastActivity = rel();
  });
  page.on('websocket', (socket) => {
    const record: CapturedRequest = {
      seq: records.length,
      url: socket.url(),
      method: 'GET',
      resourceType: 'websocket',
      startMs: rel(),
      endMs: null,
      status: null,
      failure: null,
      isMainFrame: false,
      frameUrls: [],
      isNavigation: false,
      initiator: null,
      redirectedFrom: null,
    };
    records.push(record);
    lastActivity = record.startMs;
    const opened = (): void => {
      record.status ??= 101;
    };
    socket.on('framereceived', opened);
    socket.on('framesent', opened);
    socket.on('socketerror', (message) => {
      record.failure ??= message;
    });
    socket.on('close', () => {
      record.endMs ??= rel();
    });
  });

  // Initiators (who triggered a request) come from the Chrome DevTools Protocol, best effort.
  const initiatorsByUrl = new Map<string, RequestInitiator[]>();
  try {
    const cdp = await context.newCDPSession(page);
    cdp.on('Network.requestWillBeSent', (event: { request: { url: string }; initiator: CdpInitiator }) => {
      const list = initiatorsByUrl.get(event.request.url) ?? [];
      list.push(toInitiator(event.initiator));
      initiatorsByUrl.set(event.request.url, list);
    });
    await cdp.send('Network.enable');
  } catch {
    // initiators stay null
  }

  const startedAt = new Date().toISOString();
  const startEpoch = Date.now();
  t0 = performance.now();
  let navigationError: string | null = null;
  try {
    const response = await page.goto(url, { waitUntil: 'commit', timeout: settings.maxWaitMs });
    if (response === null) navigationError = 'navigation returned no response';
  } catch (error) {
    navigationError = hardLimitHit() ? 'Timeout: hard limit for one page reached' : errorText(error);
  }

  let stopReason: CaptureTimings['stopReason'] = 'error';
  let networkQuietMs: number | null = null;
  if (navigationError === null) {
    stopReason = 'max-wait';
    for (;;) {
      if (crashed || hardLimitHit() || page.isClosed()) {
        stopReason = 'error';
        break;
      }
      const now = rel();
      if (loadMs !== null && inflight.size === 0 && now - lastActivity >= settings.quietWindowMs) {
        stopReason = 'network-quiet';
        networkQuietMs = lastActivity;
        break;
      }
      if (now >= settings.maxWaitMs) break;
      await sleep(100);
    }
  }

  // Collect in order of importance, so a slow page loses the extras first: headers, page
  // snapshot (part of the capture), then HTML and screenshot (local extras for manual checks).
  let snapshot: SnapshotResult | null = null;
  let html: string | null = null;
  let screenshot: Buffer | null = null;
  let headers: Record<string, string> = {};
  const mainResponse = mainResponses.at(-1) ?? null;
  if (mainResponse !== null) {
    headers = await withTimeout(mainResponse.allHeaders(), 2_000).catch(() => mainResponse.headers());
  }
  if (navigationError === null && !hardLimitHit() && !crashed) {
    snapshot = await withTimeout(page.evaluate(SNAPSHOT_EXPRESSION) as Promise<SnapshotResult>, 4_000).catch(() => null);
  }
  const endMs = rel();
  if (settings.artifacts && navigationError === null && !hardLimitHit() && !crashed) {
    html = await withTimeout(page.content(), 4_000).catch(() => null);
    screenshot = await withTimeout(page.screenshot({ type: 'png', timeout: 4_000 }), 5_000).catch(() => null);
  }

  for (const record of records) {
    const queue = initiatorsByUrl.get(record.url);
    record.initiator = queue?.shift() ?? null;
  }

  const finalUrl = mainResponse?.url() ?? null;
  const redirectChain: RedirectHop[] = [];
  for (const response of mainResponses) {
    const hops: RedirectHop[] = [];
    let previous = response.request().redirectedFrom();
    while (previous !== null) {
      const status = byRequest.get(previous)?.status ?? 0;
      hops.unshift({ url: previous.url(), status });
      previous = previous.redirectedFrom();
    }
    redirectChain.push(...hops);
    if (response !== mainResponse) redirectChain.push({ url: response.url(), status: response.status() });
  }

  let failure: CaptureFailure | null = null;
  if (navigationError !== null) {
    failure = { reason: classifyNavigationError(navigationError), message: navigationError };
  } else if (mainResponse === null) {
    failure = { reason: 'other', message: 'no main document response' };
  } else {
    failure = classifyMainDocument(mainResponse.status(), headers, snapshot?.title ?? '');
  }

  const probe = snapshot?.probe ?? null;
  const consentBanner: ConsentBannerObservation = {
    detected: probe?.found != null,
    toolId: probe?.found?.toolId ?? null,
    method: probe?.found?.method ?? null,
    selector: probe?.found?.selector ?? null,
    visibleAtMs: probe?.found ? Math.max(0, Math.round(probe.found.at - startEpoch)) : null,
    toolsInDom: Object.keys(probe?.present ?? {}).sort(),
    ...(snapshot?.signals ? { signals: snapshot.signals } : {}),
  };

  const pageSnapshot: PageSnapshot | null =
    snapshot === null
      ? null
      : {
          title: snapshot.title,
          lang: snapshot.lang,
          text: snapshot.text,
          textTruncated: snapshot.textTruncated,
          links: snapshot.links,
          linksTruncated: snapshot.linksTruncated,
        };

  const capture: Capture = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    adapter: 'playwright-local',
    environment,
    requestedUrl: url,
    startedAt,
    ok: failure === null,
    failure,
    finalUrl,
    mainDocument: mainResponse === null ? null : { status: mainResponse.status(), headers, redirectChain },
    requests: records,
    page: pageSnapshot,
    consentBanner,
    axe: null,
    timings: { domContentLoadedMs, loadMs, networkQuietMs, endMs, stopReason },
  };
  return { capture, html, screenshot };
}
