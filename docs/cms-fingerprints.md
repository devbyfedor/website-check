# System detection: signals and sources

Session A4. The scanner names the system a site runs on: WordPress (and whether WooCommerce is active), Shopify, Shopware, Wix, Jimdo, otherwise "unbekannt". The signals are code in `scanner/src/platform/fingerprints.ts`; this file documents each one under its id. A unit test checks that every id of the code is listed here.

## What the scan can see

Only what a normal visit without interaction gives: the headers of the main document, the request URLs of the top-level document (requests inside iframes do not count), the final URL, and once at the end of the visit inside the page: the contents of every `<meta name="generator">`, whether a fixed list of JavaScript globals exists, and whether a fixed list of CSS selectors matches. No extra request, no probing of paths.

## How the system is decided

- `strong`: produced by the platform's own page rendering; a site on another system does not show it.
- `weak`: can also appear on another system (a Shopify Buy Button, a hotlinked Wix image, a Wix or WordPress headless setup, a theme ported from another system). Weak signals are listed in the result but never name a system on their own.
- The system is the one with strong evidence. Since session fix-a6 (review finding 75), one strong signal names the system alone only when it is decisive: a header of the main document, the generator meta tag or the final host. Otherwise the system needs two pieces of strong evidence: two different strong signals, or two different files of the system that the site served (each answered request to a file path of the system counts once; the same address twice counts once). A path or host signal counts only for a request answered with a status from 200 to 399: a leftover link that gives 404 proves nothing. If two systems have such evidence, the one with more pieces wins and the result is marked `conflict`; a tie gives "unbekannt". Otherwise "unbekannt".
- WooCommerce is reported only together with WordPress. Shopware gets a major version (5 or 6) when its strong signals agree.
- Path signals marked "on the site's own host" count only on the host of the requested address, of the final URL or of a redirect hop, with or without "www." (changed after the code review of 22.11.2026: another subdomain of the same domain can be a blog or a shop on another system).

## Research and check

Done on 22.11.2026 by three research helpers (one per group of systems) and one skeptical reviewer per group who opened every source again and tried to refute it. No business website was visited and nothing in `local/` was read for the research. Sources are the platforms' own source code on GitHub, their developer documentation and help centers, and, marked as such, open fingerprint datasets (enthec/webappanalyzer, the open fork of the Wappalyzer data; DuckDuckGo Tracker Radar; WhatWeb). Where only a dataset or a forum supports a signal, it says so below. The Shopify and Shopware reviewer confirmed 40 of 41 claims; the one not confirmed (a same-site Shopify telemetry path, forum sources only) is not used, and two generic global names were made weak on the reviewer's advice. The WordPress reviewer confirmed 27 of 27, the Wix and Jimdo reviewer 28 of 28 (one Jimdo selector made weak). Two signals rest on our own observation of the saved captures of the test sites (counted, without names), and say so.

After the research, the signals were compared with the saved captures of the 30 test sites (session A3, no new visit): with requests and headers alone, 28 of 30 systems matched the system noted when the sites were chosen; the two others (a WooCommerce shop whose homepage loads no WooCommerce file, and a Jimdo Dolphin site) need the page hints (body class, generator), which captures from A4 on contain.

## WordPress

