import type { BannerProbeState } from '../consent/probe-script.ts';
import { PLATFORM_GLOBALS, PLATFORM_SELECTORS } from '../platform/fingerprints.ts';
import { CAPTURE_LIMITS } from './limits.ts';
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

/** Part of a page's budget for links that only links naming a legal page may use (session fix-a4). */
export const LEGAL_LINK_RESERVE = 60_000;
/** Anchors of a page that are looked at for links at all (beyond the cap only for legal links). */
export const LINK_SCAN_MAX = 20_000;

/**
 * Session fix-a4: the last step for every value a snapshot returns. The page controls the DOM and can
 * replace any method these scripts call (`String.prototype.slice`, `Array.from`, …), so a value goes
 * into the result only through these guards, which use nothing but `typeof` and the length of a primitive
 * string. A string that is still too long after cutting is dropped, and lists are built with counted
 * loops. The answer of the browser therefore stays small whatever the page does.
 */
const GUARDS = `
  const S = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  const cut = (v, max) => { if (typeof v !== 'string') return ''; if (v.length <= max) return v; let c = ''; try { c = v.slice(0, max); } catch (e) { c = ''; } return S(c, max); };
  const cutN = (v, max) => (typeof v === 'string' ? cut(v, max) : null);
  const N = (v) => (typeof v === 'number' && v === v ? v : 0);`;

/**
 * Shared part of both snapshots: visible text and links. A link is marked `footer` when it sits in
 * `<footer>`, `role="contentinfo"`, or an element whose id or class names a footer, as long as that
 * element holds no header and no main part (a page wrapper with "footer" in a class is not a footer).
 * When a page has more links than the cap, links beyond it whose text or address names a legal page
 * are kept as well, so a footer after a huge menu is not lost.
 *
 * Session fix-a4: a link whose resolved address is longer than the limit is left out, and all links of a
 * page share a budget of characters (a long `<base href>` or document address is otherwise repeated in
 * every link); the last part of the budget is kept for links that name a legal page. `linksTruncated` is
 * true whenever a link was left out.
 */
const TEXT_AND_LINKS = `${GUARDS}
  const MAX_TEXT = ${CAPTURE_LIMITS.textLength};
  const MAX_LINKS = ${CAPTURE_LIMITS.maxLinks};
  const MAX_EXTRA_LINKS = ${CAPTURE_LIMITS.extraLinks};
  const MAX_URL = ${CAPTURE_LIMITS.urlLength};
  const MAX_LINK_TEXT = ${CAPTURE_LIMITS.linkTextLength};
  const MAX_LINK_CHARS = ${CAPTURE_LIMITS.linkChars};
  const LEGAL_RESERVE = ${LEGAL_LINK_RESERVE};
  const SCAN_MAX = ${LINK_SCAN_MAX};
  const body = document.body;
  const text = body ? (body.innerText || '') : '';
  const textLength = typeof text === 'string' ? text.length : 0;
  const anchors = document.querySelectorAll('a[href]');
  const anchorCount = anchors && typeof anchors.length === 'number' ? anchors.length : 0;
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
  const legal = /${LEGAL_WORDS}/i;
  let linkChars = 0;
  let linksLeftOut = false;
  // Null when the link is left out: its address is longer than the limit, or the budget is used up.
  const linkOf = (a) => {
    const raw = a.getAttribute('href') || '';
    let href = raw;
    try { href = new URL(raw, document.baseURI).href; } catch (e) { href = raw; }
    if (typeof href !== 'string' || href.length > MAX_URL) return null;
    const label = cut((a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\\s+/g, ' ').trim(), MAX_LINK_TEXT);
    const budget = legal.test(label + ' ' + raw) === true ? MAX_LINK_CHARS : MAX_LINK_CHARS - LEGAL_RESERVE;
    if (linkChars + href.length > budget) return null;
    linkChars += href.length;
    return { href: href, text: label, footer: inFooter(a) === true };
  };
  const links = [];
  let extra = 0;
  for (let i = 0; i < anchorCount && i < SCAN_MAX && links.length < MAX_LINKS + MAX_EXTRA_LINKS; i += 1) {
    const a = anchors[i];
    if (!a) continue;
    if (i >= MAX_LINKS) {
      if (extra >= MAX_EXTRA_LINKS) break;
      const words = (a.innerText || '') + ' ' + (a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '') + ' ' + (a.getAttribute('href') || '');
      if (legal.test(words) !== true) continue;
    }
    let link = null;
    try { link = linkOf(a); } catch (e) { link = null; }
    if (link === null) { linksLeftOut = true; continue; }
    links[links.length] = link;
    if (i >= MAX_LINKS) extra += 1;
  }
  const page = {
    url: cut(location.href, MAX_URL),
    title: cut(document.title || '', ${CAPTURE_LIMITS.titleLength}),
    lang: cutN(document.documentElement.getAttribute('lang'), ${CAPTURE_LIMITS.langLength}),
    text: cut(text, MAX_TEXT),
    textTruncated: textLength > MAX_TEXT,
    links: links,
    linksTruncated: anchorCount > MAX_LINKS || linksLeftOut,
  };`;

