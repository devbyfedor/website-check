import { CDPSessionEvent, type Browser, type BrowserContext, type CDPSession, type Frame, type HTTPRequest, type HTTPResponse, type Page } from '@cloudflare/puppeteer';
import {
  axeBudgetMs,
  axeNotRun,
  runAxeIsolated,
  buildBannerProbeScript,
  CAPTURE_SCHEMA_VERSION,
  checkReadDocument,
  describeRejection,
  httpsVariantOf,
  httpVariantOf,
  installNavigationGuard,
  interruptedFailure,
  installPopupGuard,
  limitCapture,
  limitRequest,
  limitSnapshot,
  pageLimitFailure,
  RequestBudget,
  navigationBlockMessage,
  notAllowedCapture,
  probeHttpRedirect,
  probeHttps,
  readCheckedDocument,
  type AxeCapture,
  type HttpProbe,
  type HttpsProbe,
  CAPTURE_SETTINGS,
  networkQuietNow,
  chooseImpressumTarget,
  chromeVersionOf,
  LONG_LIVED_RESOURCE_TYPES,
  SNAPSHOT_EXPRESSION,
  toInitiator,
  type Capture,
  type CapturedRequest,
  type CaptureFailure,
  type CaptureTimings,
  type CdpInitiator,
  type RedirectHop,
  type SnapshotResult,
} from '@website-check/scanner';
import {
  bannerObservation,
  cloudEnvironment,
  errorText,
  failureOf,
  pageSnapshotOf,
  resolveSettings,
  sleep,
  withTimeout,
  type CloudCaptureOptions,
  type CloudCaptureResult,
  type CloudSettings,
} from './common.ts';
import { applyEmulation, frameEmulation, sendAll, userAgentMetadataOf, viewportEmulation, VISITOR_PLATFORM } from './emulation.ts';
import { measureFieldPositions } from './field-positions.ts';
import { frameChain, resolveFrames, type FrameSource } from './frames.ts';
import { captureImpressumTabCdp, failedImpressumTab } from './impressum.ts';

/**
 * Request events through the browser protocol (strategy (a) of session A2, chosen on 21.11.2026; the other one, Resource
 * Timing read inside the page, was deleted in session fix-a6).
 *
 * Mirrors the local Playwright adapter with Puppeteer on Cloudflare Browser Run: a fresh
 * browser context per page (no cookies, no stored consent), no interaction, every request
 * recorded from the browser's network events until the network is quiet or at most
 * `maxWaitMs`. Puppeteer handles every network event in the Worker, which costs Worker CPU;
 * session A2 measures how much.
 */

/** How often the wait loop sends a command, well below the shortest idle timeout of Browser Run (10 s). */
const KEEP_ALIVE_PING_MS = 3_000;

/** Puppeteer's own session of a page. Internal API, so it falls back to a new session. */
export async function clientOf(page: Page): Promise<CDPSession> {
  const internal = (page as unknown as { _client?: () => CDPSession })._client;
  return typeof internal === 'function' ? internal.call(page) : page.createCDPSession();
}

function frameOf(request: HTTPRequest): Frame | null {
  try {
    return request.frame();
  } catch {
    return null;
  }
}

/** Session fix-a1: a capture never ends as a report when the browser is gone; the caller records an error instead. */
export const BROWSER_LOST = 'the connection to the browser was lost during the capture';

function assertConnected(browser: Browser): void {
  if (!browser.connected) throw new Error(BROWSER_LOST);
}

/**
 * Sets up a Puppeteer page as the same visitor as the local Playwright adapter, in every frame:
 * Puppeteer's own user agent override (applied to every frame session, out-of-process iframes
 * included) carries the language and the platform; time zone and locale go to the page through
 * Puppeteer and to every iframe session as soon as it attaches, before Puppeteer resumes it.
 * Returns the browser protocol commands that failed.
 */
