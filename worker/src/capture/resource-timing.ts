import type { Browser, CDPSession, Target } from '@cloudflare/puppeteer';
import {
  buildBannerProbeScript,
  CAPTURE_SCHEMA_VERSION,
  chromeVersionOf,
  IN_PAGE_COLLECT_EXPRESSION,
  lowerCaseHeaders,
  requestsFromResourceTiming,
  RESOURCE_TIMING_INIT_SCRIPT,
  RESOURCE_TIMING_POLL_EXPRESSION,
  type Capture,
  type CaptureTimings,
  type DocumentResponse,
  type InPageCollectResult,
  type RedirectHop,
  type ResourceTimingPoll,
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
import { applyEmulation, frameEmulation, pageEmulation } from './emulation.ts';

/**
 * Strategy (b): collection inside the page with the Resource Timing API.
 *
 * The Worker opens its own tab through the browser protocol and enables only what it needs:
 * page lifecycle events, and interception of document responses (for the status, headers and
 * redirects of the main document). It never enables network events, so the browser sends
 * the Worker a few dozen messages per page instead of several per request. All requests come
 * back from the page in one call at the end. Limits: see `scanner/src/capture/resource-timing.ts`.
 */

const POLL_INTERVAL_MS = 250;

interface PausedRequest {
  requestId: string;
  frameId: string;
  resourceType: string;
  request: { url: string; method: string };
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
  responseErrorReason?: string;
}

interface Evaluated<T> {
  result: { value?: T };
  exceptionDetails?: unknown;
}

export async function captureWithResourceTiming(browser: Browser, url: string, options: CloudCaptureOptions = {}): Promise<CloudCaptureResult> {
  const settings = resolveSettings(options);
  const startedWall = Date.now();
  const context = await browser.createBrowserContext();
  const browserSession = await browser.target().createCDPSession();
  let targetId: string | null = null;
  let hardLimitHit = false;
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void context.close().catch(() => undefined);
  }, settings.hardLimitMs);
  try {
    const created = (await browserSession.send('Target.createTarget', { url: 'about:blank', browserContextId: context.id })) as { targetId: string };
    targetId = created.targetId;
    const id = targetId;
    const target: Target = await browser.waitForTarget((t) => (t as unknown as { _targetId?: string })._targetId === id, { timeout: 5_000 });
    const session = await target.createCDPSession();
    const result = await runCapture(browser, session, url, settings, () => hardLimitHit);
    result.stats.wallMs = Date.now() - startedWall;
    await session.detach().catch(() => undefined);
    return result;
  } finally {
    clearTimeout(hardTimer);
    if (targetId !== null) await browserSession.send('Target.closeTarget', { targetId }).catch(() => undefined);
    await context.close().catch(() => undefined);
    await browserSession.detach().catch(() => undefined);
  }
}

