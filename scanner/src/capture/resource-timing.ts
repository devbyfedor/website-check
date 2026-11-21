import type { CapturedRequest } from './types.ts';

/**
 * Strategy (b) of the Cloudflare adapter collects the requests inside the page with the
 * Resource Timing API. This module turns what the page returns into the `CapturedRequest`
 * shape of the capture. Pure functions, no browser.
 *
 * What Resource Timing cannot tell (documented limits of strategy b):
 * - requests made inside iframes (each frame has its own timeline; only the iframe's own
 *   document load appears in the top-level timeline),
 * - requests that were still open at the end, WebSockets, and most failed requests,
 * - the HTTP method, the initiator and the redirect chain of sub-resources,
 * - documents of earlier main-frame navigations (client-side redirects reset the timeline).
 * Main-frame documents (status, headers, redirects) come from the browser separately.
 */

export interface ResourceTimingEntry {
  name: string;
  initiatorType: string;
  /** ms since `timeOrigin`, rounded */
  startTime: number;
  responseEnd: number;
  /** 0 when the browser does not expose the status */
  responseStatus: number;
  transferSize: number;
  decodedBodySize: number;
  nextHopProtocol: string;
}

export interface NavigationTimingEntry {
  name: string;
  startTime: number;
  fetchStart: number;
  responseEnd: number;
  domContentLoadedEventStart: number;
  loadEventStart: number;
  responseStatus: number;
  redirectCount: number;
  type: string;
}

export interface ResourceTimingData {
  /** Epoch ms of the navigation start of the final document. */
  timeOrigin: number;
  /** `performance.now()` when the data was read. */
  now: number;
  /** False if the collector script did not run (then only the browser buffer of at most 250 entries is read). */
  collector: boolean;
  navigation: NavigationTimingEntry | null;
  resources: ResourceTimingEntry[];
}

/** A main-frame document response, seen by the browser protocol (also redirect hops). */
export interface DocumentResponse {
  url: string;
  method: string;
  status: number;
  headers: Record<string, string>;
  /** Capture time in ms when the response arrived. */
  atMs: number;
  /** URL of the previous hop if this response follows an HTTP redirect. */
  redirectedFrom: string | null;
}

const FONT = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i;
const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#]|$)/i;
const STYLE = /\.css(?:[?#]|$)|^https?:\/\/fonts\.googleapis\.com\/css2?(?:[?#]|$)/i;
const SCRIPT = /\.m?js(?:[?#]|$)/i;

/** Maps a Resource Timing `initiatorType` (the element or API that loaded it) to a resource type. */
export function resourceTypeOf(initiatorType: string, url: string): string {
  switch (initiatorType) {
    case 'script':
      return 'script';
    case 'img':
    case 'image':
    case 'input':
    case 'body':
      return 'image';
    case 'iframe':
    case 'frame':
    case 'object':
    case 'embed':
      return 'document';
    case 'xmlhttprequest':
      return 'xhr';
    case 'fetch':
      return 'fetch';
    case 'beacon':
      return 'ping';
    case 'video':
    case 'audio':
    case 'track':
      return 'media';
    case 'css':
      // Loaded from a stylesheet: fonts, background images, @import.
      if (FONT.test(url)) return 'font';
      if (STYLE.test(url)) return 'stylesheet';
      return 'image';
    case 'link':
      if (STYLE.test(url)) return 'stylesheet';
      if (FONT.test(url)) return 'font';
      if (SCRIPT.test(url)) return 'script';
      if (IMAGE.test(url)) return 'image';
      return 'other';
    default:
      return 'other';
  }
}

const isHttp = (url: string): boolean => /^https?:/i.test(url);

/**
 * Builds the request list of a strategy (b) capture: main-frame documents first (in the order
 * they arrived), then every Resource Timing entry in start order. All times are page times
 * (ms since the navigation start), the same clock as `timing`.
 */
export function requestsFromResourceTiming(documents: readonly DocumentResponse[], timing: ResourceTimingData): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  const nav = timing.navigation;
  documents.forEach((doc, index) => {
    const isFinal = index === documents.length - 1;
    requests.push({
      seq: requests.length,
      url: doc.url,
      method: doc.method,
      resourceType: 'document',
      startMs: Math.max(0, Math.round(doc.atMs)),
      endMs: isFinal && nav !== null && nav.responseEnd > 0 ? nav.responseEnd : Math.max(0, Math.round(doc.atMs)),
      status: doc.status,
      failure: null,
      isMainFrame: true,
      frameUrls: [],
      isNavigation: true,
      initiator: null,
      redirectedFrom: doc.redirectedFrom,
    });
  });
  const entries = timing.resources
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => isHttp(entry.name))
    .sort((a, b) => a.entry.startTime - b.entry.startTime || a.index - b.index);
  for (const { entry } of entries) {
    const resourceType = resourceTypeOf(entry.initiatorType, entry.name);
    const isFrameDocument = entry.initiatorType === 'iframe' || entry.initiatorType === 'frame';
    requests.push({
      seq: requests.length,
      url: entry.name,
      method: entry.initiatorType === 'beacon' ? 'POST' : 'GET',
      resourceType,
      startMs: Math.max(0, entry.startTime),
      endMs: entry.responseEnd > 0 ? entry.responseEnd : null,
      status: entry.responseStatus > 0 ? entry.responseStatus : null,
      failure: null,
      isMainFrame: !isFrameDocument,
      frameUrls: isFrameDocument ? [entry.name] : [],
      isNavigation: isFrameDocument,
      initiator: null,
      redirectedFrom: null,
    });
  }
  return requests;
}
