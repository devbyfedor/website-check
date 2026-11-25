// The security headers of our own site (session B5 part 2, Fedor): the pages (Workers Static Assets, the file `_headers`
// that web/scripts/security-headers.ts writes at build time) and the answers of the API (router.ts) send the same
// values, so that our scanner counts all five headers of the brief and no other site can frame ours. Worker code: no
// Node built-ins (the build script imports this file too).

/** Two years; the site and the API only speak HTTPS on Cloudflare. A browser ignores the header on http://127.0.0.1. */
export const HSTS = 'max-age=63072000; includeSubDomains';

/**
 * Every feature the site does not use is off; the copy buttons of the report write to the clipboard of our own page.
 * Only features that Chromium 159 knows: an unknown one logs a warning in the console ("Unrecognized feature"), so the
 * Privacy Sandbox features (attribution-reporting, browsing-topics, join-ad-interest-group, private-aggregation,
 * run-ad-auction, shared-storage, shared-storage-select-url), interest-cohort, ambient-light-sensor and smart-card are
 * left out; a browser that does not know a feature does not offer it either.
 */
export const PERMISSIONS_FEATURES_OFF = [
  'accelerometer',
  'autoplay',
  'bluetooth',
  'camera',
  'captured-surface-control',
  'clipboard-read',
  'compute-pressure',
  'cross-origin-isolated',
  'deferred-fetch',
  'digital-credentials-get',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'gamepad',
  'geolocation',
  'gyroscope',
  'hid',
  'identity-credentials-get',
  'idle-detection',
  'keyboard-map',
  'local-fonts',
  'magnetometer',
  'microphone',
  'midi',
  'otp-credentials',
  'payment',
  'picture-in-picture',
  'private-state-token-issuance',
  'private-state-token-redemption',
  'publickey-credentials-create',
  'publickey-credentials-get',
  'screen-wake-lock',
  'serial',
  'speaker-selection',
  'storage-access',
  'sync-xhr',
  'unload',
  'usb',
  'web-share',
  'window-management',
  'xr-spatial-tracking',
] as const;
export const PERMISSIONS_POLICY = [...PERMISSIONS_FEATURES_OFF.map((f) => `${f}=()`), 'clipboard-write=(self)'].sort().join(', ');

/** The headers every page and every answer of the API sends (the CSP and the Referrer-Policy of a page may differ). */
export const SITE_HEADERS = {
  'Strict-Transport-Security': HSTS,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Frame-Options': 'DENY',
} as const;

/** The CSP of an answer of the API (JSON): nothing may load, nobody may frame it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * The CSP of a page: scripts and styles only from our own host, the inline scripts of Next.js and the inline styles of
 * the prerendered HTML only by their SHA-256 (`'unsafe-hashes'` for style attributes, which CSP Level 3 allows by hash);
 * no `unsafe-inline`, no `unsafe-eval`. Styles that React sets after the load go through the CSSOM, which CSP does not
 * restrict. Images, fonts and requests (the API, the data of the next page) only from our own host.
 */
export function pageCsp(hashes: { scripts: readonly string[]; styles: readonly string[]; attributes: readonly string[] }): string {
  const q = (h: string) => `'${h}'`;
  const script = ["'self'", ...hashes.scripts.map(q)];
  const style = ["'self'", ...(hashes.attributes.length > 0 ? ["'unsafe-hashes'"] : []), ...[...hashes.styles, ...hashes.attributes].map(q)];
  return [
    "default-src 'none'",
    `script-src ${script.join(' ')}`,
    `style-src ${style.join(' ')}`,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
