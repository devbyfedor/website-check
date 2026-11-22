/**
 * Signals for the system a site runs on (session A4). Every signal is documented with its source in
 * `docs/cms-fingerprints.md` under its id. The scan only observes: the headers of the main document,
 * the request URLs of the top-level document, the final URL, and inside the page the generator meta
 * tags, a fixed list of JavaScript globals and a fixed list of CSS selectors.
 *
 * `strong`: produced by the platform's own page rendering, so a site on another system does not show it.
 * `weak`: can also appear on another system (an embedded widget, a hotlinked file, a headless setup);
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
  /**
   * The path of a request of the top-level document: on the site's own hosts (`firstParty`), on a
   * given `host`, or on any host.
   */
  | { kind: 'request-path'; path: RegExp; firstParty: boolean; host?: RegExp }
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

const WP_PATH = /^\/(?:[^/]+\/)?wp-(?:content|includes)\//;

export const FINGERPRINTS: readonly Fingerprint[] = [
  // WordPress
  { id: 'wp-generator', system: 'wordpress', strength: 'strong', match: { kind: 'generator', content: /^WordPress\b/i } },
  { id: 'wp-api-link', system: 'wordpress', strength: 'strong', match: { kind: 'selector', selector: 'link[rel="https://api.w.org/"]' } },
  { id: 'wp-api-header', system: 'wordpress', strength: 'strong', match: { kind: 'header', name: 'link', value: /rel="?https:\/\/api\.w\.org\/"?/i } },
  { id: 'wp-content-path', system: 'wordpress', strength: 'strong', match: { kind: 'request-path', path: WP_PATH, firstParty: true } },
  { id: 'wp-block-library-css', system: 'wordpress', strength: 'strong', match: { kind: 'selector', selector: 'link#wp-block-library-css, style#wp-block-library-inline-css' } },
  { id: 'wp-global-styles', system: 'wordpress', strength: 'strong', match: { kind: 'selector', selector: 'style#global-styles-inline-css' } },
  { id: 'wp-emoji-settings', system: 'wordpress', strength: 'strong', match: { kind: 'global', path: '_wpemojiSettings' } },
  { id: 'wp-emoji-settings-json', system: 'wordpress', strength: 'strong', match: { kind: 'selector', selector: 'script#wp-emoji-settings' } },
  { id: 'wp-json-path', system: 'wordpress', strength: 'weak', match: { kind: 'request-path', path: /^\/(?:[^/]+\/)?wp-json\//, firstParty: true } },
  { id: 'wp-pingback-header', system: 'wordpress', strength: 'weak', match: { kind: 'header', name: 'x-pingback', value: /\/xmlrpc\.php$/ } },
  { id: 'wp-content-path-elsewhere', system: 'wordpress', strength: 'weak', match: { kind: 'request-path', path: /\/wp-(?:content|includes)\//, firstParty: false } },
  // WooCommerce (only reported when WordPress is the system)
  { id: 'wc-generator', system: 'woocommerce', strength: 'strong', match: { kind: 'generator', content: /^WooCommerce\b/i } },
  { id: 'wc-js-body-class', system: 'woocommerce', strength: 'strong', match: { kind: 'selector', selector: 'body.woocommerce-js, body.woocommerce-no-js' } },
  { id: 'wc-page-body-class', system: 'woocommerce', strength: 'strong', match: { kind: 'selector', selector: 'body.woocommerce, body.woocommerce-page' } },
  { id: 'wc-inline-style', system: 'woocommerce', strength: 'strong', match: { kind: 'selector', selector: 'style#woocommerce-inline-inline-css' } },
  { id: 'wc-stylesheets', system: 'woocommerce', strength: 'strong', match: { kind: 'selector', selector: 'link#woocommerce-general-css, link#woocommerce-layout-css, link#woocommerce-smallscreen-css' } },
  { id: 'wc-plugin-path', system: 'woocommerce', strength: 'strong', match: { kind: 'request-path', path: /^\/(?:[^/]+\/)?wp-content\/plugins\/woocommerce\//, firstParty: true } },
  { id: 'wc-params', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'woocommerce_params' } },
  { id: 'wc-add-to-cart-params', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'wc_add_to_cart_params' } },
  { id: 'wc-cart-fragments-params', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'wc_cart_fragments_params' } },
  { id: 'wc-order-attribution', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'wc_order_attribution' } },
  { id: 'wc-settings', system: 'woocommerce', strength: 'strong', match: { kind: 'global', path: 'wcSettings' } },
  { id: 'wc-store-api-path', system: 'woocommerce', strength: 'weak', match: { kind: 'request-path', path: /\/wp-json\/wc\/store(?:\/v1)?\//, firstParty: true } },
  // Shopify
  { id: 'shopify-powered-by-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'powered-by', value: /^Shopify\b/i } },
  { id: 'shopify-complexity-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'shopify-complexity-score', value: /^\d+$/ } },
  { id: 'shopify-shopid-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'x-shopid' } },
  { id: 'shopify-sorting-hat-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'x-sorting-hat-shopid' } },
  { id: 'shopify-stage-header', system: 'shopify', strength: 'strong', match: { kind: 'header', name: 'x-shopify-stage' } },
  { id: 'shopify-cdn-shop-path', system: 'shopify', strength: 'strong', match: { kind: 'request-path', path: /^\/cdn\/(?:shop|shopifycloud)\//, firstParty: true } },
  { id: 'shopify-routes-global', system: 'shopify', strength: 'strong', match: { kind: 'global', path: 'Shopify.routes.root' } },
  { id: 'shopify-shop-global', system: 'shopify', strength: 'strong', match: { kind: 'global', path: 'Shopify.shop' } },
  { id: 'shopify-analytics-global', system: 'shopify', strength: 'strong', match: { kind: 'global', path: 'ShopifyAnalytics' } },
  { id: 'shopify-wallet-meta', system: 'shopify', strength: 'strong', match: { kind: 'selector', selector: 'meta[name="shopify-digital-wallet"], meta[name="shopify-checkout-api-token"]' } },
  { id: 'shopify-section', system: 'shopify', strength: 'strong', match: { kind: 'selector', selector: 'div.shopify-section[id^="shopify-section-"]' } },
  { id: 'shopify-myshopify-final-host', system: 'shopify', strength: 'strong', match: { kind: 'final-host', host: /\.myshopify\.com$/ } },
  { id: 'shopify-cdn-host', system: 'shopify', strength: 'weak', match: { kind: 'request-host', host: /^cdn\.shopify\.com$/ } },
  // Shopware 6
  { id: 'sw6-theme-asset-path', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'request-path', path: /\/theme\/[0-9a-f]{32}\/(?:css|js|assets)\//, firstParty: true } },
  { id: 'sw6-storefront-bundle-path', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'request-path', path: /\/bundles\/storefront\//, firstParty: true } },
  { id: 'sw6-plugin-manager-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'PluginManager' } },
  { id: 'sw6-sales-channel-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'salesChannelId' } },
  { id: 'sw6-theme-js-path-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'themeJsPublicPath' } },
  { id: 'sw6-theme-assets-path-global', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'global', path: 'themeAssetsPublicPath' } },
  { id: 'sw6-language-id-header', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'header', name: 'sw-language-id', value: /^[0-9a-f]{32}$/ } },
  { id: 'sw6-invalidation-states-header', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'header', name: 'sw-invalidation-states' } },
  { id: 'sw6-cookie-permission', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'selector', selector: 'div.cookie-permission-container[data-cookie-permission]' } },
  { id: 'sw6-route-body-class', system: 'shopware', version: 6, strength: 'strong', match: { kind: 'selector', selector: 'body[class*="is-ctl-"]' } },
  // Shopware 5
  { id: 'sw5-web-cache-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /\/web\/cache\/\d{10}_[0-9a-f]{32}\.(?:css|js)$/, firstParty: true } },
  { id: 'sw5-themes-frontend-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /\/themes\/Frontend\/[^/]+\/frontend\/_public\//, firstParty: true } },
  { id: 'sw5-engine-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /\/engine\/Shopware\//, firstParty: true } },
  { id: 'sw5-statistic-path', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'request-path', path: /\/widgets\/index\/refreshStatistic/, firstParty: true } },
  { id: 'sw5-state-manager-global', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'global', path: 'StateManager' } },
  { id: 'sw5-csrf-config-global', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'global', path: 'csrfConfig' } },
  { id: 'sw5-route-body-class', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'selector', selector: 'body[class*="is--ctl-"]' } },
  { id: 'sw5-cookie-permission', system: 'shopware', version: 5, strength: 'strong', match: { kind: 'selector', selector: 'div.page-wrap--cookie-permission[data-cookie-permission]' } },
  // Wix
  { id: 'wix-generator', system: 'wix', strength: 'strong', match: { kind: 'generator', content: /^Wix\.com Website Builder/i } },
  { id: 'wix-request-id-header', system: 'wix', strength: 'strong', match: { kind: 'header', name: 'x-wix-request-id' } },
  { id: 'wix-pepyaka-server', system: 'wix', strength: 'strong', match: { kind: 'header', name: 'server', value: /^Pepyaka(?:\/[0-9.]+)?$/i } },
  { id: 'wix-thunderbolt-path', system: 'wix', strength: 'strong', match: { kind: 'request-path', path: /^\/services\/wix-thunderbolt\/dist\//, firstParty: false, host: /^static\.parastorage\.com$/ } },
  { id: 'wix-thunderbolt-pages-path', system: 'wix', strength: 'strong', match: { kind: 'request-path', path: /^\/pages\/pages\/thunderbolt/, firstParty: false, host: /^siteassets\.parastorage\.com$/ } },
  { id: 'wix-free-final-host', system: 'wix', strength: 'strong', match: { kind: 'final-host', host: /\.(?:wixsite\.com|wixstudio\.io)$/ } },
  { id: 'wix-bi-session-global', system: 'wix', strength: 'strong', match: { kind: 'global', path: 'wixBiSession' } },
  { id: 'wix-performance-global', system: 'wix', strength: 'strong', match: { kind: 'global', path: 'wixPerformanceMeasurements' } },
  { id: 'wix-developers-analytics-global', system: 'wix', strength: 'strong', match: { kind: 'global', path: 'wixDevelopersAnalytics' } },
  { id: 'wix-viewer-model', system: 'wix', strength: 'strong', match: { kind: 'selector', selector: 'script#wix-viewer-model' } },
  { id: 'wix-parastorage-host', system: 'wix', strength: 'weak', match: { kind: 'request-host', host: /^(?:static|siteassets)\.parastorage\.com$/ } },
  { id: 'wix-wixstatic-host', system: 'wix', strength: 'weak', match: { kind: 'request-host', host: /^static\.wixstatic\.com$/ } },
  { id: 'wix-frog-host', system: 'wix', strength: 'weak', match: { kind: 'request-host', host: /^frog\.wix\.com$/ } },
  // Jimdo
  { id: 'jimdo-generator', system: 'jimdo', strength: 'strong', match: { kind: 'generator', content: /^Jimdo\b/i } },
  { id: 'jimdo-header', system: 'jimdo', strength: 'strong', match: { kind: 'header', name: 'x-jimdo-wid' } },
  { id: 'jimdo-instance-header', system: 'jimdo', strength: 'strong', match: { kind: 'header', name: 'x-jimdo-instance' } },
  { id: 'jimdo-free-final-host', system: 'jimdo', strength: 'strong', match: { kind: 'final-host', host: /\.(?:jimdofree|jimdosite|jimdoweb)\.com$/ } },
  { id: 'jimdo-data-global', system: 'jimdo', strength: 'strong', match: { kind: 'global', path: 'jimdoData' } },
  { id: 'jimdo-dolphin-data-global', system: 'jimdo', strength: 'strong', match: { kind: 'global', path: 'jimdoDolphinData' } },
  { id: 'jimdo-web-js-path', system: 'jimdo', strength: 'strong', match: { kind: 'request-path', path: /^\/(?:web|cookieControl|ckies)\.[0-9a-f]+\.js$/, firstParty: false, host: /^assets\.jimstatic\.com$/ } },
  { id: 'jimdo-layout-path', system: 'jimdo', strength: 'strong', match: { kind: 'request-path', path: /^\/cms\/o\/[^/]+\/layout\//, firstParty: false, host: /^u\.jimcdn\.com$/ } },
  { id: 'jimdo-nav-class', system: 'jimdo', strength: 'weak', match: { kind: 'selector', selector: 'ul.cc-nav-level-0' } },
  { id: 'jimdo-jimstatic-host', system: 'jimdo', strength: 'weak', match: { kind: 'request-host', host: /(?:^|\.)jimstatic\.com$/ } },
  { id: 'jimdo-jimcdn-host', system: 'jimdo', strength: 'weak', match: { kind: 'request-host', host: /(?:^|\.)jimcdn\.com$/ } },
];

/** Dotted global paths the page snapshot looks up (`PlatformHints.globals`). */
export const PLATFORM_GLOBALS: readonly string[] = [...new Set(FINGERPRINTS.flatMap((f) => (f.match.kind === 'global' ? [f.match.path] : [])))];
/** CSS selectors the page snapshot tests (`PlatformHints.selectors`). */
export const PLATFORM_SELECTORS: readonly string[] = [...new Set(FINGERPRINTS.flatMap((f) => (f.match.kind === 'selector' ? [f.match.selector] : [])))];