export async function prepareVisitorPage(page: Page, client: CDPSession, userAgent: string): Promise<string[]> {
  const failed: string[] = [];
  // alert(), confirm() and prompt() are dismissed at once, as Playwright does by default in the local adapter;
  // an open dialog would freeze the page until the hard limit (review of A5 part 3). Dismissing is no consent.
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => undefined);
  });
  const childCommands = frameEmulation(userAgent);
  const emulateChild = (session: CDPSession): void => {
    session.on(CDPSessionEvent.SessionAttached, emulateChild);
    sendAll((method, params) => session.send(method as never, params as never), childCommands);
  };
  client.on(CDPSessionEvent.SessionAttached, emulateChild);
  const step = async (name: string, work: () => Promise<unknown>): Promise<void> => {
    await work().catch(() => failed.push(name));
  };
  await step('setUserAgent', () =>
    page.setUserAgent({ userAgent, userAgentMetadata: userAgentMetadataOf(userAgent) as never, platform: VISITOR_PLATFORM }),
  );
  await step('emulateLocale', () => page.emulateLocale(CAPTURE_SETTINGS.locale));
  await step('emulateTimezone', () => page.emulateTimezone(CAPTURE_SETTINGS.timezoneId));
  await step('setBypassServiceWorker', () => page.setBypassServiceWorker(true));
  failed.push(...(await applyEmulation((method, params) => client.send(method as never, params as never), viewportEmulation())));
  return failed;
}

/**
 * Injects the pinned axe-core into the top-level document over the browser protocol and runs the
 * seven rules; the page compacts the result (`AXE_RUN_EXPRESSION`). Never throws.
 */
export async function runAxeOverCdp(client: CDPSession, axeSource: string, budgetMs: number): Promise<AxeCapture> {
  // Session fix-a6 (review finding 26): in an isolated world of the main frame, out of the page's reach.
  return runAxeIsolated((method, params) => client.send(method as never, params as never), axeSource, budgetMs, withTimeout, (message) => /^Timeout \d+ ms exceeded/.test(message));
}

/** Why an accessibility result was not kept (`readCheckedDocument`). */
const AXE_DROPPED = {
  'unknown-document': 'the browser did not name the document in the tab',
  refused: 'the document in the tab is not allowed',
  changed: 'another document replaced the page while it was checked',
} as const;

