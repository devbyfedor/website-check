import { chromium, type Browser, type BrowserContext, type Frame, type Page, type Request, type Response } from 'playwright';
import { AXE_RUN_EXPRESSION, axeBudgetMs, axeCaptureFrom, axeNotRun } from '../a11y/axe-script.ts';
import type { AxeCapture } from '../a11y/types.ts';
import { httpsVariantOf, httpVariantOf, probeHttpRedirect, probeHttps } from '../security/http-probe.ts';
import type { HttpProbe, HttpsProbe } from '../security/types.ts';
import { classifyMainDocument, classifyNavigationError, interruptedFailure, notAllowedCapture, pageEvidenceOf } from '../capture/failure.ts';
import {
  checkReadDocument,
  currentDocument,
  installNavigationGuard,
  installPopupGuard,
  navigationBlockMessage,
  readCheckedDocument,
  type NavigationGuardState,
  type PopupGuardState,
} from '../security/navigation-guard.ts';
import { describeRejection, type UrlGuard } from '../security/ssrf.ts';
import { createLocalGuard } from './node-resolver.ts';
import { IMPRESSUM_SETTINGS, pollText, type TextWatch } from '../legal/impressum-capture.ts';
import { chooseImpressumTarget } from '../legal/links.ts';
import {
  CAPTURE_SCHEMA_VERSION,
  type Capture,
  type CaptureEnvironment,
  type CaptureFailure,
  type CapturedRequest,
  type CaptureTimings,
  type ConsentBannerObservation,
  type ImpressumCapture,
  type PageSnapshot,
  type RedirectHop,
  type RequestInitiator,
} from '../capture/types.ts';
import { toInitiator, type CdpInitiator } from '../capture/cdp.ts';
import { IMPRESSUM_SNAPSHOT_EXPRESSION, SNAPSHOT_EXPRESSION, TEXT_PROGRESS_EXPRESSION, type SnapshotResult, type TextProgress } from '../capture/page-scripts.ts';
import { CAPTURE_SETTINGS, desktopChromeUserAgent, LONG_LIVED_RESOURCE_TYPES } from '../capture/settings.ts';
import { buildBannerProbeScript } from '../consent/probe-script.ts';
import type { ConsentTool } from '../consent/tools.ts';
import { DEFAULT_CONSENT_TOOLS } from '../data.ts';
import { loadAxeSource } from './axe-source.ts';

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
  /** Run the pinned axe-core after the network is quiet (default true). */
  accessibility?: boolean;
  /** Check the redirect from http:// to https:// with plain HTTP requests, in parallel (default true). */
  httpProbe?: boolean;
  /** Open the Impressum link of the homepage in a second tab and read its text (default true, session A4). */
  impressum?: boolean;
  /**
   * Session A5: the SSRF guard for this capture (the address, every redirect and navigation of the
   * main document, the redirect check and the Impressum tab). Default: a new guard with the
   * operating system's resolver. Tests pass one that exempts the fixture site.
   */
  guard?: UrlGuard;
  /**
   * Session fix-a2: the guard against windows the page opens itself, when several captures share one browser
   * at the same time: ONE guard for the browser with one set of the scanner's own pages (a guard per capture
   * would close the tab of the other capture as a foreign window). Default: a guard for this capture alone.
   */
  popupGuard?: { state: PopupGuardState; ownTargets: Set<string> };
  /**
   * Local comparisons only: runs on the same page right after the checks, before the HTML and the
   * screenshot, outside the page's hard limit (at most 90 s), with the checks already made. Its result is `after`.
   */
  afterChecks?: (page: Page, checks: { axe: AxeCapture | null }) => Promise<unknown>;
}

export interface LocalCaptureResult {
  capture: Capture;
  html: string | null;
  screenshot: Buffer | null;
  /** Local extras of the Impressum tab for manual checks (with `artifacts`), not counted in its browser time. */
  impressumHtml?: string | null;
  impressumScreenshot?: Buffer | null;
  /** Result of `afterChecks`, or its error text. */
  after?: unknown;
}

export { desktopChromeUserAgent };

