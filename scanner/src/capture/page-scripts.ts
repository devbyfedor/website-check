import type { BannerProbeState } from '../consent/probe-script.ts';
import { PLATFORM_GLOBALS, PLATFORM_SELECTORS } from '../platform/fingerprints.ts';
import type { ConsentSignals, PageSnapshot, PlatformHints } from './types.ts';
import type { ResourceTimingData } from './resource-timing.ts';

/**
 * JavaScript that capture adapters evaluate inside the page. Plain strings, so the local
 * Playwright adapter and the Cloudflare adapter run exactly the same code. They only read the
 * page: no clicks, no DOM changes, nothing is sent.
 */

/** Global set by `RESOURCE_TIMING_INIT_SCRIPT`. */
export const RESOURCE_TIMING_GLOBAL = '__wcResources';

/** Words of legal links (session A4): links beyond the cap that match are still kept. */
const LEGAL_WORDS = 'impressum|imprint|anbieterkenn|legal|datenschutz|privacy|data protection|barrierefrei|accessib';

/**
 * Shared part of both snapshots: visible text and links. A link is marked `footer` when it sits in
 * `<footer>`, `role="contentinfo"`, or an element whose id or class names a footer, as long as that
 * element holds no header and no main part (a page wrapper with "footer" in a class is not a footer).
 * When a page has more links than the cap, links beyond it whose text or address names a legal page
 * are kept as well, so a footer after a huge menu is not lost.
 */
const TEXT_AND_LINKS = `
  const MAX_TEXT = 100000;
  const MAX_LINKS = 1500;
  const MAX_EXTRA_LINKS = 100;
  const body = document.body;
  const text = body ? (body.innerText || '') : '';
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const footerCache = new Map();
  const isFooterBox = (el) => {
    if (footerCache.has(el)) return footerCache.get(el);
    let result = false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'footer' || el.getAttribute('role') === 'contentinfo') result = true;
    else {
      const names = ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''))).toLowerCase();
      if (names.indexOf('footer') !== -1 && tag !== 'body' && tag !== 'html') {
        result = !el.querySelector('header, main, [role="main"], [role="banner"]');
      }
    }
    footerCache.set(el, result);
    return result;
  };
  const inFooter = (a) => {
    for (let el = a.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (isFooterBox(el)) return true;
    }
    return false;
  };
  const linkOf = (a) => {
    const raw = a.getAttribute('href') || '';
    let href = raw;
    try { href = new URL(raw, document.baseURI).href; } catch (e) { href = raw; }
    const label = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
    return { href, text: label, footer: inFooter(a) };
  };
  const links = anchors.slice(0, MAX_LINKS).map(linkOf);
  if (anchors.length > MAX_LINKS) {
    const legal = /${LEGAL_WORDS}/i;
    let extra = 0;
    for (const a of anchors.slice(MAX_LINKS)) {
      if (extra >= MAX_EXTRA_LINKS) break;
      const words = (a.innerText || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '') + ' ' + (a.getAttribute('href') || '');
      if (legal.test(words)) { links.push(linkOf(a)); extra += 1; }
    }
  }`;

/** System hints (session A4): generator meta tags, known globals and known selectors. */
const PLATFORM_HINTS = `(() => {
    const generators = Array.from(document.querySelectorAll('meta[name="generator" i]')).slice(0, 5).map((m) => String(m.getAttribute('content') || '').slice(0, 120));
    const globals = ${JSON.stringify(PLATFORM_GLOBALS)}.filter((path) => {
      try {
        let value = window;
        for (const part of path.split('.')) { if (value === null || value === undefined) return false; value = value[part]; }
        return value !== undefined && value !== null;
      } catch (e) { return false; }
    });
    const selectors = ${JSON.stringify(PLATFORM_SELECTORS)}.filter((s) => { try { return document.querySelector(s) !== null; } catch (e) { return false; } });
    return { generators, globals, selectors };
  })()`;

/**
 * Snapshot at the end of a visit: title, language, visible text, links, the banner probe result,
 * the consent signals of known tools, `performance.timeOrigin` (epoch milliseconds of the
 * navigation start, used to convert probe times on machines with another clock), the security
 * meta tags and the system hints.
 */
export const SNAPSHOT_EXPRESSION = `(() => {${TEXT_AND_LINKS}
  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang'),
    text: text.slice(0, MAX_TEXT),
    textTruncated: text.length > MAX_TEXT,
    links,
    linksTruncated: anchors.length > MAX_LINKS,
    platform: ${PLATFORM_HINTS},
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
    securityMeta: (() => {
      const read = (selector) => { const el = document.querySelector(selector); return el ? String(el.getAttribute('content') || '').slice(0, 1000) : null; };
      return { csp: read('meta[http-equiv="content-security-policy" i]'), referrer: read('meta[name="referrer" i]') };
    })(),
  };
})()`;

export interface SnapshotResult extends PageSnapshot {
  probe: BannerProbeState | null;
  signals: ConsentSignals | null;
  /** Missing in captures made before session A2. */
  timeOrigin?: number;
  platform?: PlatformHints;
}

/** Session A4: the snapshot of the Impressum page: title, language, visible text and links only. */
export const IMPRESSUM_SNAPSHOT_EXPRESSION = `(() => {${TEXT_AND_LINKS}
  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang'),
    text: text.slice(0, MAX_TEXT),
    textTruncated: text.length > MAX_TEXT,
    links,
    linksTruncated: anchors.length > MAX_LINKS,
  };
})()`;

/** Session A4: cheap progress check while the Impressum loads (state of the document and length of its text). */
export const TEXT_PROGRESS_EXPRESSION = `(() => ({ readyState: document.readyState, length: document.body ? (document.body.innerText || '').length : 0 }))()`;

export interface TextProgress {
  readyState: string;
  length: number;
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