- `wp-generator` (strong): `<meta name="generator" content="WordPress …">`. Source: WordPress core, `get_the_generator()` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/general-template.php, printed in the head by `add_action( 'wp_head', 'wp_generator' )` in `default-filters.php`. Many sites remove it; the signals below survive that.
- `wp-api-link` (strong): `<link rel="https://api.w.org/">` in the head. Source: `rest_output_link_wp_head()` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/rest-api.php.
- `wp-api-header` (strong): HTTP header `Link: <…/wp-json/>; rel="https://api.w.org/"` (substring match, a second Link value may be joined). Source: `rest_output_link_header()` in the same `rest-api.php`.
- `wp-content-path` (strong): a request to `/wp-content/` (not `/wp-content/uploads/`) or `/wp-includes/` (at the root or one folder deep) on the site's own host. Source: `WP_CONTENT_URL` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/default-constants.php and `WPINC` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-settings.php. Installs with renamed folders (for example Bedrock) do not match.
- `wp-block-library-css` (strong): `link#wp-block-library-css` or `style#wp-block-library-inline-css`. Source: the id pattern `'%s-css'` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/class-wp-styles.php.
- `wp-global-styles` (strong): `style#global-styles-inline-css` (WordPress 5.8 and later). Source: `wp_enqueue_global_styles()` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/script-loader.php.
- `wp-emoji-settings` (strong): global `_wpemojiSettings` (up to WordPress 6.8). Source: https://github.com/WordPress/wordpress-develop/blob/trunk/src/js/_enqueues/lib/emoji-loader.js.
- `wp-emoji-settings-json` (strong): `script#wp-emoji-settings` (WordPress 6.9). Source: `print_emoji_detection_script()` in https://github.com/WordPress/wordpress-develop/blob/6.9/src/wp-includes/formatting.php.
- `wp-uploads-path` (weak): a request to `/wp-content/uploads/` on the site's own host. Weak because uploaded images are hotlinked and stay after a move away from WordPress (found by the code review). Source: as `wp-content-path`.
- `wp-json-path` (weak): a request to `/wp-json/` on the site's own hosts. Weak because headless front ends call the API of a WordPress elsewhere. Source: `rest_get_url_prefix()` in `rest-api.php`.
- `wp-pingback-header` (weak): header `X-Pingback: …/xmlrpc.php`. Source: `WP::send_headers()` in https://github.com/WordPress/wordpress-develop/blob/trunk/src/wp-includes/class-wp.php.
- `wp-content-path-elsewhere` (weak): `/wp-content/` or `/wp-includes/` on another site's host (hotlinked files, image CDNs). Source: dataset, https://github.com/enthec/webappanalyzer/blob/main/src/technologies/w.json.

## WooCommerce

- `wc-generator` (strong): `<meta name="generator" content="WooCommerce …">`, added to the WordPress generator, so it disappears when that one is removed. Source: `wc_generator_tag()` in https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/wc-template-functions.php.
- `wc-js-body-class` (strong): `body.woocommerce-no-js`, turned into `woocommerce-js` by an inline script, on every page. Source: `wc_body_class()` and `wc_no_js()` in the same file.
- `wc-page-body-class` (strong): `body.woocommerce` or `body.woocommerce-page` (shop pages only). Source: `wc_body_class()` in the same file.
- `wc-inline-style` (strong): `style#woocommerce-inline-inline-css`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/includes/class-wc-frontend-scripts.php.
- `wc-stylesheets` (strong): `link#woocommerce-general-css`, `#woocommerce-layout-css` or `#woocommerce-smallscreen-css`. Source: the same file.
- `wc-plugin-path` (strong): a request to `/wp-content/plugins/woocommerce/` on the site's own hosts. Source: `WC_Frontend_Scripts::get_asset_url()` in the same file.
- `wc-params`, `wc-add-to-cart-params` (strong): globals `woocommerce_params`, `wc_add_to_cart_params`. Source: the localized script data in `class-wc-frontend-scripts.php`.
- `wc-cart-fragments-params` (strong): global `wc_cart_fragments_params`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/client/legacy/js/frontend/cart-fragments.js.
- `wc-order-attribution` (strong): global `wc_order_attribution`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/Internal/Orders/OrderAttributionController.php.
- `wc-settings` (strong): global `wcSettings`. Source: https://github.com/woocommerce/woocommerce/blob/trunk/plugins/woocommerce/src/Blocks/Assets/AssetDataRegistry.php.
- `wc-store-api-path` (weak): a request to `/wp-json/wc/store/`. Source: https://developer.woocommerce.com/docs/apis/store-api/.

## Shopify