export async function captureWithCdpEvents(browser: Browser, url: string, options: CloudCaptureOptions = {}): Promise<CloudCaptureResult> {
  const settings = resolveSettings(options);
  const startedWall = Date.now();
  // SSRF protection: the address is checked before the browser opens anything.
  const verdict = await settings.guard.check(url);
  if (!verdict.allowed) {
    const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
    const capture = notAllowedCapture('cloudflare-browser-run', environment, url, describeRejection(verdict), 'cdp-events');
    return { capture, stats: { events: 0, emulationFailed: [], wallMs: Date.now() - startedWall } };
  }
  // The redirect check needs no browser: it runs with fetch while the page loads.
  const httpUrl = settings.httpProbe ? httpVariantOf(url) : null;
  const probe: Promise<HttpProbe | null> | null =
    httpUrl === null
      ? null
      : probeHttpRedirect(httpUrl, {
          userAgent: cloudEnvironment(chromeVersionOf(await browser.version())).userAgent,
          acceptLanguage: CAPTURE_SETTINGS.acceptLanguage,
          guard: settings.guard,
        }).catch(() => null);
  // Session fix-a2: an address entered with http:// gets one request to its https:// address, so the report
  // says "ohne HTTPS" only after https:// was asked.
  const httpsUrl = settings.httpProbe ? httpsVariantOf(url) : null;
  const httpsProbe: Promise<HttpsProbe | null> | null =
    httpsUrl === null
      ? null
      : probeHttps(httpsUrl, {
          userAgent: cloudEnvironment(chromeVersionOf(await browser.version())).userAgent,
          acceptLanguage: CAPTURE_SETTINGS.acceptLanguage,
          guard: settings.guard,
        }).catch(() => null);
  // Windows the page opens itself never load (A5 review); the scanner's own pages are added below. A browser
  // shared by parallel scans has ONE popup guard with one set of own pages (A5 part 3): a guard per scan
  // would fail the main document of the other scan's tab as a foreign window.
  const shared = options.popupGuard ?? null;
  const browserSession = shared === null ? await browser.target().createCDPSession() : null;
  const ownTargets = shared?.ownTargets ?? new Set<string>();
  const popups = shared?.state ?? (await installPopupGuard(browserSession as NonNullable<typeof browserSession>, ownTargets));
  const popupsBefore = popups.blocked.length;
  const context = await browser.createBrowserContext();
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void context.close().catch(() => undefined);
  }, settings.hardLimitMs);
  try {
    const { page, ...result } = await runCapture(browser, context, url, settings, () => hardLimitHit, startedWall, ownTargets);
    // The homepage is done: its hard limit no longer applies (the Impressum tab has its own), and its tab is
    // closed before the Impressum opens, so its late requests cost no more events (session A5 part 3).
    clearTimeout(hardTimer);
    await page.close().catch(() => undefined);
    result.stats.homepageMs = Date.now() - startedWall;
    const capture = result.capture;
    if (settings.impressum && !hardLimitHit && capture.ok && capture.page !== null) {
      const target = chooseImpressumTarget(capture.page.links, capture.page.url ?? capture.finalUrl);
      if (target.action === 'open') {
        const opened = Date.now();
        // A tab that fails while it is created or prepared fails only the Impressum (finding 100); a lost browser still
        // fails the whole capture below (`assertConnected`).
        capture.impressum = await captureImpressumTabCdp(context, target.url, {
          guard: settings.guard,
          ownTargets,
          userAgent: capture.environment.userAgent,
          homepageStartedAt: Date.parse(capture.startedAt),
        }).catch((error: unknown) => failedImpressumTab(target.url, error, opened, Date.parse(capture.startedAt)));
        result.stats.impressumMs = capture.impressum.timings.totalMs;
      } else {
        capture.impressum = null;
      }
    }
    if (settings.visit !== null) capture.visit = settings.visit;
    result.stats.wallMs = Date.now() - startedWall;
    // With parallel scans in one browser this counts the windows refused during this scan, of any tab.
    result.stats.popupsBlocked = popups.blocked.length - popupsBefore;
    if (probe !== null) {
      const waitStarted = Date.now();
      result.capture.httpProbe = await probe;
      result.stats.probeWaitMs = Date.now() - waitStarted;
    }
    if (httpsProbe !== null) result.capture.httpsProbe = await httpsProbe;
    // A browser lost on the way (also during the Impressum tab) makes the whole capture an error, not a report.
    assertConnected(browser);
    // Session fix-a4: whatever the page sent, the capture leaves the adapter within the limits.
    result.capture = limitCapture(result.capture);
    return result;
  } finally {
    clearTimeout(hardTimer);
    await context.close().catch(() => undefined);
    await browserSession?.detach().catch(() => undefined);
  }
}

