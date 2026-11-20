/**
 * Scan core of Website-Check DE.
 *
 * Everything exported from here runs both in Node (local runner, tests) and in a
 * Cloudflare Worker. The Playwright capture adapter is Node-only and is exported
 * separately from `@website-check/scanner/local`.
 */
export const SCANNER_VERSION = '0.1.0';