- `shopify-powered-by-header` (strong): header `powered-by: Shopify`. Source: https://http.dev/powered-by (not a Shopify document); also present on 4 of 4 Shopify test shops in the saved captures.
- `shopify-complexity-header` (strong): header `shopify-complexity-score` with a number. Source: https://http.dev/shopify-complexity-score (unofficial header, not a Shopify document).
- `shopify-shopid-header`, `shopify-sorting-hat-header` (strong): headers `x-shopid`, `x-sorting-hat-shopid` of older storefronts. Source: dataset, https://github.com/enthec/webappanalyzer/blob/main/src/technologies/s.json. Current storefronts no longer send them; they only add evidence.
- `shopify-stage-header` (strong): header `x-shopify-stage`. Source: dataset, https://github.com/urbanadventurer/WhatWeb/blob/master/plugins/shopify.rb.
- `shopify-cdn-shop-path` (strong): a request to the theme files `/cdn/shop/t/<n>/assets/` or to `/cdn/shopifycloud/` on the site's own host, where Shopify has served store files since 2023. Source: the `asset_url` and `shopify_asset_url` filters, https://shopify.dev/docs/api/liquid/filters/asset_url and https://shopify.dev/docs/api/liquid/filters/shopify_asset_url.
- `shopify-cdn-shop-media-path` (weak): `/cdn/shop/files/` or `/cdn/shop/products/` on the site's own host: media files, which can be hotlinked. Source: as `shopify-cdn-shop-path`.
- `shopify-routes-global` (strong): global `Shopify.routes.root`. Source: https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages.
- `shopify-shop-global` (strong): global `Shopify.shop`. Source: only a forum thread, https://community.shopify.com/t/window-shopify-shop-property-on-inspect-f12-debugger-tools-console/196071.
- `shopify-analytics-global` (strong): global `ShopifyAnalytics`. Source: dataset, webappanalyzer `s.json`.
- `shopify-wallet-meta` (strong): `meta[name="shopify-digital-wallet"]` or `meta[name="shopify-checkout-api-token"]`. Source: dataset, webappanalyzer `s.json`.
- `shopify-section` (strong): `div.shopify-section` with an id `shopify-section-…`. Source: https://shopify.dev/docs/api/ajax/section-rendering.
- `shopify-myshopify-final-host` (strong): the final URL is on `*.myshopify.com`. Source: dataset, webappanalyzer `s.json`.
- `shopify-cdn-host` (weak): requests to `cdn.shopify.com`. Weak in both directions: other sites load it through the Buy Button, and current stores may not load it at all. Source: dataset, webappanalyzer `s.json`.

## Shopware 6

- `sw6-theme-asset-path` (strong): requests to `/theme/<32 hex>/css|js|assets/` on the site's own hosts. Source: `ThemeCompiler` in https://github.com/shopware/shopware/blob/trunk/src/Storefront/Theme/ThemeCompiler.php.
- `sw6-storefront-bundle-path` (weak since fix-a6: any Symfony application can have a bundle of that name): requests to `/bundles/storefront/`. Source: https://github.com/shopware/shopware/blob/6.7.16.x/src/Storefront/Theme/ThemeCompiler.php.
- `sw6-plugin-manager-global` (weak): global `PluginManager`. Weak because the reviewer found the name generic: a script on another system could define it. Source: https://github.com/shopware/shopware/blob/trunk/src/Storefront/Resources/app/storefront/src/plugin-system/plugin.manager.js.
- `sw6-theme-js-path-global`, `sw6-theme-assets-path-global` (strong): globals `themeJsPublicPath`, `themeAssetsPublicPath`; `sw6-sales-channel-global` (weak since fix-a6, a generic name): global `salesChannelId`. Source: https://github.com/shopware/shopware/blob/trunk/src/Storefront/Resources/views/storefront/layout/meta.html.twig (and the 6.6.x branch for `themeAssetsPublicPath`).
- `sw6-language-id-header` (strong): header `sw-language-id` with 32 hex digits. Source: https://github.com/shopware/shopware/blob/trunk/src/Storefront/Framework/Routing/RequestTransformer.php.
- `sw6-invalidation-states-header` (strong): header `sw-invalidation-states`. Source: https://github.com/shopware/shopware/blob/trunk/src/Core/Framework/Adapter/Cache/Http/HttpCacheKeyGenerator.php.
- `sw6-cookie-permission` (strong): `div.cookie-permission-container[data-cookie-permission]`. Source: https://github.com/shopware/shopware/blob/trunk/src/Storefront/Resources/views/storefront/layout/cookie/cookie-permission.html.twig.
- `sw6-route-body-class` (strong): a body class `is-ctl-…`. Source: https://github.com/shopware/shopware/blob/trunk/src/Storefront/Resources/views/storefront/base.html.twig.

