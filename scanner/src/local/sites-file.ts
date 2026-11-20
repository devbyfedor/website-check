/**
 * Parser for `local/sites.txt`, the list of test sites (never committed).
 *
 * One site per line: `<url> <kind> <platform>`, separated by spaces or tabs; `kind` and
 * `platform` are optional. Text after `#` is a comment. Labels are anonymous and follow the
 * line order of the sites: "Site 01", "Site 02", …
 *
 *   # shops
 *   https://www.example-shop.de  shop  shopify   # Nürnberg
 */

export interface SiteEntry {
  label: string;
  /** Two-digit number used for file names, e.g. "07" */
  number: string;
  url: string;
  kind: string | null;
  platform: string | null;
  line: number;
}

export interface SitesFileResult {
  sites: SiteEntry[];
  errors: string[];
}

export function parseSitesFile(text: string): SitesFileResult {
  const sites: SiteEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') return;
    const [url, kind, platform, ...rest] = line.split(/\s+/);
    const lineNumber = index + 1;
    if (url === undefined) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      errors.push(`line ${lineNumber}: not a URL: ${url}`);
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.push(`line ${lineNumber}: only http and https are allowed: ${url}`);
      return;
    }
    if (rest.length > 0) errors.push(`line ${lineNumber}: unexpected extra columns: ${rest.join(' ')}`);
    const key = parsed.href;
    if (seen.has(key)) {
      errors.push(`line ${lineNumber}: duplicate site ${url}`);
      return;
    }
    seen.add(key);
    const number = String(sites.length + 1).padStart(2, '0');
    sites.push({ label: `Site ${number}`, number, url: parsed.href, kind: kind ?? null, platform: platform ?? null, line: lineNumber });
  });
  return { sites, errors };
}
