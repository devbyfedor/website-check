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
  // A speculation-rules prerender would load in a target of its own and, once activated, replace
  // this page's main frame without a request this session sees (A5 review). No prerendering, then;
  // a browser that refuses the command fails the capture (unsure means refused).
  await session.send('Page.setPrerenderingAllowed', { isAllowed: false });
  await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
  return state;
}

/**
 * Second line of defence, after the page was read: the document the data came from (its
 * `location.href`) must pass the guard too. Records a block and returns false if it does not, so the
 * adapter drops the page's data instead of storing a document the request check did not see.
 */
export async function checkReadDocument(state: NavigationGuardState, guard: UrlGuard, url: string): Promise<boolean> {
  let verdict;
  try {
    verdict = await guard.check(url);
  } catch (error) {
    verdict = { allowed: false as const, url, rejection: 'dns-error' as const, detail: error instanceof Error ? error.message.slice(0, 200) : 'check failed' };
  }
  if (verdict.allowed) return true;
  state.blocked.push({ url, rejection: verdict.rejection, detail: `read document refused, ` });
  return false;
}

/** The document a tab shows, as the browser names it (not the page): a new document in the tab has a new loader id. */
export interface DocumentIdentity {
  frameId: string;
  loaderId: string;
  url: string;
}

/** The document the main frame of the session's page shows now, or null when the browser does not say. */
export async function currentDocument(session: CdpSessionLike): Promise<DocumentIdentity | null> {
  try {
    const tree = (await session.send('Page.getFrameTree')) as { frameTree?: { frame?: { id?: unknown; loaderId?: unknown; url?: unknown } } };
    const frame = tree.frameTree?.frame;
    if (frame === undefined || typeof frame.id !== 'string' || typeof frame.loaderId !== 'string' || typeof frame.url !== 'string') return null;
    return { frameId: frame.id, loaderId: frame.loaderId, url: frame.url };
  } catch {
    return null;
  }
}

export type CheckedRead<T> =
  | { ok: true; value: T }
  /** `refused`: the document in the tab does not pass the guard. `changed`: another document replaced it while it was read. */
  | { ok: false; reason: 'unknown-document' | 'refused' | 'changed' };

/**
 * Session fix-a2 (review of stage A): reads something from the page only out of a document the guard
 * allows. A navigation to an address the page prefetched with speculation rules sends no document request,
 * so the guard on requests does not see it, and a check of the address made once says nothing about the
 * document that is in the tab a moment later. So the read is bracketed by the browser's own identity of the
 * document: its address must pass the guard before, and it must still be the same document after; otherwise
 * the result is dropped. A new document that the guard refuses is recorded as a block, like a refused navigation.
 */
export async function readCheckedDocument<T>(session: CdpSessionLike, state: NavigationGuardState, guard: UrlGuard, read: () => Promise<T>): Promise<CheckedRead<T>> {
  const before = await currentDocument(session);
  if (before === null) return { ok: false, reason: 'unknown-document' };
  if (!(await checkReadDocument(state, guard, before.url))) return { ok: false, reason: 'refused' };
  const value = await read();
  const after = await currentDocument(session);
  if (after !== null && after.frameId === before.frameId && after.loaderId === before.loaderId) return { ok: true, value };
  if (after !== null) await checkReadDocument(state, guard, after.url);
  return { ok: false, reason: 'changed' };
}

/** The capture failure message for the first refused navigation. */
export function navigationBlockMessage(block: NavigationBlock): string {
  return block.rejection === 'too-many-redirects' ? `not allowed: too-many-redirects (${block.detail})` : block.detail;
}

export interface PopupGuardState {
  /** Top-level documents of windows the scanner did not open, refused before they were sent. */
  blocked: string[];
}

/**
 * Windows the page opens itself (`window.open`, links with `target=_blank`) are new top-level
 * documents in a target of their own, out of reach of the page's guard (A5 review: Chrome's popup
 * blocker is off in Puppeteer's and Playwright's default launch flags, and the flags of Browser Run
 * cannot be set). On a session of the browser target, `Fetch` pauses document requests of every
 * target; a document whose frame is the main frame of a page target the scanner did not create is
 * failed, and that window is closed. Iframes and the scanner's own pages are let through (the
 * page's own guard checks those).
 */
export async function installPopupGuard(browserSession: CdpSessionLike, ownTargets: ReadonlySet<string>): Promise<PopupGuardState> {
  const state: PopupGuardState = { blocked: [] };
  browserSession.on('Fetch.requestPaused', async (event: RequestPaused) => {
    const isResponse = event.responseStatusCode !== undefined || event.responseErrorReason !== undefined;
    let foreignPage = false;
    if (!isResponse && event.resourceType === 'Document' && event.frameId !== undefined && !ownTargets.has(event.frameId)) {
      // A frame id that is also a target id is the main frame of that target (or an out-of-process iframe).
      const info = (await browserSession.send('Target.getTargetInfo', { targetId: event.frameId }).catch(() => null)) as { targetInfo?: { type?: string } } | null;
      foreignPage = info?.targetInfo?.type === 'page';
    }
    if (!foreignPage) {
      void browserSession.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => undefined);
      return;
    }
    state.blocked.push(event.request.url);
    await browserSession.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }).catch(() => undefined);
    void browserSession.send('Target.closeTarget', { targetId: event.frameId }).catch(() => undefined);
  });
  await browserSession.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
  return state;
}