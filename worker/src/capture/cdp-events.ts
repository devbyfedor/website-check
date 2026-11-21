import type { Browser, BrowserContext, CDPSession, Frame, HTTPRequest, HTTPResponse, Page } from '@cloudflare/puppeteer';
import {
  buildBannerProbeScript,
  CAPTURE_SCHEMA_VERSION,
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
import { applyEmulation, pageEmulation, userAgentMetadataOf } from './emulation.ts';

/**
 * Strategy (a): request events through the browser protocol.
 *
 * Mirrors the local Playwright adapter with Puppeteer on Cloudflare Browser Run: a fresh
 * browser context per page (no cookies, no stored consent), no interaction, every request
 * recorded from the browser's network events until the network is quiet or at most
 * `maxWaitMs`. Puppeteer handles every network event in the Worker, which costs Worker CPU;
 * session A2 measures how much.
 */

/** Puppeteer's own session of a page. Internal API, so it falls back to a new session. */
async function clientOf(page: Page): Promise<CDPSession> {
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

export async function captureWithCdpEvents(browser: Browser, url: string, options: CloudCaptureOptions = {}): Promise<CloudCaptureResult> {
  const settings = resolveSettings(options);
  const startedWall = Date.now();
  const context = await browser.createBrowserContext();
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void context.close().catch(() => undefined);
  }, settings.hardLimitMs);
  try {
    const result = await runCapture(browser, context, url, settings, () => hardLimitHit);
    result.stats.wallMs = Date.now() - startedWall;
    return result;
  } finally {
    clearTimeout(hardTimer);
    await context.close().catch(() => undefined);
  }
}

async function runCapture(
  browser: Browser,
  context: BrowserContext,
  url: string,
  settings: CloudSettings,
  hardLimitHit: () => boolean,
): Promise<CloudCaptureResult> {
  const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
  const page = await context.newPage();
  const client = await clientOf(page);
  const userAgent = environment.userAgent;
  // Puppeteer applies these to out-of-process iframes too; the raw commands below then set the
  // top-level page exactly like Playwright does (language, client hints, screen, focus).
  await page.setUserAgent({ userAgent, userAgentMetadata: userAgentMetadataOf(userAgent) as never }).catch(() => undefined);
  await page.emulateTimezone(environment.timezoneId).catch(() => undefined);
  await page.setExtraHTTPHeaders({ 'Accept-Language': environment.locale }).catch(() => undefined);
  await page.setBypassServiceWorker(true).catch(() => undefined);
  const emulationFailed = await applyEmulation((method, params) => client.send(method as never, params as never), pageEmulation(userAgent));
  await page.evaluateOnNewDocument(buildBannerProbeScript(settings.tools));
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
  }
  const endMs = rel();

  const finalUrl = mainResponse?.url() ?? null;
  const redirectChain: RedirectHop[] = [];
  for (const response of mainResponses) {
    for (const hop of response.request().redirectChain()) {
      redirectChain.push({ url: hop.url(), status: byRequest.get(hop)?.status ?? hop.response()?.status() ?? 0 });
    }
    if (response !== mainResponse) redirectChain.push({ url: response.url(), status: response.status() });
  }

  const failure = failureOf(
    navigationError,
    mainResponse === null ? null : { status: mainResponse.status(), headers },
    snapshot?.title ?? '',
  );
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
    requests: records,
    page: pageSnapshotOf(snapshot),
    consentBanner: bannerObservation(snapshot, toCaptureMs),
    axe: null,
    timings: { domContentLoadedMs, loadMs, networkQuietMs, endMs, stopReason },
  };
  return { capture, stats: { events, polls: 0, emulationFailed, wallMs: 0 } };
}

function lowerCase(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}
