import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePlatform } from '../src/analyzers/platform.ts';
import type { PageSnapshot, PlatformHints } from '../src/capture/types.ts';
import { FINGERPRINTS, PLATFORM_GLOBALS, PLATFORM_SELECTORS } from '../src/platform/fingerprints.ts';
import { makeCapture, REPO_ROOT, SITE, type RequestInput } from './helpers.ts';

/** Session A4: system detection on synthetic captures (invented hosts only). */

function capture(input: { headers?: Record<string, string>; requests?: RequestInput[]; hints?: Partial<PlatformHints>; finalUrl?: string }) {
  const page: PageSnapshot = {
    title: 'Start',
    lang: 'de',
    text: '',
    textTruncated: false,
    links: [],
    linksTruncated: false,
    platform: { generators: [], globals: [], selectors: [], ...input.hints },
  };
  return makeCapture({
    requests: input.requests ?? [],
    page,
    ...(input.finalUrl ? { finalUrl: input.finalUrl, requestedUrl: input.finalUrl } : {}),
    mainDocument: { status: 200, headers: input.headers ?? {}, redirectChain: [] },
  });
}

describe('analyzePlatform', () => {
  it('detects WordPress with WooCommerce from own files and page hints', () => {
    const result = analyzePlatform(
      capture({
        requests: [{ url: `${SITE}wp-content/themes/x/style.css` }, { url: `${SITE}wp-content/plugins/woocommerce/assets/js/frontend/add-to-cart.min.js` }],
        hints: { selectors: ['body.woocommerce-js, body.woocommerce-no-js'] },
      }),
    );
    expect(result).toMatchObject({ system: 'wordpress', woocommerce: true, conflict: false });
  });

  it('detects WordPress without WooCommerce, also when the generator is removed', () => {
    const result = analyzePlatform(capture({ headers: { link: '<https://www.example.de/wp-json/>; rel="https://api.w.org/"' } }));
    expect(result).toMatchObject({ system: 'wordpress', woocommerce: false });
  });

  it('does not count WooCommerce without WordPress', () => {
    expect(analyzePlatform(capture({ hints: { globals: ['wc_add_to_cart_params'] } })).woocommerce).toBe(false);
  });

  it('detects Shopify, Shopware 5 and 6, Wix and Jimdo', () => {
    expect(analyzePlatform(capture({ headers: { 'powered-by': 'Shopify' }, requests: [{ url: `${SITE}cdn/shop/t/3/assets/theme.css` }] })).system).toBe('shopify');
    // Session fix-a6 (review finding 75): two files of the system, not one.
    const sw6 = analyzePlatform(capture({ requests: [{ url: `${SITE}theme/0123456789abcdef0123456789abcdef/css/all.css` }, { url: `${SITE}theme/0123456789abcdef0123456789abcdef/js/all.js` }] }));
    expect(sw6).toMatchObject({ system: 'shopware', shopwareVersion: 6 });
    const sw5 = analyzePlatform(capture({ requests: [{ url: `${SITE}web/cache/1700000000_0123456789abcdef0123456789abcdef.css` }, { url: `${SITE}web/cache/1700000000_0123456789abcdef0123456789abcdef.js` }], hints: { globals: ['StateManager'] } }));
    expect(sw5).toMatchObject({ system: 'shopware', shopwareVersion: 5 });
    expect(analyzePlatform(capture({ headers: { 'x-wix-request-id': '1.2' } })).system).toBe('wix');
    expect(analyzePlatform(capture({ hints: { generators: ['Jimdo Dolphin'] } })).system).toBe('jimdo');
    expect(analyzePlatform(capture({ finalUrl: 'https://muster.jimdofree.com/' })).system).toBe('jimdo');
  });

  it('never names a system from weak signals alone', () => {
    // A site on another system with a Shopify buy button and a hotlinked Wix image.
    const result = analyzePlatform(capture({ requests: [{ url: 'https://cdn.shopify.com/s/files/1/buy-button.js' }, { url: 'https://static.wixstatic.com/media/a.jpg' }] }));
    expect(result.system).toBe('unknown');
    expect(result.signals.map((s) => s.strength)).toEqual(['weak', 'weak']);
  });

  it('ignores platform files of another site and requests inside iframes', () => {
    const result = analyzePlatform(
      capture({
        requests: [
          { url: 'https://blog.other-site.example/wp-content/uploads/a.jpg' },
          { url: 'https://shop.embedded.example/cdn/shop/files/b.jpg', isMainFrame: false, frameUrls: ['https://shop.embedded.example/'] },
        ],
      }),
    );
    expect(result.system).toBe('unknown');
  });

  it('takes the system with more strong signals, and gives "unbekannt" on a tie', () => {
    // Session fix-a6: salesChannelId is weak now; two strong Shopware selectors make the conflict.
    const mixed = analyzePlatform(capture({ requests: [{ url: `${SITE}wp-content/a.css` }, { url: `${SITE}wp-includes/b.js` }], hints: { generators: ['WordPress 6.9'], selectors: ['div.cookie-permission-container[data-cookie-permission]', 'body[class*="is-ctl-"]'] } }));
    expect(mixed).toMatchObject({ system: 'wordpress', conflict: true });
    const tie = analyzePlatform(capture({ hints: { generators: ['WordPress 6.9', 'Jimdo Creator'] } }));
    expect(tie).toMatchObject({ system: 'unknown', conflict: true });
  });

  it('does not name a system from uploads, media files or other subdomains of the same domain', () => {
    // Code review, 22.11.2026: a TYPO3 page with an old WordPress upload, a blog teaser, a shop image.
    const result = analyzePlatform(
      capture({
        requests: [
          { url: `${SITE}wp-content/uploads/2019/05/alt.jpg` },
          { url: 'https://blog.example.de/wp-content/themes/x/style.css' },
          { url: 'https://shop.example.de/cdn/shop/t/3/assets/theme.css' },
          { url: `${SITE}cdn/shop/files/produkt.jpg` },
        ],
        hints: { generators: ['TYPO3 CMS'] },
      }),
    );
    expect(result.system).toBe('unknown');
    expect(result.signals.every((s) => s.strength === 'weak')).toBe(true);
  });

  it('reads the Jimdo asset names with the inner ".js"', () => {
    expect(analyzePlatform(capture({ requests: [{ url: 'https://assets.jimstatic.com/web.js.5ad5c63c0c3d8fc4a3e1.js' }, { url: 'https://assets.jimstatic.com/cookieControl.js.0d7e3c2a8a7f1b5c9e3d.js' }] })).system).toBe('jimdo');
  });

  it('gives "unbekannt" for a site without any signal', () => {
    expect(analyzePlatform(capture({})).system).toBe('unknown');
  });
});

describe('fingerprint data', () => {
  it('has unique ids, and every id is documented in docs/cms-fingerprints.md', () => {
    const ids = FINGERPRINTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const doc = readFileSync(resolve(REPO_ROOT, 'docs/cms-fingerprints.md'), 'utf8');
    for (const id of ids) expect(doc, id).toContain(`\`${id}\``);
  });

  it('every selector is valid CSS syntax for the page script and globals are plain paths', () => {
    for (const selector of PLATFORM_SELECTORS) expect(selector).not.toMatch(/[`\\]/);
    for (const path of PLATFORM_GLOBALS) expect(path).toMatch(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/);
  });
});