async function runCapture(browser: Browser, session: CDPSession, url: string, settings: CloudSettings, hardLimitHit: () => boolean): Promise<CloudCaptureResult> {
  const environment = cloudEnvironment(chromeVersionOf(await browser.version()));
  const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => session.send(method as never, params as never);
  let events = 0;
  let polls = 0;
  let crashed = false;
  let t0 = Date.now();
  const rel = (): number => Math.max(0, Date.now() - t0);

  // Main-frame documents (and redirect hops), from response interception.
  let mainFrameId = '';
  const documents: DocumentResponse[] = [];
  let lastDocumentStatus = 0;
  session.on('Fetch.requestPaused', (event: PausedRequest) => {
    events += 1;
    if (event.frameId === mainFrameId && event.resourceType === 'Document' && event.responseStatusCode !== undefined) {
      const previous = documents.at(-1);
      documents.push({
        url: event.request.url,
        method: event.request.method,
        status: event.responseStatusCode,
        headers: lowerCaseHeaders(event.responseHeaders),
        atMs: rel(),
        redirectedFrom: previous !== undefined && lastDocumentStatus >= 300 && lastDocumentStatus < 400 ? previous.url : null,
      });
      lastDocumentStatus = event.responseStatusCode;
    }
    void send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => undefined);
  });
  session.on('Page.loadEventFired', () => {
    events += 1;
  });
  session.on('Inspector.targetCrashed', () => {
    crashed = true;
  });
  // Out-of-process iframes: the same language, time zone and user agent as the page.
  const connection = session.connection();
  session.on('Target.attachedToTarget', (event: { sessionId: string; waitingForDebugger: boolean }) => {
    events += 1;
    const child = connection?.session(event.sessionId) ?? null;
    if (child === null) return;
    const childSend = (method: string, params: Record<string, unknown>): Promise<unknown> => child.send(method as never, params as never);
    void applyEmulation(childSend, frameEmulation(environment.userAgent)).then(() =>
      event.waitingForDebugger ? childSend('Runtime.runIfWaitingForDebugger', {}).catch(() => undefined) : undefined,
    );
  });

  await send('Page.enable');
  const tree = (await send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
  mainFrameId = tree.frameTree.frame.id;
  const emulationFailed = await applyEmulation(send, pageEmulation(environment.userAgent));
  await send('Network.setBypassServiceWorker', { bypass: true }).catch(() => emulationFailed.push('Network.setBypassServiceWorker'));
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }] });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => undefined);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `${buildBannerProbeScript(settings.tools)}\n${RESOURCE_TIMING_INIT_SCRIPT}` });

  const evaluate = async <T>(expression: string, timeoutMs: number): Promise<T | null> => {
    const response = (await withTimeout(send('Runtime.evaluate', { expression, returnByValue: true }), timeoutMs).catch(() => null)) as Evaluated<T> | null;
    return response?.result.value ?? null;
  };

  const startedAt = new Date().toISOString();
  t0 = Date.now();
  let navigationError: string | null = null;
  try {
    const result = (await withTimeout(send('Page.navigate', { url }), settings.maxWaitMs)) as { errorText?: string };
    if (result.errorText) navigationError = result.errorText;
  } catch (error) {
    navigationError = hardLimitHit() ? 'Timeout: hard limit for one page reached' : errorText(error);
  }

  let stopReason: CaptureTimings['stopReason'] = 'error';
  let networkQuietMs: number | null = null;
  if (navigationError === null) {
    stopReason = 'max-wait';
    for (;;) {
      if (crashed || hardLimitHit()) {
        stopReason = 'error';
        break;
      }
      const poll = await evaluate<ResourceTimingPoll>(RESOURCE_TIMING_POLL_EXPRESSION, 2_000);
      polls += 1;
      if (poll !== null && poll.loaded && poll.now - poll.lastActivity >= settings.quietWindowMs) {
        stopReason = 'network-quiet';
        networkQuietMs = poll.lastActivity;
        break;
      }
      if (rel() >= settings.maxWaitMs) break;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  let collected: InPageCollectResult | null = null;
  if (navigationError === null && !hardLimitHit() && !crashed) {
    collected = await evaluate<InPageCollectResult>(IN_PAGE_COLLECT_EXPRESSION, 4_000);
  }
  const workerEndMs = rel();
  const timing = collected?.timing ?? null;
  const snapshot = collected?.snapshot ?? null;

  const mainDocument = documents.filter((d) => d.status < 300 || d.status >= 400).at(-1) ?? null;
  const redirectChain: RedirectHop[] = documents.filter((d) => d !== mainDocument).map((d) => ({ url: d.url, status: d.status }));
  const requests = timing === null ? [] : requestsFromResourceTiming(documents, timing);
  const failure = failureOf(navigationError, mainDocument, snapshot);
  const nav = timing?.navigation ?? null;
  const positive = (n: number | undefined): number | null => (n !== undefined && n > 0 ? n : null);

  const capture: Capture = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    adapter: 'cloudflare-browser-run',
    strategy: 'resource-timing',
    environment,
    requestedUrl: url,
    startedAt,
    ok: failure === null,
    failure,
    finalUrl: mainDocument?.url ?? nav?.name ?? null,
    mainDocument: mainDocument === null ? null : { status: mainDocument.status, headers: mainDocument.headers, redirectChain },
    requests,
    page: pageSnapshotOf(snapshot),
    // Page times: ms since the navigation start of the final document.
    consentBanner: bannerObservation(snapshot, (epochMs) => epochMs - (timing?.timeOrigin ?? t0)),
    axe: null,
    timings: {
      domContentLoadedMs: positive(nav?.domContentLoadedEventStart),
      loadMs: positive(nav?.loadEventStart),
      networkQuietMs,
      endMs: timing?.now ?? workerEndMs,
      stopReason,
    },
  };
  return { capture, stats: { events, polls, emulationFailed, wallMs: 0 } };
}
