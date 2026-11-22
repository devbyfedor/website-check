/**
 * Signals for the system a site runs on (session A4). Every signal is documented with its source in
 * `docs/cms-fingerprints.md` under its id. The scan only observes: the headers of the main document,
 * the request URLs of the top-level document, the final URL, and inside the page the generator meta
 * tags, a fixed list of JavaScript globals and a fixed list of CSS selectors.
 *
 * `strong`: produced by the platform's own page rendering, so a site on another system does not show it.
 * `weak`: can also appear on another system (an embedded widget, a hotlinked file, a migrated theme);
 * weak signals alone never decide the system.
 */

export const PLATFORM_IDS = ['wordpress', 'shopify', 'shopware', 'wix', 'jimdo'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];
/** WooCommerce is reported as an addition to WordPress, not as a system of its own. */
export type FingerprintSystem = PlatformId | 'woocommerce';

export type FingerprintMatcher =
  /** A header of the main document; `value` is tested against the header value when given. */
  | { kind: 'header'; name: string; value?: RegExp }
  /** The host of a request of the top-level document. */
  | { kind: 'request-host'; host: RegExp }
  /** The path of a request of the top-level document; `firstParty` limits it to the site's own hosts. */
  | { kind: 'request-path'; path: RegExp; firstParty: boolean }
  /** The host of the final URL of the page. */
  | { kind: 'final-host'; host: RegExp }
  | { kind: 'generator'; content: RegExp }
  /** A global that exists in the page (a dotted path such as `Shopify.shop`). */
  | { kind: 'global'; path: string }
  | { kind: 'selector'; selector: string };

export interface Fingerprint {
  /** Stable id, the heading of the signal in `docs/cms-fingerprints.md`. */
  id: string;
  system: FingerprintSystem;
  strength: 'strong' | 'weak';
  /** Shopware only: the major version the signal belongs to. */
  version?: 5 | 6;
  match: FingerprintMatcher;
}