/** System hints (session A4): generator meta tags, known globals and known selectors. */
const PLATFORM_HINTS = `(() => {
    const generators = [];
    const metas = document.querySelectorAll('meta[name="generator" i]');
    for (let i = 0; i < 5 && metas && i < metas.length; i += 1) generators[generators.length] = cut(String(metas[i].getAttribute('content') || ''), 120);
    const GLOBALS = ${JSON.stringify(PLATFORM_GLOBALS)};
    const globals = [];
    for (let i = 0; i < GLOBALS.length; i += 1) {
      const path = GLOBALS[i];
      let present = false;
      try {
        let value = window;
        present = true;
        for (const part of path.split('.')) { if (value === null || value === undefined) { present = false; break; } value = value[part]; }
        present = present && value !== undefined && value !== null;
      } catch (e) { present = false; }
      if (present) globals[globals.length] = S(path, ${CAPTURE_LIMITS.platformEntryLength});
    }
    const SELECTORS = ${JSON.stringify(PLATFORM_SELECTORS)};
    const selectors = [];
    for (let i = 0; i < SELECTORS.length; i += 1) {
      let present = false;
      try { present = document.querySelector(SELECTORS[i]) !== null; } catch (e) { present = false; }
      if (present) selectors[selectors.length] = S(SELECTORS[i], ${CAPTURE_LIMITS.platformEntryLength});
    }
    return { generators: generators, globals: globals, selectors: selectors };
  })()`;

/** The banner probe's state as the snapshot returns it: only its known fields, each within its limit. */
const PROBE_STATE = `(() => {
    try {
      const p = window.__wcBannerProbe;
      if (!p || typeof p !== 'object') return null;
      const f = p.found;
      const found = f && typeof f === 'object'
        ? { toolId: cut(f.toolId, ${CAPTURE_LIMITS.toolIdLength}), selector: cut(f.selector, ${CAPTURE_LIMITS.selectorLength}), method: f.method === 'selector' ? 'selector' : 'heuristic', at: N(f.at) }
        : null;
      const present = {};
      let count = 0;
      if (p.present && typeof p.present === 'object') {
        for (const key in p.present) {
          if (count >= ${CAPTURE_LIMITS.toolsInDom}) break;
          if (typeof key !== 'string' || key.length > ${CAPTURE_LIMITS.toolIdLength}) continue;
          present[key] = N(p.present[key]);
          count += 1;
        }
      }
      return { found: found, present: present };
    } catch (e) { return null; }
  })()`;

/**
 * Snapshot at the end of a visit: title, language, visible text, links, the banner probe result,
 * the consent signals of known tools, `performance.timeOrigin` (epoch milliseconds of the
 * navigation start, used to convert probe times on machines with another clock), the security
 * meta tags and the system hints. Every value is within `CAPTURE_LIMITS` (session fix-a4).
 */
export const SNAPSHOT_EXPRESSION = `(() => {${TEXT_AND_LINKS}
  page.platform = ${PLATFORM_HINTS};
  page.probe = ${PROBE_STATE};
  page.signals = (() => {
    const read = (fn) => { try { return fn(); } catch (e) { return null; } };
    const cb = window.Cookiebot;
    const uc = window.UC_UI;
    return {
      cookiebot: cb ? read(() => ({ consented: !!cb.consented, declined: !!cb.declined, method: cutN((cb.consent && cb.consent.method) || null, ${CAPTURE_LIMITS.shortText}) })) : null,
      usercentrics: uc && typeof uc.areAllConsentsAccepted === 'function' ? read(() => ({ allAccepted: !!uc.areAllConsentsAccepted() })) : null,
    };
  })();
  page.timeOrigin = N(performance.timeOrigin);
  page.securityMeta = (() => {
    const read = (selector) => { const el = document.querySelector(selector); return el ? cut(String(el.getAttribute('content') || ''), ${CAPTURE_LIMITS.metaLength}) : null; };
    return { csp: read('meta[http-equiv="content-security-policy" i]'), referrer: read('meta[name="referrer" i]') };
  })();
  return page;
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
  return page;
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

/**
 * Strategy (b): every Resource Timing entry, the navigation entry and the snapshot, in one call.
 * Session fix-a4: at most one entry more than the request limit (so the capture fails as over the
 * limit), each name cut to the address limit.
 */
export const IN_PAGE_COLLECT_EXPRESSION = `(() => {
  ${READ_ENTRIES}
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const r = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n) : 0);
  const name = (v) => { if (typeof v !== 'string') return ''; if (v.length <= ${CAPTURE_LIMITS.urlLength}) return v; const c = v.slice(0, ${CAPTURE_LIMITS.urlLength}); return typeof c === 'string' && c.length <= ${CAPTURE_LIMITS.urlLength} ? c : ''; };
  const short = (v) => (typeof v === 'string' && v.length <= ${CAPTURE_LIMITS.shortText} ? v : '');
  const resources = [];
  for (let i = 0; i < entries.length && i <= ${CAPTURE_LIMITS.maxRequests}; i += 1) {
    const e = entries[i];
    resources[resources.length] = {
      name: name(e.name), initiatorType: short(e.initiatorType), startTime: r(e.startTime), responseEnd: r(e.responseEnd),
      responseStatus: r(e.responseStatus), transferSize: r(e.transferSize), decodedBodySize: r(e.decodedBodySize),
      nextHopProtocol: short(e.nextHopProtocol),
    };
  }
  const timing = {
    timeOrigin: performance.timeOrigin,
    now: r(performance.now()),
    collector: !!s,
    navigation: nav ? {
      name: name(nav.name), startTime: r(nav.startTime), fetchStart: r(nav.fetchStart), responseEnd: r(nav.responseEnd),
      domContentLoadedEventStart: r(nav.domContentLoadedEventStart), loadEventStart: r(nav.loadEventStart),
      responseStatus: r(nav.responseStatus), redirectCount: r(nav.redirectCount), type: short(nav.type),
    } : null,
    resources: resources,
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
