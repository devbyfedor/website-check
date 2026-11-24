import { frameUnknown } from '../capture/frames.ts';
import type { Capture } from '../capture/types.ts';
import { hostOf } from '../domain/site.ts';
import { FINGERPRINTS, PLATFORM_IDS, type Fingerprint, type FingerprintSystem, type PlatformId } from '../platform/fingerprints.ts';

/**
 * Which system the site runs on (session A4): WordPress (with or without WooCommerce), Shopify,
 * Shopware, Wix, Jimdo, otherwise "unbekannt". Pure function of a capture.
 *
 * A system is named only on strong signals of it (signals and sources in `docs/cms-fingerprints.md`).
 * Weak signals alone (an embedded Shopify button, a hotlinked image) never name a system.
 *
 * Session fix-a6 (review finding 75): one strong signal is enough only when it is decisive, a header of the
 * main document, the generator meta tag or the final host. Otherwise the system needs two pieces of strong
 * evidence: two different strong signals, or two different files of the system that the site served (each
 * answered request to a file path of the system counts once). A request that got no answer or an error status
 * (a leftover link to a file of an old system) is no evidence. If two systems are named, the one with more
 * evidence wins; a tie gives "unbekannt", with all signals listed for the manual check.
 */

export const PLATFORM_ANALYSIS_VERSION = 2;

/** Kinds of signals that decide alone: the server or the platform says it about the page itself. */
const DECISIVE: ReadonlySet<Fingerprint['match']['kind']> = new Set(['header', 'generator', 'final-host']);

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

/** A request the site answered: a file path seen only in a failed request (404, no answer) proves nothing. */
function answered(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

/**
 * What a fingerprint matched: one evidence, or for request signals every different answered request (session
 * fix-a6: several files of a system are several pieces of evidence). Empty when it did not match.
 */
function matches(fingerprint: Fingerprint, capture: Capture, ownHosts: ReadonlySet<string>): string[] {
  return matchOne(fingerprint, capture, ownHosts) ?? [];
}

function matchOne(fingerprint: Fingerprint, capture: Capture, ownHosts: ReadonlySet<string>): string[] | null {
  const match = fingerprint.match;
  const page = capture.page;
  switch (match.kind) {
    case 'header': {
      const value = capture.mainDocument?.headers[match.name];
      if (value === undefined) return null;
      if (match.value !== undefined && !match.value.test(value)) return null;
      return [`${match.name}: ${value.slice(0, 120)}`];
    }
    case 'generator': {
      const hit = page?.platform?.generators.find((g) => match.content.test(g));
      return hit === undefined ? null : [`generator: ${hit}`];
    }
    case 'global':
      return page?.platform?.globals.includes(match.path) === true ? [`window.${match.path}`] : null;
    case 'selector':
      return page?.platform?.selectors.includes(match.selector) === true ? [`selector ${match.selector}`] : null;
    case 'final-host': {
      const host = capture.finalUrl === null ? null : hostOf(capture.finalUrl);
      return host !== null && match.host.test(host) ? [`final host ${host}`] : null;
    }
    case 'request-host':
    case 'request-path': {
      const seen = new Set<string>();
      for (const request of capture.requests) {
        // Only requests of the page itself: not those of an iframe, and not those whose document is unknown.
        if (!request.isMainFrame && (request.frameUrls.length > 0 || frameUnknown(capture, request))) continue;
        if (!answered(request.status)) continue;
        const host = hostOf(request.url);
        if (host === null) continue;
        if (match.kind === 'request-host') {
          if (match.host.test(host)) seen.add(shorten(request.url));
          continue;
        }
        if (match.firstParty && !ownHosts.has(host.replace(/^www\./, ''))) continue;
        if (match.host !== undefined && !match.host.test(host)) continue;
        const path = pathOf(request.url);
        // Different files only: the same address requested twice is one piece of evidence.
        if (path !== null && match.path.test(path)) seen.add(shorten(request.url.split(/[?#]/)[0] ?? request.url));
      }
      return seen.size === 0 ? null : [...seen].slice(0, 20);
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
  // Session fix-a6: the pieces of strong evidence of each system, and whether one of them decides alone.
  const evidence = new Map<FingerprintSystem, { pieces: Set<string>; decisive: boolean }>();
  for (const fingerprint of FINGERPRINTS) {
    const found = matches(fingerprint, capture, own);
    if (found.length === 0) continue;
    signals.push({ id: fingerprint.id, system: fingerprint.system, strength: fingerprint.strength, evidence: found[0] as string });
    if (fingerprint.strength !== 'strong') continue;
    const entry = evidence.get(fingerprint.system) ?? { pieces: new Set<string>(), decisive: false };
    // A file counts once even when two fingerprints of the system match it.
    const isFile = fingerprint.match.kind === 'request-path' || fingerprint.match.kind === 'request-host';
    for (const piece of found) entry.pieces.add(isFile ? `file ${piece}` : fingerprint.id);
    if (DECISIVE.has(fingerprint.match.kind)) entry.decisive = true;
    evidence.set(fingerprint.system, entry);
  }
  const strongCount = (system: PlatformId): number => {
    const entry = evidence.get(system);
    if (entry === undefined) return 0;
    return entry.decisive || entry.pieces.size >= 2 ? entry.pieces.size : 0;
  };
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