export const FINGERPRINTS: readonly Fingerprint[] = [
  // WordPress
  { id: 'wp-generator', system: 'wordpress', strength: 'strong', match: { kind: 'generator', content: /^WordPress\b/i } },
  { id: 'wp-api-link', system: 'wordpress', strength: 'strong', match: { kind: 'selector', selector: 'link[rel="https://api.w.org/"]' } },
  { id: 'wp-api-header', system: 'wordpress', strength: 'strong', match: { kind: 'header', name: 'link', value: /rel="?https:\/\/api\.w\.org\/"?/i } },
  { id: 'wp-content-path', system: 'wordpress', strength: 'strong', match: { kind: 'request-path', path: /^\/(?:[^/]+\/)?wp-(?:content|includes)\//, firstParty: true } },
  { id: 'wp-json-path', system: 'wordpress', strength: 'strong', match: { kind: 'request-path', path: /^\/(?:[^/]+\/)?wp-json\//, firstParty: true } },
  { id: 'wp-content-path-elsewhere', system: 'wordpress', strength: 'weak', match: { kind: 'request-path', path: /\/wp-(?:content|includes)\//, firstParty: false } },
  // WooCommerce (only reported when WordPress is the system)
  { id: 'wc-generator', system: 'woocommerce', strength: 'strong', match: { kind: 'generator', content: /^WooCommerce\b/i } },
  { id: 'wc-plugin-path', system: 'woocommerce', strength: 'strong', match: { kind: 'request-path', path: /\/wp-content\/plugins\/woocommerce\//, firstParty: true } },
  { id: 'wc-body-class', system: 'woocommerce', strength: 'strong', match: { kind: 'selector', selector: 'body.woocommerce-js, body.woocommerce-no-js, body.woocommerce, body.woocommerce-page' } },
  { id: 'wc-params', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'woocommerce_params' } },
  { id: 'wc-add-to-cart-params', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'wc_add_to_cart_params' } },
  { id: 'wc-store-api-path', system: 'woocommerce', strength: 'strong', match: { kind: 'request-path', path: /\/wp-json\/wc\/store\//, firstParty: true } },
  // Shopify
  { id: 'shopify-shopid-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'x-shopid' } },
  { id: 'shopify-stage-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'x-shopify-stage' } },
  { id: 'shopify-powered-by-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'powered-by', value: /^Shopify\b/i } },
  { id: 'shopify-shop-global', system: 'shopify', strength: 'strong', match: { kind: 'global', path: 'Shopify.shop' } },
  { id: 'shopify-cdn-shop-path', system: 'shopify', strength: 'strong', match: { kind: 'request-path', path: /^\/cdn\/shop\//, firstParty: true } },
  { id: 'shopify-checkout-token-meta', system: 'shopify', strength: 'strong', match: { kind: 'selector', selector: 'meta[name="shopify-checkout-api-token"]' } },
  { id: 'shopify-cdn-host', system: 'shopify', strength: 'weak', match: { kind: 'request-host', host: /^cdn\.shopify\.com$/ } },
  { id: 'shopify-myshopify-final-host', system: 'shopify', strength: 'strong', match: { kind: 'final-host', host: /\.myshopify\.com$/ } },
  // Shopware 6
  { id: 'sw6-storefront-bundle-path', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'request-path', path: /\/bundles\/storefront\//, firstParty: true } },
  { id: 'sw6-theme-asset-path', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'request-path', path: /\/theme\/[0-9a-f]{32}\/(?:css|js|assets)\//, firstParty: true } },
  { id: 'sw6-plugin-manager-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'PluginManager' } },
  { id: 'sw6-sales-channel-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'salesChannelId' } },
  // Shopware 5
  { id: 'sw5-web-cache-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /^\/(?:[^/]+\/)?web\/cache\/\d+_[0-9a-f]+\.(?:css|js)$/, firstParty: true } },
  { id: 'sw5-themes-frontend-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /\/themes\/Frontend\//, firstParty: true } },
  { id: 'sw5-state-manager-global', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'global', path: 'StateManager' } },
  // Wix
  { id: 'wix-generator', system: 'wix', strength: 'strong', match: { kind: 'generator', content: /^Wix\.com Website Builder/i } },
  { id: 'wix-request-id-header', system: 'wix', strength: 'strong', match: { kind: 'header', name: 'x-wix-request-id' } },
  { id: 'wix-pepyaka-server', system: 'wix', strength: 'strong', match: { kind: 'header', name: 'server', value: /^Pepyaka\b/i } },
  { id: 'wix-parastorage-host', system: 'wix', strength: 'weak', match: { kind: 'request-host', host: /^(?:static|siteassets)\.parastorage\.com$/ } },
  { id: 'wix-wixstatic-host', system: 'wix', strength: 'weak', match: { kind: 'request-host', host: /^static\.wixstatic\.com$/ } },
  { id: 'wix-bi-session-global', system: 'wix', strength: 'strong', match: { kind: 'global', path: 'wixBiSession' } },
  // Jimdo
  { id: 'jimdo-data-global', system: 'jimdo', strength: 'strong', match: { kind: 'global', path: 'jimdoData' } },
  { id: 'jimdo-jimstatic-host', system: 'jimdo', strength: 'weak', match: { kind: 'request-host', host: /^assets\.jimstatic\.com$/ } },
  { id: 'jimdo-jimcdn-host', system: 'jimdo', strength: 'weak', match: { kind: 'request-host', host: /(?:^|\.)jimcdn\.com$/ } },
  { id: 'jimdo-free-final-host', system: 'jimdo', strength: 'strong', match: { kind: 'final-host', host: /\.(?:jimdofree|jimdosite|jimdo)\.com$/ } },
];

/** Dotted global paths the page snapshot looks up (`PlatformHints.globals`). */
export const PLATFORM_GLOBALS: readonly string[] = [...new Set(FINGERPRINTS.flatMap((f) => (f.match.kind === 'global' ? [f.match.path] : [])))];
/** CSS selectors the page snapshot tests (`PlatformHints.selectors`). */
export const PLATFORM_SELECTORS: readonly string[] = [...new Set(FINGERPRINTS.flatMap((f) => (f.match.kind === 'selector' ? [f.match.selector] : [])))];
