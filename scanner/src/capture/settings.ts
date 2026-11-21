/**
 * Browser settings and limits shared by every capture adapter.
 *
 * The local Playwright adapter and the Cloudflare Browser Run adapter must present the same
 * visitor to a site: consent tools can guess the country from the language and the time zone,
 * so these values are defined once, here.
 */

export const CAPTURE_SETTINGS = {
  locale: 'de-DE',
  /** Playwright sends the locale as the only `Accept-Language` value; the Cloudflare adapter does the same. */
  acceptLanguage: 'de-DE',
  timezoneId: 'Europe/Berlin',
  viewport: { width: 1440, height: 900 },
  /** Stop waiting for a quiet network 15 s after the start. */
  maxWaitMs: 15_000,
  /** The network is quiet when nothing is open and nothing started for this long after the load event. */
  quietWindowMs: 1_500,
  /** Absolute limit for one page, including data collection. */
  hardLimitMs: 20_000,
} as const;

/** User agent of a regular desktop Chrome on Windows with the given version (reduced UA format). */
export function desktopChromeUserAgent(browserVersion: string): string {
  const major = browserVersion.split('.')[0] ?? '0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * Chrome version from a version string as browsers report it:
 * `HeadlessChrome/141.0.7390.37`, `Chrome/141.0.7390.37` or `141.0.7390.37`.
 */
export function chromeVersionOf(product: string): string {
  const match = /(\d+(?:\.\d+){0,3})\s*$/.exec(product.trim());
  return match?.[1] ?? '0';
}

/** Resource types that stay open by design and must not keep the network "busy". */
export const LONG_LIVED_RESOURCE_TYPES: ReadonlySet<string> = new Set(['websocket', 'eventsource']);
