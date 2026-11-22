import type { Capture } from '../capture/types.ts';
import { hostOf } from '../domain/site.ts';
import { FINGERPRINTS, PLATFORM_IDS, type Fingerprint, type FingerprintSystem, type PlatformId } from '../platform/fingerprints.ts';

/**
 * Which system the site runs on (session A4): WordPress (with or without WooCommerce), Shopify,
 * Shopware, Wix, Jimdo, otherwise "unbekannt". Pure function of a capture.
 *
 * A system is named only when at least one strong signal of it was seen (signals and sources in
 * `docs/cms-fingerprints.md`). Weak signals alone (an embedded Shopify button, a hotlinked image)
 * never name a system. If strong signals of two systems are seen, the one with more strong signals
 * wins; a tie gives "unbekannt", with all signals listed for the manual check.
 */

export const PLATFORM_ANALYSIS_VERSION = 1;

export type DetectedSystem = PlatformId | 'unknown';

export interface PlatformSignal {
  id: string;
  system: FingerprintSystem;
  strength: 'strong' | 'weak';
  /** What was seen: the header, the request URL (shortened), the generator text, the global or the selector. */
  evidence: string;
}

export interface PlatformAnalysis {
  version: typeof PLATFORM_ANALYSIS_VERSION;
  system: DetectedSystem;
  /** WordPress only: WooCommerce signals were seen. */
  woocommerce: boolean;
  /** Shopware only: the major version when its signals say so. */
  shopwareVersion: 5 | 6 | null;
  /** Strong signals of more than one system were seen. */
  conflict: boolean;
  signals: PlatformSignal[];
}

function shorten(url: string): string {
  return url.length <= 160 ? url : `${url.slice(0, 159)}…`;
}

function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function matches(fingerprint: Fingerprint, capture: Capture, ownHosts: ReadonlySet<string>): string | null {
  const match = fingerprint.match;
  const page = capture.page;
  switch (match.kind) {
    case 'header': {
      const value = capture.mainDocument?.headers[match.name];
      if (value === undefined) return null;
      if (match.value !== undefined && !match.value.test(value)) return null;
      return `${match.name}: ${value.slice(0, 120)}`;
    }
    case 'generator': {
      const hit = page?.platform?.generators.find((g) => match.content.test(g));
      return hit === undefined ? null : `generator: ${hit}`;
    }
    case 'global':
      return page?.platform?.globals.includes(match.path) === true ? `window.${match.path}` : null;
    case 'selector':
      return page?.platform?.selectors.includes(match.selector) === true ? `selector ${match.selector}` : null;
    case 'final-host': {
      const host = capture.finalUrl === null ? null : hostOf(capture.finalUrl);
      return host !== null && match.host.test(host) ? `final host ${host}` : null;
    }
    case 'request-host':
    case 'request-path': {
      for (const request of capture.requests) {
        if (!request.isMainFrame && request.frameUrls.length > 0) continue;
        const host = hostOf(request.url);
        if (host === null) continue;
        if (match.kind === 'request-host') {
          if (match.host.test(host)) return shorten(request.url);
          continue;
        }
        if (match.firstParty && !ownHosts.has(host.replace(/^www\./, ''))) continue;
        if (match.host !== undefined && !match.host.test(host)) continue;
        const path = pathOf(request.url);
        if (path !== null && match.path.test(path)) return shorten(request.url);
      }
      return null;
    }
  }
}

/** Hosts of the page itself, without "www.": the requested URL, the final URL and every redirect hop. */
function ownHostsOf(capture: Capture): Set<string> {
  const hosts = new Set<string>();
  for (const url of [capture.requestedUrl, capture.finalUrl, ...(capture.mainDocument?.redirectChain.map((h) => h.url) ?? [])]) {
    const host = url === null ? null : hostOf(url);
    if (host !== null) hosts.add(host.replace(/^www\./, ''));
  }
  return hosts;
}

export function analyzePlatform(capture: Capture): PlatformAnalysis {
  const signals: PlatformSignal[] = [];
  const own = ownHostsOf(capture);
  for (const fingerprint of FINGERPRINTS) {
    const evidence = matches(fingerprint, capture, own);
    if (evidence !== null) signals.push({ id: fingerprint.id, system: fingerprint.system, strength: fingerprint.strength, evidence });
  }
  const strongCount = (system: PlatformId): number => signals.filter((s) => s.system === system && s.strength === 'strong').length;
  const ranked = PLATFORM_IDS.map((system) => ({ system, strong: strongCount(system) }))
    .filter((r) => r.strong > 0)
    .sort((a, b) => b.strong - a.strong);
  const top = ranked[0];
  const second = ranked[1];
  const conflict = ranked.length > 1;
  const system: DetectedSystem = top === undefined || (second !== undefined && second.strong === top.strong) ? 'unknown' : top.system;
  const woocommerce = system === 'wordpress' && signals.some((s) => s.system === 'woocommerce' && s.strength === 'strong');
  let shopwareVersion: 5 | 6 | null = null;
  if (system === 'shopware') {
    const versions = new Set(
      signals
        .filter((s) => s.system === 'shopware' && s.strength === 'strong')
        .map((s) => FINGERPRINTS.find((f) => f.id === s.id)?.version)
        .filter((v): v is 5 | 6 => v !== undefined),
    );
    shopwareVersion = versions.size === 1 ? ([...versions][0] ?? null) : null;
  }
  return { version: PLATFORM_ANALYSIS_VERSION, system, woocommerce, shopwareVersion, conflict, signals };
}
