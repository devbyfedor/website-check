import { describeRejection, SSRF_LIMITS, type UrlGuard, type UrlRejection } from './ssrf.ts';

/**
 * The SSRF guard inside the browser (session A5), shared by the local Playwright adapter and the
 * Cloudflare adapter: both hand in a browser protocol (CDP) session of the page.
 *
 * It pauses every document request of the page's main frame before it is sent (`Fetch.enable`
 * with `resourceType: Document`, `requestStage: Request`) and lets it go only after the URL guard
 * accepted it. The browser protocol reports every hop of an HTTP redirect as a request of its own
 * ("Redirect responses and subsequent requests are reported similarly to regular responses and
 * requests", CDP Fetch domain), and a navigation started by the page (meta refresh, script) is a
 * new document request too, so the first address, every redirect and every later navigation of
 * the main frame are checked. A refused request fails with `BlockedByClient`: nothing is sent.
 * Navigations after the first count as redirects; the sixth is refused.
 *
 * Documents of iframes, and subresources, are not paused (see `docs/decisions.md`, A5).
 */

/** The part of a CDP session the guard needs (Playwright's `CDPSession` and Puppeteer's both fit). */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event payloads differ per library
  on(event: string, listener: (params: any) => void): unknown;
}

export interface NavigationBlock {
  url: string;
  rejection: UrlRejection | 'too-many-redirects';
  detail: string;
}

export interface NavigationGuardState {
  /** Main-frame document requests seen (the first navigation and every redirect or later navigation). */
  navigations: number;
  /** Refused navigations, in order. */
  blocked: NavigationBlock[];
  /** Requests the guard could not answer (a closed page); for debugging. */
  errors: number;
}

interface RequestPaused {
  requestId: string;
  frameId?: string;
  resourceType?: string;
  request: { url: string };
  responseStatusCode?: number;
  responseErrorReason?: string;
}

export interface NavigationGuardOptions {
  maxRedirects?: number;
}

/**
 * Installs the guard on a page that has not navigated yet. Resolves once interception is on; the
 * returned state fills while the page loads.
 */
export async function installNavigationGuard(session: CdpSessionLike, guard: UrlGuard, options: NavigationGuardOptions = {}): Promise<NavigationGuardState> {
  const maxRedirects = options.maxRedirects ?? SSRF_LIMITS.maxRedirects;
  const state: NavigationGuardState = { navigations: 0, blocked: [], errors: 0 };
  const tree = (await session.send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
  const mainFrameId = tree.frameTree.frame.id;
  const answer = (method: string, params: Record<string, unknown>): void => {
    void session.send(method, params).catch(() => {
      state.errors += 1;
    });
  };
  session.on('Fetch.requestPaused', async (event: RequestPaused) => {
    const isResponse = event.responseStatusCode !== undefined || event.responseErrorReason !== undefined;
    if (isResponse || event.frameId !== mainFrameId || event.resourceType !== 'Document') {
      answer('Fetch.continueRequest', { requestId: event.requestId });
      return;
    }
    state.navigations += 1;
    const url = event.request.url;
    if (state.navigations - 1 > maxRedirects) {
      state.blocked.push({ url, rejection: 'too-many-redirects', detail: `more than ${maxRedirects} redirects or navigations of the main document` });
      answer('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      return;
    }
    let verdict;
    try {
      verdict = await guard.check(url);
    } catch (error) {
      verdict = { allowed: false as const, url, rejection: 'dns-error' as const, detail: error instanceof Error ? error.message.slice(0, 200) : 'check failed' };
    }
    if (verdict.allowed) {
      answer('Fetch.continueRequest', { requestId: event.requestId });
      return;
    }
    state.blocked.push({ url, rejection: verdict.rejection, detail: describeRejection(verdict) });
    answer('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
  });
  await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
  return state;
}

/** The capture failure message for the first refused navigation. */
export function navigationBlockMessage(block: NavigationBlock): string {
  return block.rejection === 'too-many-redirects' ? `not allowed: too-many-redirects (${block.detail})` : block.detail;
}