/** Launches the Playwright Chromium in headless mode (full browser, not the headless shell). */
export async function launchLocalBrowser(extraArgs: readonly string[] = []): Promise<Browser> {
  // SSRF (A5 review): Playwright turns Chrome's popup blocker off by default; with it on, a page
  // cannot open a window without a user action. That alone is not enough (review of stage A): the scan
  // never acts, but Playwright's `page.evaluate` counts as a user action for a few seconds, so
  // `captureWithPlaywright` also refuses every window it did not open itself (`installPopupGuard`).
  return chromium.launch({ channel: 'chromium', headless: true, args: [...extraArgs], ignoreDefaultArgs: ['--disable-popup-blocking'] });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Injects the pinned axe-core into the top-level document and runs the seven rules
 * (`AXE_RUN_EXPRESSION`). Never throws: a failure or timeout becomes the capture's axe status.
 */
export async function runAxeInPlaywright(page: Page, axeSource: string, budgetMs: number): Promise<AxeCapture> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  let injectMs: number | null = null;
  try {
    await withTimeout(page.evaluate(axeSource), budgetMs);
    injectMs = elapsed();
    const left = budgetMs - injectMs;
    if (left < 300) return axeNotRun('timeout', 'no time left after injecting axe-core', { injectMs, totalMs: elapsed() });
    const output: unknown = await withTimeout(page.evaluate(AXE_RUN_EXPRESSION), left);
    return axeCaptureFrom(output, { injectMs, totalMs: elapsed() });
  } catch (error) {
    const message = errorText(error);
    return axeNotRun(/timed out after/.test(message) ? 'timeout' : 'error', message, { injectMs, totalMs: elapsed() });
  }
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
    axeSource: options.accessibility === false ? null : await loadAxeSource(),
    afterChecks: options.afterChecks ?? null,
  };
  const environment: CaptureEnvironment = {
    browser: `chromium ${browser.version()}`,
    userAgent: options.userAgent ?? desktopChromeUserAgent(browser.version()),
    locale: LOCAL_CAPTURE_DEFAULTS.locale,
    timezoneId: LOCAL_CAPTURE_DEFAULTS.timezoneId,
    viewport: { ...LOCAL_CAPTURE_DEFAULTS.viewport },
  };
  // SSRF protection: the address is checked before the browser opens anything.
  const guard = options.guard ?? createLocalGuard();
  const verdict = await guard.check(url);
  if (!verdict.allowed) return { capture: notAllowedCapture('playwright-local', environment, url, describeRejection(verdict)), html: null, screenshot: null };
  // The redirect check needs no browser: it runs while the page loads.
  const httpUrl = options.httpProbe === false ? null : httpVariantOf(url);
  const probe: Promise<HttpProbe | null> | null =
    httpUrl === null ? null : probeHttpRedirect(httpUrl, { userAgent: environment.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, guard }).catch(() => null);
  // Session fix-a2: an address entered with http:// gets one request to its https:// address, so the report
  // says "ohne HTTPS" only after https:// was asked.
  const httpsUrl = options.httpProbe === false ? null : httpsVariantOf(url);
  const httpsProbe: Promise<HttpsProbe | null> | null =
    httpsUrl === null ? null : probeHttps(httpsUrl, { userAgent: environment.userAgent, acceptLanguage: CAPTURE_SETTINGS.acceptLanguage, guard }).catch(() => null);
  // Session fix-a2: windows the page opens itself never load, as in the Cloudflare adapter. A page gets
  // "user activation" from every `page.evaluate` of the capture (snapshot, axe, the Impressum poll), and
  // with it Chrome's popup blocker lets a window through, to any address and past the page's own guard.
  const shared = options.popupGuard ?? null;
  const browserSession = shared === null ? await browser.newBrowserCDPSession() : null;
  const ownTargets = shared?.ownTargets ?? new Set<string>();
  if (browserSession !== null) await installPopupGuard(browserSession, ownTargets);
  const contextStarted = performance.now();
  const context = await browser
    .newContext({
      locale: environment.locale,
      timezoneId: environment.timezoneId,
      viewport: environment.viewport,
      userAgent: environment.userAgent,
      serviceWorkers: 'block',
      acceptDownloads: false,
    })
    .catch(async (error: unknown) => {
      await browserSession?.detach().catch(() => undefined);
      throw error;
    });
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void context.close().catch(() => undefined);
  }, settings.hardLimitMs);
  try {
    const { result, startedAt } = await runCapture(browser, context, url, settings, environment, () => hardLimitHit, contextStarted, () => clearTimeout(hardTimer), guard, ownTargets);
    // The homepage is done: its hard limit no longer applies, the Impressum tab has its own.
    clearTimeout(hardTimer);
    const capture = result.capture;
    if (options.impressum !== false && capture.ok && capture.page !== null && !hardLimitHit) {
      const target = chooseImpressumTarget(capture.page.links, capture.page.url ?? capture.finalUrl);
      if (target.action === 'open') {
        const tab = await captureImpressumTab(context, target.url, startedAt, settings.artifacts, guard, ownTargets);
        capture.impressum = tab.impressum;
        result.impressumHtml = tab.html;
        result.impressumScreenshot = tab.screenshot;
      } else {
        capture.impressum = null;
      }
    }
    if (probe !== null) capture.httpProbe = await probe;
    if (httpsProbe !== null) capture.httpsProbe = await httpsProbe;
    // Session fix-a1: a browser lost on the way makes the capture an error, never a report.
    assertConnected(browser);
    return result;
  } finally {
    clearTimeout(hardTimer);
    await context.close().catch(() => undefined);
    await browserSession?.detach().catch(() => undefined);
  }
}

