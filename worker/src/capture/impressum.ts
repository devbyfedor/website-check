import type { BrowserContext, HTTPResponse } from '@cloudflare/puppeteer';
import {
  CAPTURE_LIMITS,
  checkReadDocument,
  classifyMainDocument,
  classifyNavigationError,
  IMPRESSUM_SETTINGS,
  IMPRESSUM_SNAPSHOT_EXPRESSION,
  installNavigationGuard,
  limitPageSnapshot,
  navigationBlockMessage,
  pageEvidenceOf,
  pageLimitFailure,
  pollText,
  TEXT_PROGRESS_EXPRESSION,
  type CaptureFailure,
  type ImpressumCapture,
  type NavigationGuardState,
  type PageSnapshot,
  type TextProgress,
  type TextWatch,
  type UrlGuard,
} from '@website-check/scanner';
import { clientOf, prepareVisitorPage } from './cdp-events.ts';
import { errorText, sleep, withTimeout } from './common.ts';

/**
 * The Impressum in a second tab of the same browser context (session A5 part 3), as the local adapter does
 * since A4: the same unconsented visit, the same visitor settings, the same SSRF protection as the homepage
 * (the navigation guard pauses every document request of the tab's main frame before it is sent, and the
 * document the text was read from must pass the guard too), the same wait (`IMPRESSUM_SETTINGS`: DOMContentLoaded,
 * then only until the text keeps its length) and the same snapshot. No axe, no request analysis, no interaction.
 *
 * `ownTargets` is the set of the popup guard: the tab is the scanner's own window, so its document may load.
 */
export async function captureImpressumTabCdp(
  context: BrowserContext,
  url: string,
  options: { guard: UrlGuard; ownTargets: Set<string>; userAgent: string; homepageStartedAt: number },
): Promise<ImpressumCapture> {
  const opened = Date.now();
  const since = (): number => Math.max(0, Date.now() - opened);
  let navigation: NavigationGuardState | null = null;
  let requestCount = 0;
  let domContentLoadedMs: number | null = null;
  let response: HTTPResponse | null = null;
  let navigationError: string | null = null;
  let stopReason: ImpressumCapture['timings']['stopReason'] = 'error';
  let snapshot: PageSnapshot | null = null;
  let snapshotMs: number | null = null;
  let hardLimitHit = false;
  let overLimit = false;
  const page = await context.newPage();
  const hardTimer = setTimeout(() => {
    hardLimitHit = true;
    void page.close().catch(() => undefined);
  }, IMPRESSUM_SETTINGS.hardLimitMs);
  try {
    const client = await clientOf(page);
    const own = (await client.send('Target.getTargetInfo')) as { targetInfo: { targetId: string } };
    options.ownTargets.add(own.targetInfo.targetId);
    await prepareVisitorPage(page, client, options.userAgent);
    try {
      navigation = await installNavigationGuard(await page.createCDPSession(), options.guard);
    } catch {
      navigation = null;
    }
    page.on('request', () => {
      requestCount += 1;
      // Session fix-a4: a tab that makes more requests than a page may is closed at once.
      if (requestCount > CAPTURE_LIMITS.maxRequests && !overLimit) {
        overLimit = true;
        void page.close().catch(() => undefined);
      }
    });
    page.on('domcontentloaded', () => {
      domContentLoadedMs ??= since();
    });
    try {
      // Never navigate without the guard.
      if (navigation === null) throw new Error('SSRF guard not installed');
      response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: IMPRESSUM_SETTINGS.navigationTimeoutMs });
      if (response === null) navigationError = 'navigation returned no response';
    } catch (error) {
      navigationError = hardLimitHit ? 'Timeout: hard limit for the Impressum reached' : errorText(error);
    }
    if (navigationError === null) {
      const settleStart = Date.now();
      let watch: TextWatch = { length: -1, changedAtMs: 0 };
      for (;;) {
        if (hardLimitHit || page.isClosed()) break;
        const progress =
          ((await withTimeout(client.send('Runtime.evaluate', { expression: TEXT_PROGRESS_EXPRESSION, returnByValue: true }) as Promise<{ result?: { value?: TextProgress } }>, 2_000)
            .then((r) => r.result?.value ?? null)
            .catch(() => null)) as TextProgress | null) ?? { readyState: 'loading', length: 0 };
        const step = pollText(watch, progress.length, progress.readyState === 'complete', Date.now() - settleStart);
        watch = step.watch;
        if (step.done !== null) {
          stopReason = step.done;
          break;
        }
        await sleep(IMPRESSUM_SETTINGS.pollMs);
      }
      if (!hardLimitHit && !page.isClosed()) {
        snapshot = await withTimeout(client.send('Runtime.evaluate', { expression: IMPRESSUM_SNAPSHOT_EXPRESSION, returnByValue: true }) as Promise<{ result?: { value?: unknown } }>, 4_000)
          .then((r) => limitPageSnapshot(r.result?.value))
          .catch(() => null);
        if (snapshot !== null && navigation !== null && !(await checkReadDocument(navigation, options.guard, snapshot.url ?? page.url()))) snapshot = null;
        snapshotMs = since();
      }
    }
  } finally {
    clearTimeout(hardTimer);
    await page.close().catch(() => undefined);
  }
  const totalMs = since();
  const refused = navigation?.blocked[0];
  const main = response as HTTPResponse | null;
  let failure: CaptureFailure | null;
  if (navigation === null) failure = { reason: 'other', message: 'the SSRF guard could not be installed; the Impressum was not opened' };
  else if (refused !== undefined) failure = { reason: 'not-allowed', message: navigationBlockMessage(refused) };
  else if (overLimit) failure = pageLimitFailure('requests');
  else if (navigationError !== null) failure = { reason: classifyNavigationError(navigationError), message: navigationError };
  else if (main === null) failure = { reason: 'other', message: 'no Impressum response' };
  else if (snapshot === null) failure = { reason: hardLimitHit ? 'timeout' : 'other', message: 'the text of the Impressum could not be read' };
  else failure = classifyMainDocument(main.status(), lowerCase(main.headers()), snapshot.title, pageEvidenceOf(snapshot, requestCount));
  return {
    url,
    ok: failure === null,
    failure,
    finalUrl: main?.url() ?? null,
    status: main?.status() ?? null,
    page: failure?.reason === 'page-limit' ? null : snapshot,
    requestCount,
    timings: {
      openedAtMs: Math.max(0, opened - options.homepageStartedAt),
      domContentLoadedMs,
      snapshotMs,
      totalMs,
      stopReason: failure === null ? stopReason : 'error',
    },
  };
}

function lowerCase(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) result[name.toLowerCase()] = value;
  return result;
}
