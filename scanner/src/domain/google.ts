import { normalizeHost, siteOfHost } from './site.ts';

/**
 * Google's search domains of all countries (`scanner/data/google-domains.json`, from
 * https://www.google.com/supported_domains). Google answers the same requests on the domain of
 * the visitor's country: a browser in Italy gets `www.google.it/ads/ga-audiences`, one in Germany
 * `www.google.de/ads/ga-audiences`. The Cloudflare browser runs in different EU countries, so the
 * scanner treats a host on any of these domains as the same host on `google.com`.
 */

export interface GoogleDomainsFile {
  version: number;
  updated: string;
  source: string;
  canonical: 'google.com';
  domains: string[];
}

const DOMAIN = /^google(?:\.[a-z]{2,3}){1,2}$/;

export function parseGoogleDomainsFile(raw: unknown): GoogleDomainsFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('google domains file: not an object');
  const file = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof file['version'] !== 'number') errors.push('version must be a number');
  if (typeof file['updated'] !== 'string') errors.push('updated must be a string');
  if (typeof file['source'] !== 'string' || !file['source'].startsWith('https://')) errors.push('source must be an https URL');
  if (file['canonical'] !== 'google.com') errors.push('canonical must be google.com');
  const domains = file['domains'];
  if (!Array.isArray(domains) || domains.length === 0) {
    errors.push('domains must be a non-empty array');
  } else {
    const seen = new Set<string>();
    for (const domain of domains) {
      if (typeof domain !== 'string' || !DOMAIN.test(domain)) errors.push(`invalid domain ${String(domain)}`);
      else if (domain === 'google.com') errors.push('google.com is the canonical domain, not a country domain');
      else if (siteOfHost(domain) !== domain) errors.push(`${domain} is not a registrable domain`);
      else if (seen.has(domain)) errors.push(`duplicate domain ${domain}`);
      else seen.add(domain);
    }
  }
  if (errors.length > 0) throw new Error(`google domains file has ${errors.length} problem(s):\n- ${errors.join('\n- ')}`);
  return raw as GoogleDomainsFile;
}

/**
 * Returns a function that maps a host on a Google country domain to the same host on
 * `google.com` (`www.google.it` → `www.google.com`, `maps.google.co.uk` → `maps.google.com`) and
 * leaves every other host as it is.
 */
export function googleCanonicalHost(file: GoogleDomainsFile): (host: string) => string {
  const countryDomains = new Set(file.domains);
  return (host: string): string => {
    const h = normalizeHost(host);
    const site = siteOfHost(h);
    if (!countryDomains.has(site)) return h;
    return `${h.slice(0, h.length - site.length)}${file.canonical}`;
  };
}
