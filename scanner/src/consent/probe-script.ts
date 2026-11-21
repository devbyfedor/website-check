import type { ConsentTool } from './tools.ts';

/**
 * In-page script that watches for a consent banner and records when it becomes visible.
 *
 * It is plain JavaScript in a string, so every capture adapter (Playwright locally, Browser
 * Run in production) can inject it unchanged before any page script runs. It only reads the
 * page: it never clicks, never changes the DOM and sends nothing.
 *
 * Result: `window.__wcBannerProbe = { found, present }`, where `found` is
 * `{ toolId, selector, method, at }` or null, `present` maps tool ids to the first time their
 * element existed, and `at` values are epoch milliseconds (`performance.timeOrigin + now`).
 */

export const BANNER_PROBE_GLOBAL = '__wcBannerProbe';

export interface BannerProbeState {
  found: { toolId: string; selector: string; method: 'selector' | 'heuristic'; at: number } | null;
  present: Record<string, number>;
}

export function buildBannerProbeScript(tools: readonly ConsentTool[]): string {
  const config = tools.map((tool) => ({ id: tool.id, selectors: tool.selectors, shadow: tool.shadowRoot }));
  return `(() => {
  if (window.top !== window) return;
  if (window.${BANNER_PROBE_GLOBAL}) return;
  const TOOLS = ${JSON.stringify(config)};
  const CONSENT_WORDS = /cookie|einwillig|consent|zustimmung|datenschutz-einstellungen|privatsph/i;
  const state = { found: null, present: {} };
  Object.defineProperty(window, '${BANNER_PROBE_GLOBAL}', { value: state, configurable: true, enumerable: false });
  const now = () => performance.timeOrigin + performance.now();
  // Probe points: centre, near the top and bottom edges (thin bars), bottom corners, sides.
  const points = () => [[0.5, 0.92], [0.5, 0.97], [0.5, 0.5], [0.5, 0.08], [0.5, 0.03], [0.15, 0.9], [0.85, 0.9], [0.1, 0.5], [0.9, 0.5]]
    .map(([fx, fy]) => [Math.floor(innerWidth * fx), Math.floor(innerHeight * fy)]);
  // The innermost element at a point, through open shadow roots (a hit inside a shadow root
  // is reported as its host by document.elementFromPoint). Closed shadow roots stay closed.
  const deepAt = (x, y) => {
    let el = document.elementFromPoint(x, y);
    for (let i = 0; el && el.shadowRoot && i < 10; i += 1) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el || !el.shadowRoot.contains(inner)) break;
      el = inner;
    }
    return el;
  };
  // Parent element, leaving a shadow root through its host.
  const up = (el) => el.parentElement || (el.parentNode && el.parentNode.host) || null;
  const onScreen = (r) => r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const shown = (el) => {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    return onScreen(el.getBoundingClientRect());
  };
  const shownInShadow = (host) => {
    const root = host.shadowRoot;
    if (root) {
      for (const el of root.querySelectorAll('*')) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height >= 5000) return true;
      }
    }
    for (const [x, y] of points()) {
      for (const hit of document.elementsFromPoint(x, y)) {
        if (hit === host || host.contains(hit)) return true;
      }
    }
    return false;
  };
  const checkTools = () => {
    for (const tool of TOOLS) {
      for (const selector of tool.selectors) {
        let el = null;
        try { el = document.querySelector(selector); } catch (e) { el = null; }
        if (!el) continue;
        if (!state.present[tool.id]) state.present[tool.id] = now();
        if (shown(el) || (tool.shadow && shownInShadow(el))) {
          state.found = { toolId: tool.id, selector, method: 'selector', at: now() };
          return true;
        }
      }
    }
    return false;
  };
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
    return s;
  };
  // A visible fixed, sticky or dialog element of at least 15,000 px² and 36 px height that
  // mentions cookies or consent (text or aria-label) and holds a button or link.
  const checkHeuristic = () => {
    for (const [x, y] of points()) {
      let cur = deepAt(x, y);
      let depth = 0;
      while (cur && cur !== document.body && cur !== document.documentElement && depth < 30) {
        const style = getComputedStyle(cur);
        const dialogLike = style.position === 'fixed' || style.position === 'sticky' || cur.tagName === 'DIALOG'
          || cur.getAttribute('role') === 'dialog' || cur.getAttribute('aria-modal') === 'true';
        if (dialogLike) {
          const r = cur.getBoundingClientRect();
          const text = ((cur.innerText || '').slice(0, 4000)) + ' ' + (cur.getAttribute('aria-label') || '');
          if (r.width * r.height >= 15000 && r.height >= 36 && onScreen(r) && CONSENT_WORDS.test(text)
              && cur.querySelector('button, [role="button"], input[type="button"], input[type="submit"], a')) {
            state.found = { toolId: 'generic', selector: describe(cur), method: 'heuristic', at: now() };
            return true;
          }
        }
        cur = up(cur);
        depth += 1;
      }
    }
    return false;
  };
  const started = now();
  let ticks = 0;
  const tick = () => {
    try {
      if (checkTools()) return;
      if (ticks % 5 === 4 && document.body && checkHeuristic()) return;
    } catch (e) { /* keep watching */ }
    ticks += 1;
    if (now() - started < 30000) setTimeout(tick, 100);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick, { once: true });
  else tick();
})();`;
}