## Shopware 5

- `sw5-web-cache-path` (strong): `/web/cache/<10 digits>_<32 hex>.css|js`. Source: https://github.com/shopware5/shopware/blob/5.7/engine/Shopware/Components/Theme/PathResolver.php.
- `sw5-themes-frontend-path` (strong): `/themes/Frontend/<theme>/frontend/_public/`. Source: https://github.com/shopware5/shopware/blob/5.7/themes/Frontend/Bare/Theme.php.
- `sw5-engine-path` (strong): `/engine/Shopware/`. Source: dataset, webappanalyzer `s.json`.
- `sw5-statistic-path` (strong): `/widgets/index/refreshStatistic`. Source: https://github.com/shopware5/shopware/blob/5.7/themes/Frontend/Bare/widgets/index/statistic_include.tpl.
- `sw5-state-manager-global` (weak): global `StateManager`. Weak for the same reason (a generic name). Source: https://github.com/shopware5/shopware/blob/5.7/themes/Frontend/Responsive/frontend/_public/src/js/jquery.state-manager.js.
- `sw5-csrf-config-global` (weak since fix-a6, a generic name that other frameworks use): global `csrfConfig`. Source: https://github.com/shopware5/shopware/blob/5.7/themes/Frontend/Bare/frontend/index/index.tpl.
- `sw5-route-body-class` (strong): a body class `is--ctl-…`. Source: the same `index.tpl`.
- `sw5-cookie-permission` (strong): `div.page-wrap--cookie-permission[data-cookie-permission]`. Source: https://github.com/shopware5/shopware/blob/5.7/themes/Frontend/Bare/frontend/_includes/cookie_permission_note.tpl.

## Wix

- `wix-generator` (strong): `<meta name="generator" content="Wix.com Website Builder">`. Source: dataset, https://github.com/enthec/webappanalyzer/blob/main/src/technologies/w.json.
- `wix-request-id-header` (strong): header `x-wix-request-id`. Source: https://dev.wix.com/docs/develop-websites/articles/contact-us/submit-support-requests.md (names the header on Wix responses; its presence on site documents is from the dataset and the reviewer's own request to a Wix-served page).
- `wix-pepyaka-server` (strong): header `server: Pepyaka`. Source: a forum answer, https://answers.netlify.com/t/hide-server-signature/11241, confirmed by the reviewer's own request to a Wix-served page.
- `wix-thunderbolt-path` (strong): requests to `static.parastorage.com/services/wix-thunderbolt/dist/` from the top-level document. Source: dataset, DuckDuckGo Tracker Radar, https://github.com/duckduckgo/tracker-radar/blob/main/domains/DE/parastorage.com.json. Wix headless sites do not load it.
- `wix-thunderbolt-pages-path` (strong): requests to `siteassets.parastorage.com/pages/pages/thunderbolt`. Source: the same Tracker Radar file.
- `wix-free-final-host` (strong): the final URL is on `*.wixsite.com` or `*.wixstudio.io`. Source: https://dev.wix.com/docs/develop-websites/articles/coding-with-velo/frontend-code/urls/about-the-url-structure-of-premium-and-free-sites.md.
- `wix-bi-session-global`, `wix-performance-global` (strong): globals `wixBiSession`, `wixPerformanceMeasurements`. Source: dataset, webappanalyzer `w.json`.
- `wix-developers-analytics-global` (strong): global `wixDevelopersAnalytics`. Source: https://dev.wix.com/docs/api-reference/app-management/embedded-scripts/sample-flows.md.
- `wix-viewer-model` (strong): `script#wix-viewer-model`. Source: dataset, webappanalyzer `w.json`.
- `wix-parastorage-host`, `wix-wixstatic-host`, `wix-frog-host` (weak): requests to `static.parastorage.com`, `siteassets.parastorage.com`, `static.wixstatic.com`, `frog.wix.com`. Weak because Wix headless sites on any host load them. Source: https://dev.wix.com/docs/go-headless/self-managed-headless/site-scripts/load-site-scripts-on-a-self-managed-project.md.