/** Why something read from the page was not kept (`readCheckedDocument`). */
const READ_DROPPED = {
  'unknown-document': 'the browser did not name the document in the tab',
  refused: 'the document in the tab is not allowed',
  changed: 'another document replaced the page while it was checked',
} as const;

/** Session fix-a1: thrown when the browser is gone; a capture never ends as a report then. */
export const BROWSER_LOST = 'the connection to the browser was lost during the capture';

function assertConnected(browser: Browser): void {
  if (!browser.isConnected()) throw new Error(BROWSER_LOST);
}

async function runCapture(
  browser: Browser,
  context: BrowserContext,
  url: string,
  settings: {
    maxWaitMs: number;
    quietWindowMs: number;
    hardLimitMs: number;
    artifacts: boolean;
    tools: readonly ConsentTool[];
    axeSource: string | null;
    afterChecks: ((page: Page, checks: { axe: AxeCapture | null }) => Promise<unknown>) | null;
  },
  environment: CaptureEnvironment,
  hardLimitHit: () => boolean,
  contextStarted: number,
  disarmHardLimit: () => void,
  guard: UrlGuard,
  ownTargets: Set<string>,
): Promise<{ result: LocalCaptureResult; startedAt: number }> {
  const page = await context.newPage();
  const guardSession = await context.newCDPSession(page);
  // The tab is the scanner's own: the popup guard lets its documents through (the page's guard checks them).
  const own = await currentDocument(guardSession);
  if (own === null) throw new Error('the browser did not name the new tab');
  ownTargets.add(own.frameId);
  // Every document request of the main frame waits for the SSRF guard (redirects and later navigations included).
  const navigation = await installNavigationGuard(guardSession, guard);
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
      // Playwright names the frame of every request it reports, except those of a service worker.
      frameKnown: frame !== null,
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
      if (crashed || hardLimitHit() || page.isClosed() || !browser.isConnected()) {
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
  assertConnected(browser);
  const mainResponse = mainResponses.at(-1) ?? null;
  if (mainResponse !== null) {
    headers = await withTimeout(mainResponse.allHeaders(), 2_000).catch(() => mainResponse.headers());
  }
  if (navigationError === null && !hardLimitHit() && !crashed) {
    snapshot = await withTimeout(page.evaluate(SNAPSHOT_EXPRESSION) as Promise<SnapshotResult>, 4_000).catch(() => null);
    // The data must come from a document the guard allows (second line of defence).
    if (snapshot !== null && !(await checkReadDocument(navigation, guard, snapshot.url ?? page.url()))) snapshot = null;
  }
  assertConnected(browser);
  let failure: CaptureFailure | null = null;
  const refused = navigation.blocked[0];
  // Session fix-a1, as in the Cloudflare adapter: a capture cut off after the main document answered (the hard
  // limit, a crashed or closed tab) is a failed capture. A page that only could not be read is not cut off.
  const tabGone = hardLimitHit() ? 'hard-limit' : crashed ? 'crashed' : page.isClosed() || stopReason === 'error' ? 'closed' : null;
  const cutOff = navigationError === null && (stopReason === 'error' || snapshot === null) ? tabGone : null;
  if (refused !== undefined) {
    failure = { reason: 'not-allowed', message: navigationBlockMessage(refused) };
  } else if (cutOff !== null) {
    failure = interruptedFailure(cutOff);
  } else if (navigationError !== null) {
    failure = { reason: classifyNavigationError(navigationError), message: navigationError };
  } else if (mainResponse === null) {
    failure = { reason: 'other', message: 'no main document response' };
  } else {
    failure = classifyMainDocument(mainResponse.status(), headers, snapshot?.title ?? '', pageEvidenceOf(snapshot, records.length));
  }

  // axe only on a page that was captured: an error page, a check page or a timeout gets no
  // accessibility result and costs no browser time.
  const pageUsable = (): boolean => failure === null && snapshot !== null && !hardLimitHit() && !crashed && !page.isClosed();
  let axe: AxeCapture | null = null;
  if (settings.axeSource !== null) {
    const budget = axeBudgetMs(performance.now() - contextStarted, settings.hardLimitMs);
    if (!pageUsable()) axe = axeNotRun('skipped', failure === null ? 'the page did not load' : `the page was not captured (${failure.reason})`);
    else if (budget === 0) axe = axeNotRun('skipped', 'no time left before the hard limit of the page');
    else {
      // Session fix-a2: axe reads only a document the guard allows (see `readCheckedDocument`).
      const source = settings.axeSource;
      const checked = await readCheckedDocument(guardSession, navigation, guard, () => runAxeInPlaywright(page, source, budget));
      axe = checked.ok ? checked.value : axeNotRun('error', `the accessibility check was dropped: ${READ_DROPPED[checked.reason]}`);
    }
  }
  const endMs = rel();
  let after: unknown;
  if (settings.afterChecks !== null && pageUsable()) {
    disarmHardLimit();
    after = await withTimeout(settings.afterChecks(page, { axe }), 90_000).catch((error: unknown) => ({ error: errorText(error) }));
  }
  if (settings.artifacts && navigationError === null && navigation.blocked.length === 0 && !hardLimitHit() && !crashed) {
    // The HTML and the screenshot come from a document the guard allows too, or not at all.
    const extras = await readCheckedDocument(guardSession, navigation, guard, async () => ({
      html: await withTimeout(page.content(), 4_000).catch(() => null),
      screenshot: await withTimeout(page.screenshot({ type: 'png', timeout: 4_000 }), 5_000).catch(() => null),
    }));
    if (extras.ok) ({ html, screenshot } = extras.value);
  }
  // A document the guard refuses, found in the tab after the snapshot, fails the capture like a refused navigation.
  const refusedLate = navigation.blocked[0];
  if (failure === null && refusedLate !== undefined) {
    failure = { reason: 'not-allowed', message: navigationBlockMessage(refusedLate) };
    if (axe !== null) axe = axeNotRun('skipped', 'the page was not captured (not-allowed)');
    html = null;
    screenshot = null;
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
    // A copy: the homepage tab stays open while the Impressum loads, and must not add to its capture.
    requests: records.map((record) => ({ ...record })),
    page: pageSnapshot,
    consentBanner,
    axe,
    timings: { domContentLoadedMs, loadMs, networkQuietMs, endMs, stopReason },
  };
  return { result: { capture, html, screenshot, ...(settings.afterChecks !== null ? { after } : {}) }, startedAt: t0 };
}

/**
 * Session A4: opens the Impressum in a second tab of the same browser context (no new browser, the
 * consent state of the homepage visit), waits for DOMContentLoaded and then only until the text stops
 * growing (`IMPRESSUM_SETTINGS`), reads title, text and links, and closes the tab. No interaction, no
 * accessibility check. `totalMs` is the browser time of the tab: opening, loading, reading and closing;
 * the local extras (HTML and screenshot for manual checks) are taken before closing but not counted.
 */
export async function captureImpressumTab(
  context: BrowserContext,
  url: string,
  homepageStartedAt: number,
  artifacts: boolean,
  guard: UrlGuard,
  ownTargets: Set<string> = new Set(),
): Promise<{ impressum: ImpressumCapture; html: string | null; screenshot: Buffer | null }> {
  const opened = performance.now();
  const since = (): number => Math.max(0, Math.round(performance.now() - opened));
  const page = await context.newPage();
  let navigation: NavigationGuardState | null = null;
  let guardSession: Awaited<ReturnType<BrowserContext['newCDPSession']>> | null = null;
  try {
    guardSession = await context.newCDPSession(page);
    // The scanner's own tab for the popup guard; without its id the tab is not opened (the guard would close it).
    const own = await currentDocument(guardSession);
    if (own === null) throw new Error('the browser did not name the new tab');
    ownTargets.add(own.frameId);
    navigation = await installNavigationGuard(guardSession, guard);
  } catch {
    navigation = null;
  }
  let requestCount = 0;
  let domContentLoadedMs: number | null = null;
  page.on('request', () => {
    requestCount += 1;
  });
  page.on('domcontentloaded', () => {
    domContentLoadedMs ??= since();
  });
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void page.close().catch(() => undefined);
  }, IMPRESSUM_SETTINGS.hardLimitMs);
  let navigationError: string | null = null;
  let response: Response | null = null;
  let stopReason: ImpressumCapture['timings']['stopReason'] = 'error';
  let snapshot: SnapshotResult | null = null;
  let snapshotMs: number | null = null;
  let html: string | null = null;
  let screenshot: Buffer | null = null;
  let extrasMs = 0;
  try {
    try {
      // Never navigate without the guard.
      if (navigation === null) throw new Error('SSRF guard not installed');
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: IMPRESSUM_SETTINGS.navigationTimeoutMs });
      if (response === null) navigationError = 'navigation returned no response';
    } catch (error) {
      navigationError = hardLimitHit ? 'Timeout: hard limit for the Impressum reached' : errorText(error);
    }
    if (navigationError === null) {
      const settleStart = performance.now();
      let watch: TextWatch = { length: -1, changedAtMs: 0 };
      for (;;) {
        if (hardLimitHit || page.isClosed()) break;
        const progress =
          (await withTimeout(page.evaluate(TEXT_PROGRESS_EXPRESSION) as Promise<TextProgress>, 2_000).catch(() => null)) ?? { readyState: 'loading', length: 0 };
        const step = pollText(watch, progress.length, progress.readyState === 'complete', Math.round(performance.now() - settleStart));
        watch = step.watch;
        if (step.done !== null) {
          stopReason = step.done;
          break;
        }
        await sleep(IMPRESSUM_SETTINGS.pollMs);
      }
      if (!hardLimitHit && !page.isClosed()) {
        snapshot = await withTimeout(page.evaluate(IMPRESSUM_SNAPSHOT_EXPRESSION) as Promise<SnapshotResult>, 4_000).catch(() => null);
        if (snapshot !== null && navigation !== null && !(await checkReadDocument(navigation, guard, snapshot.url ?? page.url()))) snapshot = null;
        snapshotMs = since();
      }
      if (artifacts && snapshot !== null && navigation !== null && guardSession !== null && !hardLimitHit && !page.isClosed()) {
        const extrasStart = performance.now();
        // The local extras come from a document the guard allows too, or not at all (session fix-a2).
        const extras = await readCheckedDocument(guardSession, navigation, guard, async () => ({
          html: await withTimeout(page.content(), 4_000).catch(() => null),
          screenshot: await withTimeout(page.screenshot({ type: 'png', timeout: 5_000, fullPage: true }), 6_000).catch(() => null),
        }));
        if (extras.ok) ({ html, screenshot } = extras.value);
        extrasMs = Math.round(performance.now() - extrasStart);
      }
    }
  } finally {
    clearTimeout(hardTimer);
    await page.close().catch(() => undefined);
  }
  const totalMs = Math.max(0, since() - extrasMs);
  let failure: CaptureFailure | null;
  const refused = navigation?.blocked[0];
  if (navigation === null) failure = { reason: 'other', message: 'the SSRF guard could not be installed; the Impressum was not opened' };
  else if (refused !== undefined) failure = { reason: 'not-allowed', message: navigationBlockMessage(refused) };
  else if (navigationError !== null) failure = { reason: classifyNavigationError(navigationError), message: navigationError };
  else if (response === null) failure = { reason: 'other', message: 'no Impressum response' };
  else if (snapshot === null) failure = { reason: hardLimitHit ? 'timeout' : 'other', message: 'the text of the Impressum could not be read' };
  else failure = classifyMainDocument(response.status(), response.headers(), snapshot.title, pageEvidenceOf(snapshot, requestCount));
  const impressum: ImpressumCapture = {
    url,
    ok: failure === null,
    failure,
    finalUrl: response?.url() ?? null,
    status: response?.status() ?? null,
    page:
      snapshot === null
        ? null
        : { ...(snapshot.url ? { url: snapshot.url } : {}), title: snapshot.title, lang: snapshot.lang, text: snapshot.text, textTruncated: snapshot.textTruncated, links: snapshot.links, linksTruncated: snapshot.linksTruncated },
    requestCount,
    timings: {
      openedAtMs: Math.max(0, Math.round(opened - homepageStartedAt)),
      domContentLoadedMs,
      snapshotMs,
      totalMs,
      stopReason: failure === null ? stopReason : 'error',
    },
  };
  return { impressum, html, screenshot };
}

