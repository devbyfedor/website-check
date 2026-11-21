import type { BannerProbeState } from '../consent/probe-script.ts';
import type { ConsentSignals, PageSnapshot } from './types.ts';
import type { ResourceTimingData } from './resource-timing.ts';

/**
 * JavaScript that capture adapters evaluate inside the page. Plain strings, so the local
 * Playwright adapter and the Cloudflare adapter run exactly the same code. They only read the
 * page: no clicks, no DOM changes, nothing is sent.
 */

/** Global set by `RESOURCE_TIMING_INIT_SCRIPT`. */
export const RESOURCE_TIMING_GLOBAL = '__wcResources';

/**
 * Snapshot at the end of a visit: title, language, visible text, links, the banner probe result,
 * the consent signals of known tools, and `performance.timeOrigin` (epoch milliseconds of the
 * navigation start, used to convert probe times on machines with another clock).
 */
export const SNAPSHOT_EXPRESSION = `(() => {
  const MAX_TEXT = 100000;
  const MAX_LINKS = 1500;
  const body = document.body;
  const text = body ? (body.innerText || '') : '';
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const links = [];
  for (const a of anchors.slice(0, MAX_LINKS)) {
    const raw = a.getAttribute('href') || '';
    let href = raw;
    try { href = new URL(raw, document.baseURI).href; } catch (e) { href = raw; }
    const label = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    links.push({ href, text: label });
  }
  return {
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang'),
    text: text.slice(0, MAX_TEXT),
    textTruncated: text.length > MAX_TEXT,
    links,
    linksTruncated: anchors.length > MAX_LINKS,
    probe: window.__wcBannerProbe || null,
    signals: (() => {
      const read = (fn) => { try { return fn(); } catch (e) { return null; } };
      const cb = window.Cookiebot;
      const uc = window.UC_UI;
      return {
        cookiebot: cb ? read(() => ({ consented: !!cb.consented, declined: !!cb.declined, method: (cb.consent && cb.consent.method) || null })) : null,
        usercentrics: uc && typeof uc.areAllConsentsAccepted === 'function' ? read(() => ({ allAccepted: !!uc.areAllConsentsAccepted() })) : null,
      };
    })(),
    timeOrigin: performance.timeOrigin,
  };
})()`;

export interface SnapshotResult extends PageSnapshot {
  probe: BannerProbeState | null;
  signals: ConsentSignals | null;
  /** Missing in captures made before session A2. */
  timeOrigin?: number;
}

/**
 * Injected before any page script (top-level document only): keeps every Resource Timing entry
 * in a list, so the browser's default buffer of 250 entries and `clearResourceTimings()` of the
 * page do not lose any. Strategy (b) of the Cloudflare adapter reads the list in one call.
 */
export const RESOURCE_TIMING_INIT_SCRIPT = `(() => {
  if (window.top !== window) return;
  if (window.${RESOURCE_TIMING_GLOBAL}) return;
  const state = { list: [], observer: null };
  Object.defineProperty(window, '${RESOURCE_TIMING_GLOBAL}', { value: state, configurable: true, enumerable: false });
  try {
    state.observer = new PerformanceObserver((entries) => { for (const e of entries.getEntries()) state.list.push(e); });
    state.observer.observe({ type: 'resource', buffered: true });
  } catch (e) { state.observer = null; }
})();`;

/** Shared prefix: flush pending observer records and return the entry list. */
const READ_ENTRIES = `const s = window.${RESOURCE_TIMING_GLOBAL};
  if (s && s.observer) { for (const e of s.observer.takeRecords()) s.list.push(e); }
  const entries = s ? s.list : performance.getEntriesByType('resource');`;

/**
 * Cheap progress poll for strategy (b): how many resources have finished and when the last one
 * started or finished (page time, ms since `timeOrigin`).
 */
export const RESOURCE_TIMING_POLL_EXPRESSION = `(() => {
  ${READ_ENTRIES}
  let last = 0;
  for (const e of entries) { const t = Math.max(e.startTime, e.responseEnd); if (t > last) last = t; }
  const nav = performance.getEntriesByType('navigation')[0];
  return { count: entries.length, lastActivity: Math.round(last), now: Math.round(performance.now()),
    loaded: !!(nav && nav.loadEventStart > 0), readyState: document.readyState, collector: !!s };
})()`;

/** Strategy (b): every Resource Timing entry, the navigation entry and the snapshot, in one call. */
export const IN_PAGE_COLLECT_EXPRESSION = `(() => {
  ${READ_ENTRIES}
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const r = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n) : 0);
  const timing = {
    timeOrigin: performance.timeOrigin,
    now: r(performance.now()),
    collector: !!s,
    navigation: nav ? {
      name: nav.name, startTime: r(nav.startTime), fetchStart: r(nav.fetchStart), responseEnd: r(nav.responseEnd),
      domContentLoadedEventStart: r(nav.domContentLoadedEventStart), loadEventStart: r(nav.loadEventStart),
      responseStatus: nav.responseStatus || 0, redirectCount: nav.redirectCount || 0, type: nav.type || '',
    } : null,
    resources: entries.map((e) => ({
      name: e.name, initiatorType: e.initiatorType, startTime: r(e.startTime), responseEnd: r(e.responseEnd),
      responseStatus: e.responseStatus || 0, transferSize: r(e.transferSize), decodedBodySize: r(e.decodedBodySize),
      nextHopProtocol: e.nextHopProtocol || '',
    })),
  };
  return { timing, snapshot: ${SNAPSHOT_EXPRESSION} };
})()`;

export interface InPageCollectResult {
  timing: ResourceTimingData;
  snapshot: SnapshotResult;
}

export interface ResourceTimingPoll {
  count: number;
  lastActivity: number;
  now: number;
  loaded: boolean;
  readyState: string;
  collector: boolean;
}