async function runCapture(
  browser: Browser,
  context: BrowserContext,
  url: string,
  settings: CloudSettings,
  hardLimitHit: () => boolean,
  contextStarted: number,
  ownTargets: Set<string>,
): Promise<CloudCaptureResult & { page: Page }> {
  const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
  const page = await context.newPage();
  const client = await clientOf(page);
  // Console and browser log entries are never read; a page that fails a socket or logs in a loop would send one
  // message each (session fix-a5: half of 668,000 messages of a WebSocket flood). Puppeteer enabled the domain.
  await client.send('Log.disable').catch(() => undefined);
  const own = (await client.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } };
  ownTargets.add(own.targetInfo.targetId);
  const emulationFailed = await prepareVisitorPage(page, client, environment.userAgent);
  await page.evaluateOnNewDocument(buildBannerProbeScript(settings.tools));
  // Every document request of the main frame waits for the SSRF guard (redirects and later
  // navigations included), on a session of its own so Puppeteer's network handling is untouched.
  const guardSession = await page.createCDPSession();
  const navigation = await installNavigationGuard(guardSession, settings.guard);
  const mainFrame = page.mainFrame();

  let t0 = Date.now();
  const rel = (): number => Math.max(0, Date.now() - t0);
  const records: CapturedRequest[] = [];
  // Which document made each request is decided at the end (`resolveFrames`): the event does not always know it.
  const frameSources: FrameSource[] = [];
  const workerScripts = new Map<CDPSession, string>();
  page.on('workercreated', (worker) => {
    workerScripts.set(worker.client, worker.url());
  });
  const byRequest = new Map<HTTPRequest, CapturedRequest>();
  const inflight = new Set<HTTPRequest>();
  // Session fix-a4: a page may make only so many requests with so much address text. One more, and nothing
  // further is kept and the tab is closed at once, so its events stop costing memory and CPU of the object
  // that also runs other visitors' scans. The capture then fails with `page-limit`.
  const budget = new RequestBudget();
  // How many strings of the page were cut to their limit while recording (`Capture.limited`).
  const cut = { strings: 0 };
  const keep = (record: CapturedRequest): boolean => {
    if (budget.add(record)) {
      records.push(record);
      return true;
    }
    void context.close().catch(() => undefined);
    return false;
  };
  let events = 0;
  let lastActivity = 0;
  let domContentLoadedMs: number | null = null;
  let loadMs: number | null = null;
  let crashed = false;
  const mainResponses: HTTPResponse[] = [];

  page.on('domcontentloaded', () => {
    domContentLoadedMs ??= rel();
  });
  page.on('load', () => {
    loadMs ??= rel();
  });
  page.on('error', () => {
    crashed = true;
  });
  page.on('request', (request) => {
    events += 1;
    if (budget.exceeded !== null) return;
    const frame = frameOf(request);
    const chain = request.redirectChain();
    const cdpInitiator = request.initiator() as (CdpInitiator & { requestId?: string }) | undefined;
    const frames = frame === null ? { urls: [], complete: false } : frameChain(frame, mainFrame, request.isNavigationRequest());
    // Addresses are kept cut to their limit: the page chooses how long they are.
    const record: CapturedRequest = limitRequest({
      seq: records.length,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startMs: rel(),
      endMs: null,
      status: null,
      failure: null,
      isMainFrame: frame === mainFrame,
      frameUrls: frames.urls,
      isNavigation: request.isNavigationRequest(),
      initiator: cdpInitiator === undefined ? null : toInitiator(cdpInitiator),
      redirectedFrom: chain.length > 0 ? (chain[chain.length - 1]?.url() ?? null) : null,
    }, cut);
    if (!keep(record)) return;
    frameSources.push({
      record,
      frame,
      requestId: request.id,
      preflightOf: frame === null && cdpInitiator?.type === 'preflight' ? (cdpInitiator.requestId ?? null) : null,
      workerUrl: frame === null ? (workerScripts.get(request.client) ?? null) : null,
      placed: frames.complete,
    });
    byRequest.set(request, record);
    if (!LONG_LIVED_RESOURCE_TYPES.has(record.resourceType)) inflight.add(request);
    lastActivity = record.startMs;
  });
  page.on('response', (response) => {
    events += 1;
    const request = response.request();
    const record = byRequest.get(request);
    const status = response.status();
    if (record !== undefined) record.status = status;
    const isRedirect = status >= 300 && status < 400;
    if (!isRedirect && request.isNavigationRequest() && frameOf(request) === mainFrame) mainResponses.push(response);
  });
  // A finished request is no longer held (only navigation requests are read again for the redirect chain),
  // so the browser's own record of it, with its full address, can be freed.
  const forget = (request: HTTPRequest): void => {
    if (!request.isNavigationRequest()) byRequest.delete(request);
  };
  page.on('requestfinished', (request) => {
    events += 1;
    const record = byRequest.get(request);
    if (record !== undefined) record.endMs = rel();
    forget(request);
    inflight.delete(request);
    lastActivity = rel();
  });
  page.on('requestfailed', (request) => {
    events += 1;
    const record = byRequest.get(request);
    if (record !== undefined) {
      record.endMs = rel();
      record.failure = (request.failure()?.errorText ?? 'failed').slice(0, 300);
    }
    forget(request);
    inflight.delete(request);
    lastActivity = rel();
  });
  // WebSockets of the top-level page (Puppeteer has no request events for them).
  const sockets = new Map<string, CapturedRequest>();
  client.on('Network.webSocketCreated', (event: { requestId: string; url: string }) => {
    events += 1;
    if (budget.exceeded !== null) return;
    const record: CapturedRequest = limitRequest({
      seq: records.length,
      url: event.url,
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
    }, cut);
    if (!keep(record)) return;
    sockets.set(event.requestId, record);
    lastActivity = record.startMs;
  });
  client.on('Network.webSocketHandshakeResponseReceived', (event: { requestId: string; response: { status: number } }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) record.status = event.response.status;
  });
  client.on('Network.webSocketFrameError', (event: { requestId: string; errorMessage: string }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) record.failure ??= String(event.errorMessage).slice(0, 300);
  });
  client.on('Network.webSocketClosed', (event: { requestId: string }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) {
      record.endMs ??= rel();
      return;
    }
    // A socket that was never created (refused by Chromium's limit): an attempt of the page all the same.
    events += 1;
    if (budget.exceeded === null && !budget.attempt()) void context.close().catch(() => undefined);
  });

  const startedAt = new Date().toISOString();
  t0 = Date.now();
  let navigationError: string | null = null;
  try {
    const result = (await withTimeout(client.send('Page.navigate', { url }), settings.maxWaitMs)) as { errorText?: string };
    if (result.errorText) navigationError = result.errorText;
  } catch (error) {
    navigationError = hardLimitHit() ? 'Timeout: hard limit for one page reached' : errorText(error);
  }

  let stopReason: CaptureTimings['stopReason'] = 'error';
  let networkQuietMs: number | null = null;
  if (navigationError === null) {
    stopReason = 'max-wait';
    let lastCommandMs = rel();
    for (;;) {
      if (crashed || hardLimitHit() || budget.exceeded !== null || page.isClosed() || !browser.connected) {
        stopReason = 'error';
        break;
      }
      const now = rel();
      if (networkQuietNow({ nowMs: now, loadMs, inflight: inflight.size, lastActivityMs: lastActivity }, settings)) {
        stopReason = 'network-quiet';
        networkQuietMs = lastActivity;
        break;
      }
      if (now >= settings.maxWaitMs) break;
      // Browser Run closes a browser that receives no command for its idle timeout (10 s in the
      // lab); waiting for a quiet network sends none, so send a harmless one every few seconds.
      if (now - lastCommandMs >= KEEP_ALIVE_PING_MS) {
        lastCommandMs = now;
        await client.send('Runtime.evaluate', { expression: '0', returnByValue: true }).catch(() => undefined);
      }
      await sleep(100);
    }
  }

  assertConnected(browser);
  const mainResponse = mainResponses.at(-1) ?? null;
  const headers: Record<string, string> = mainResponse === null ? {} : lowerCase(mainResponse.headers());
  let snapshot: SnapshotResult | null = null;
  if (navigationError === null && !hardLimitHit() && !crashed && budget.exceeded === null) {
    // The answer is checked field by field and cut to the limits before anything uses it (session fix-a4).
    snapshot = await withTimeout(
      client.send('Runtime.evaluate', { expression: SNAPSHOT_EXPRESSION, returnByValue: true }) as Promise<{ result: { value?: unknown } }>,
      4_000,
    )
      .then((response) => limitSnapshot(response.result.value))
      .catch(() => null);
    // The data must come from a document the guard allows (second line of defence).
    if (snapshot !== null && !(await checkReadDocument(navigation, settings.guard, snapshot.url ?? page.url()))) snapshot = null;
  }
  assertConnected(browser);
  const refused = navigation.blocked[0];
  // Session fix-a1: a capture cut off after the main document answered (the hard limit, a crashed or closed
  // tab) recorded only a part of what the page does. It is a failed capture, never a page without findings.
  // A page that only could not be read (the snapshot failed on an open tab) is not cut off: its requests are complete.
  const tabGone = hardLimitHit() ? 'hard-limit' : crashed ? 'crashed' : page.isClosed() || stopReason === 'error' ? 'closed' : null;
  const cutOff = navigationError === null && (stopReason === 'error' || snapshot === null) ? tabGone : null;
  let failure: CaptureFailure | null =
    refused !== undefined
      ? { reason: 'not-allowed' as const, message: navigationBlockMessage(refused) }
      : budget.exceeded !== null
        ? pageLimitFailure(budget.exceeded)
      : cutOff !== null
        ? interruptedFailure(cutOff)
        : failureOf(navigationError, mainResponse === null ? null : { status: mainResponse.status(), headers }, snapshot, records.length);
  // axe only on a page that was captured: an error page, a check page or a timeout costs no browser time.
  let axe: AxeCapture | null = null;
  if (settings.axeSource !== null) {
    const budget = axeBudgetMs(Date.now() - contextStarted, settings.hardLimitMs);
    if (failure !== null || snapshot === null || hardLimitHit() || crashed || page.isClosed())
      axe = axeNotRun('skipped', failure === null ? 'the page did not load' : `the page was not captured (${failure.reason})`);
    else if (budget === 0) axe = axeNotRun('skipped', 'no time left before the hard limit of the page');
    else {
      // Session fix-a2: axe reads only a document the guard allows. The tab may show another document than
      // the one of the snapshot by now (a navigation to a prefetched address sends no request the guard sees),
      // so the run is bracketed by the browser's identity of the document and dropped when it changed.
      const source = settings.axeSource;
      const checked = await readCheckedDocument(guardSession, navigation, settings.guard, () => runAxeOverCdp(client, source, budget));
      axe = checked.ok ? checked.value : axeNotRun('error', `the accessibility check was dropped: ${AXE_DROPPED[checked.reason]}`);
    }
  }
  // A document the guard refuses, found in the tab after the snapshot, fails the capture like a refused navigation.
  const refusedLate = navigation.blocked[0];
  if (failure === null && refusedLate !== undefined) {
    failure = { reason: 'not-allowed' as const, message: navigationBlockMessage(refusedLate) };
    if (axe !== null) axe = axeNotRun('skipped', 'the page was not captured (not-allowed)');
  }
  // Lab only: the cost of reading element positions for "Feld B2" (not part of the capture).
  const fieldPositions = settings.measureFieldPositions && failure === null && snapshot !== null && !hardLimitHit() && !crashed && !page.isClosed() ? await measureFieldPositions(client, axe, settings.hardLimitMs - (Date.now() - contextStarted) - 1_000) : undefined;
  const endMs = rel();

  const finalUrl = mainResponse?.url() ?? null;
  const redirectChain: RedirectHop[] = [];
  for (const response of mainResponses) {
    for (const hop of response.request().redirectChain()) {
      redirectChain.push({ url: hop.url(), status: byRequest.get(hop)?.status ?? hop.response()?.status() ?? 0 });
    }
    if (response !== mainResponse) redirectChain.push({ url: response.url(), status: response.status() });
  }

  // The probe uses the browser's clock; the first main document request starts at about the
  // browser's navigation start (`timeOrigin`).
  const firstDocument = records.find((r) => r.isMainFrame && r.isNavigation);
  const toCaptureMs = (epochMs: number): number =>
    snapshot?.timeOrigin !== undefined ? epochMs - snapshot.timeOrigin + (firstDocument?.startMs ?? 0) : epochMs - t0;

  const frames = resolveFrames(frameSources, mainFrame);
  const capture: Capture = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    adapter: 'cloudflare-browser-run',
    strategy: 'cdp-events',
    environment,
    requestedUrl: url,
    startedAt,
    ok: failure === null,
    failure,
    finalUrl,
    mainDocument: mainResponse === null ? null : { status: mainResponse.status(), headers, redirectChain },
    // A copy: the tab may still report late requests until the caller closes it.
    requests: records.map((r) => ({ ...r, frameUrls: [...r.frameUrls], initiator: r.initiator === null ? null : { ...r.initiator } })),
    page: pageSnapshotOf(snapshot),
    consentBanner: bannerObservation(snapshot, toCaptureMs),
    axe,
    timings: { domContentLoadedMs, loadMs, networkQuietMs, endMs, stopReason },
    ...(cut.strings > 0 ? { limited: { strings: cut.strings } } : {}),
  };
  return { page, capture, stats: { events, emulationFailed, wallMs: 0, framesPlacedLate: frames.late, framesUnknown: frames.unknown, ...(fieldPositions !== undefined ? { fieldPositions } : {}) } };
}

function lowerCase(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}
