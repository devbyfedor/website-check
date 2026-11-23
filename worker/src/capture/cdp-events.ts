import { CDPSessionEvent, type Browser, type BrowserContext, type CDPSession, type Frame, type HTTPRequest, type HTTPResponse, type Page } from '@cloudflare/puppeteer';
import {
  AXE_RUN_EXPRESSION,
  axeBudgetMs,
  axeCaptureFrom,
  axeNotRun,
  buildBannerProbeScript,
  CAPTURE_SCHEMA_VERSION,
  checkReadDocument,
  describeRejection,
  httpVariantOf,
  installNavigationGuard,
  installPopupGuard,
  navigationBlockMessage,
  notAllowedCapture,
  probeHttpRedirect,
  type AxeCapture,
  type HttpProbe,
  CAPTURE_SETTINGS,
  chooseImpressumTarget,
  chromeVersionOf,
  LONG_LIVED_RESOURCE_TYPES,
  SNAPSHOT_EXPRESSION,
  toInitiator,
  type Capture,
  type CapturedRequest,
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
import { captureImpressumTabCdp } from './impressum.ts';

/**
 * Strategy (a): request events through the browser protocol.
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

/**
 * Sets up a Puppeteer page as the same visitor as the local Playwright adapter, in every frame:
 * Puppeteer's own user agent override (applied to every frame session, out-of-process iframes
 * included) carries the language and the platform; time zone and locale go to the page through
 * Puppeteer and to every iframe session as soon as it attaches, before Puppeteer resumes it.
 * Returns the browser protocol commands that failed.
 */
export async function prepareVisitorPage(page: Page, client: CDPSession, userAgent: string): Promise<string[]> {
  const failed: string[] = [];
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
  const started = Date.now();
  const elapsed = (): number => Date.now() - started;
  let injectMs: number | null = null;
  try {
    const injected = (await withTimeout(client.send('Runtime.evaluate', { expression: axeSource, returnByValue: true }), budgetMs)) as { exceptionDetails?: { text?: string } };
    injectMs = elapsed();
    if (injected.exceptionDetails !== undefined) return axeNotRun('error', `injecting axe-core failed: ${injected.exceptionDetails.text ?? 'exception'}`, { injectMs, totalMs: elapsed() });
    const left = budgetMs - injectMs;
    if (left < 300) return axeNotRun('timeout', 'no time left after injecting axe-core', { injectMs, totalMs: elapsed() });
    const response = (await withTimeout(client.send('Runtime.evaluate', { expression: AXE_RUN_EXPRESSION, awaitPromise: true, returnByValue: true }), left)) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string };
    };
    if (response.exceptionDetails !== undefined) return axeNotRun('error', `axe failed: ${response.exceptionDetails.text ?? 'exception'}`, { injectMs, totalMs: elapsed() });
    return axeCaptureFrom(response.result?.value, { injectMs, totalMs: elapsed() });
  } catch (error) {
    const message = errorText(error);
    return axeNotRun(/^Timeout \d+ ms exceeded/.test(message) ? 'timeout' : 'error', message, { injectMs, totalMs: elapsed() });
  }
}

