import { getDomain } from 'tldts';
import type { Capture } from '../capture/types.ts';

/**
 * Domain logic: which requests belong to the scanned site ("first party").
 *
 * A site is identified by its registrable domain according to the Public Suffix List,
 * including the private section (so `shop-a.myshopify.com` and `shop-b.myshopify.com`
 * are different sites, as browsers treat them).
 */

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

export function isIpAddress(host: string): boolean {
  return IPV4.test(host) || host.includes(':') || host.startsWith('[');
}

/** Lower-case host of an http(s) or ws(s) URL, or null for anything else (data:, blob:, about:, invalid). */
export function hostOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return null;
  const host = normalizeHost(parsed.hostname);
  return host === '' ? null : host;
}

/** Registrable domain of a host; the host itself for IP addresses and hosts without a public suffix. */
export function siteOfHost(host: string): string {
  const h = normalizeHost(host);
  if (isIpAddress(h)) return h;
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

export function siteOfUrl(url: string): string | null {
  const host = hostOf(url);
  return host === null ? null : siteOfHost(host);
}

/**
 * Sites that count as first party for a capture: the site of the final URL and of every
 * hop of the main document's redirect chain (including the requested URL), because the
 * site owner controls those redirects.
 */
export function firstPartySites(capture: Pick<Capture, 'requestedUrl' | 'finalUrl' | 'mainDocument'>): Set<string> {
  const urls = [capture.requestedUrl, capture.finalUrl, ...(capture.mainDocument?.redirectChain.map((hop) => hop.url) ?? [])];
  const sites = new Set<string>();
  for (const url of urls) {
    if (url === null) continue;
    const site = siteOfUrl(url);
    if (site !== null) sites.add(site);
  }
  return sites;
}