## Jimdo

- `jimdo-generator` (strong): `<meta name="generator" content="Jimdo …">` ("Jimdo Creator", "Jimdo Dolphin"). Source: our own observation: present on 3 of 3 Jimdo test sites in the saved captures; the research found no vendor document for it.
- `jimdo-header`, `jimdo-instance-header` (strong): headers `x-jimdo-wid`, `x-jimdo-instance`. Source: dataset, https://github.com/enthec/webappanalyzer/blob/main/src/technologies/j.json; `x-jimdo-wid` also on 2 of 3 Jimdo test sites.
- `jimdo-free-final-host` (strong): the final URL is on `*.jimdofree.com`, `*.jimdosite.com` or `*.jimdoweb.com`. Source: Jimdo help center, https://help.jimdo.com/hc/en-us/articles/26930493036700-Which-Jimdo-product-am-I-using-Creator-or-Website-Builder and https://help.jimdo.com/hc/en-us/articles/360035505031-Why-did-the-name-of-my-Creator-subdomain-change.
- `jimdo-data-global` (strong): global `jimdoData` (Creator). Source: dataset, Wappalyzer 5.9.0 `apps.json` (https://unpkg.com/wappalyzer@5.9.0/apps.json).
- `jimdo-dolphin-data-global` (strong): global `jimdoDolphinData` (Website builder). Source: dataset, webappanalyzer `j.json`.
- `jimdo-web-js-path` (strong): `assets.jimstatic.com/web.js.<hash>.js` (also without the inner ".js") (also `cookieControl.js`, `ckies.js`) from the top-level document. Source: dataset, https://github.com/duckduckgo/tracker-radar/blob/main/domains/US/jimstatic.com.json.
- `jimdo-layout-path` (strong): `u.jimcdn.com/cms/o/<site>/layout/` stylesheets. Source: dataset, https://github.com/duckduckgo/tracker-radar/blob/main/domains/US/jimcdn.com.json.
- `jimdo-nav-class` (weak): `ul.cc-nav-level-0`. Source: https://github.com/Jimdo/template-boilerplate/blob/master/sass/partials/_navigation.sass. Weak: the reviewer noted that such class names can appear outside Jimdo.
- `jimdo-jimstatic-host`, `jimdo-jimcdn-host` (weak): requests to `*.jimstatic.com` or `*.jimcdn.com`. Source: dataset, https://github.com/duckduckgo/tracker-radar/blob/main/entities/Jimdo%20GmbH.json.

## Left out on purpose

- WordPress: `link[rel="EditURI"]`, `body[class*="wp-theme-"]` (only recent core), oEmbed discovery links, the import map of script modules; enough strong WordPress signals without them.
- Shopify: the same-site `/.well-known/shopify/monorail/` path (only forum sources), the Link preconnect header to `cdn.shopify.com`.
- Shopware 6: `window.router`, `window.features`, `form[data-search-widget]`, `div.scroll-up-container`; Shopware 5: `/csrftoken`, `statisticDevices`, `iframe#refresh-statistics`, `div.container--ajax-cart`.
- Wix: `x-wix-renderer-server` and `x-wix-server-artifact-id` (in the dataset, but not sent any more by Wix-served pages the reviewer checked); session cookies (the capture does not record cookies).
- Jimdo: `a.jimdo.com/app/web/loginstate`, the `jtpl-` template classes.