export async function captureWithCdpEvents(browser: Browser, url: string, options: CloudCaptureOptions = {}): Promise<CloudCaptureResult> {
  const settings = resolveSettings(options);
  const startedWall = Date.now();
  // SSRF protection: the address is checked before the browser opens anything.
  const verdict = await settings.guard.check(url);
  if (!verdict.allowed) {
    const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
    const capture = notAllowedCapture('cloudflare-browser-run', environment, url, describeRejection(verdict), 'cdp-events');
    return { capture, stats: { events: 0, polls: 0, emulationFailed: [], wallMs: Date.now() - startedWall } };
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
  // Windows the page opens itself never load (A5 review); the scanner's own page is added below.
  const browserSession = await browser.target().createCDPSession();
  const ownTargets = new Set<string>();
  const popups = await installPopupGuard(browserSession, ownTargets);
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
        capture.impressum = await captureImpressumTabCdp(context, target.url, {
          guard: settings.guard,
          ownTargets,
          userAgent: capture.environment.userAgent,
          homepageStartedAt: Date.parse(capture.startedAt),
        });
        result.stats.impressumMs = capture.impressum.timings.totalMs;
      } else {
        capture.impressum = null;
      }
    }
    if (settings.visit !== null) capture.visit = settings.visit;
    result.stats.wallMs = Date.now() - startedWall;
    result.stats.popupsBlocked = popups.blocked.length;
    if (probe !== null) {
      const waitStarted = Date.now();
      result.capture.httpProbe = await probe;
      result.stats.probeWaitMs = Date.now() - waitStarted;
    }
    return result;
  } finally {
    clearTimeout(hardTimer);
    await context.close().catch(() => undefined);
    await browserSession.detach().catch(() => undefined);
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
  const own = (await client.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } };
  ownTargets.add(own.targetInfo.targetId);
  const emulationFailed = await prepareVisitorPage(page, client, environment.userAgent);
  await page.evaluateOnNewDocument(buildBannerProbeScript(settings.tools));
  // Every document request of the main frame waits for the SSRF guard (redirects and later
  // navigations included), on a session of its own so Puppeteer's network handling is untouched.
  const navigation = await installNavigationGuard(await page.createCDPSession(), settings.guard);
  const mainFrame = page.mainFrame();

  let t0 = Date.now();
  const rel = (): number => Math.max(0, Date.now() - t0);
  const records: CapturedRequest[] = [];
  const byRequest = new Map<HTTPRequest, CapturedRequest>();
  const inflight = new Set<HTTPRequest>();
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
    const frame = frameOf(request);
    const chain = request.redirectChain();
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
      initiator: (() => {
        const initiator = request.initiator() as CdpInitiator | undefined;
        return initiator === undefined ? null : toInitiator(initiator);
      })(),
      redirectedFrom: chain.length > 0 ? (chain[chain.length - 1]?.url() ?? null) : null,
    };
    records.push(record);
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
  page.on('requestfinished', (request) => {
    events += 1;
    const record = byRequest.get(request);
    if (record !== undefined) record.endMs = rel();
    inflight.delete(request);
    lastActivity = rel();
  });
  page.on('requestfailed', (request) => {
    events += 1;
    const record = byRequest.get(request);
    if (record !== undefined) {
      record.endMs = rel();
      record.failure = request.failure()?.errorText ?? 'failed';
    }
    inflight.delete(request);
    lastActivity = rel();
  });
  // WebSockets of the top-level page (Puppeteer has no request events for them).
  const sockets = new Map<string, CapturedRequest>();
  client.on('Network.webSocketCreated', (event: { requestId: string; url: string }) => {
    events += 1;
    const record: CapturedRequest = {
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
    };
    records.push(record);
    sockets.set(event.requestId, record);
    lastActivity = record.startMs;
  });
  client.on('Network.webSocketHandshakeResponseReceived', (event: { requestId: string; response: { status: number } }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) record.status = event.response.status;
  });
  client.on('Network.webSocketFrameError', (event: { requestId: string; errorMessage: string }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) record.failure ??= event.errorMessage;
  });
  client.on('Network.webSocketClosed', (event: { requestId: string }) => {
    const record = sockets.get(event.requestId);
    if (record !== undefined) record.endMs ??= rel();
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
      // Browser Run closes a browser that receives no command for its idle timeout (10 s in the
      // lab); waiting for a quiet network sends none, so send a harmless one every few seconds.
      if (now - lastCommandMs >= KEEP_ALIVE_PING_MS) {
        lastCommandMs = now;
        await client.send('Runtime.evaluate', { expression: '0', returnByValue: true }).catch(() => undefined);
      }
      await sleep(100);
    }
  }

  const mainResponse = mainResponses.at(-1) ?? null;
  const headers: Record<string, string> = mainResponse === null ? {} : lowerCase(mainResponse.headers());
  let snapshot: SnapshotResult | null = null;
  if (navigationError === null && !hardLimitHit() && !crashed) {
    snapshot = await withTimeout(
      client.send('Runtime.evaluate', { expression: SNAPSHOT_EXPRESSION, returnByValue: true }) as Promise<{ result: { value?: SnapshotResult } }>,
      4_000,
    )
      .then((response) => response.result.value ?? null)
      .catch(() => null);
    // The data must come from a document the guard allows (second line of defence).
    if (snapshot !== null && !(await checkReadDocument(navigation, settings.guard, snapshot.url ?? page.url()))) snapshot = null;
  }
  const refused = navigation.blocked[0];
  const failure =
    refused !== undefined
      ? { reason: 'not-allowed' as const, message: navigationBlockMessage(refused) }
      : failureOf(navigationError, mainResponse === null ? null : { status: mainResponse.status(), headers }, snapshot, records.length);
  // axe only on a page that was captured: an error page, a check page or a timeout costs no browser time.
  let axe: AxeCapture | null = null;
  if (settings.axeSource !== null) {
    const budget = axeBudgetMs(Date.now() - contextStarted, settings.hardLimitMs);
    if (failure !== null || snapshot === null || hardLimitHit() || crashed || page.isClosed())
      axe = axeNotRun('skipped', failure === null ? 'the page did not load' : `the page was not captured (${failure.reason})`);
    else if (budget === 0) axe = axeNotRun('skipped', 'no time left before the hard limit of the page');
    else axe = await runAxeOverCdp(client, settings.axeSource, budget);
  }
  // Lab only: the cost of reading element positions for "Feld B2" (not part of the capture).
  const fieldPositions = settings.measureFieldPositions && failure === null && snapshot !== null && !hardLimitHit() && !crashed && !page.isClosed() ? await measureFieldPositions(client, axe) : undefined;
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
    requests: records.slice(),
    page: pageSnapshotOf(snapshot),
    consentBanner: bannerObservation(snapshot, toCaptureMs),
    axe,
    timings: { domContentLoadedMs, loadMs, networkQuietMs, endMs, stopReason },
  };
  return { page, capture, stats: { events, polls: 0, emulationFailed, wallMs: 0, ...(fieldPositions !== undefined ? { fieldPositions } : {}) } };
}

function lowerCase(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}
