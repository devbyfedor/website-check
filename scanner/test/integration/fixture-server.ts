import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createLocalGuard } from '../../src/local/node-resolver.ts';
import { heavyPage } from './heavy-pages.ts';
import { CSP_META_PAGES, fieldPage, HOSTILE_AXE_PAGES } from './hostile-a6-pages.ts';

/** Accessibility fixture pages of session A3, served as `www.a11y.test/<file>`. */
const A11Y_DIR = resolve(import.meta.dirname, '../../fixtures/a11y');

/**
 * A tiny HTTP server for the integration tests. It answers for several made-up host names
 * (`www.shop.test`, `fonts.thirdparty.test`, …); Chromium maps them all to 127.0.0.1 with
 * `--host-resolver-rules`, so no request leaves the machine.
 */

export interface FixtureServer {
  port: number;
  url(host: string, path?: string): string;
  close(): Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse, port: number) => void;

const routes: Record<string, Handler> = {};

function route(host: string, path: string, handler: Handler): void {
  routes[`${host}${path}`] = handler;
}

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const html = (body: string, head = ''): string =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Fixture</title>${head}</head><body>${body}</body></html>`;

// 1. A shop homepage reached through a redirect, with first-party files, Google-Fonts-like
//    third-party CSS and fonts, a tracker script with a beacon, an embedded video iframe
//    that loads an ad pixel, and a consent banner that appears after 800 ms.
route('www.shop.test', '/start', (_req, res, port) => {
  res.writeHead(301, { location: `http://www.shop.test:${port}/` });
  res.end();
});
route('www.shop.test', '/', (_req, res, port) => {
  const p = (host: string, path: string): string => `http://${host}:${port}${path}`;
  send(
    res,
    200,
    'text/html; charset=utf-8',
    html(
      `<h1>Willkommen</h1>
       <a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a>
       <img src="${p('cdn.shop.test', '/logo.svg')}" alt="Logo">
       <iframe src="${p('video.thirdparty.test', '/embed/1')}" width="300" height="200" title="Video"></iframe>
       <div id="CybotCookiebotDialog" style="display:none;position:fixed;bottom:0;left:0;right:0;height:180px;background:#fff">
         Wir verwenden Cookies. <button>Alle akzeptieren</button>
       </div>
       <script>setTimeout(function () { document.getElementById('CybotCookiebotDialog').style.display = 'block'; }, 800);</script>
       <script src="${p('tracker.thirdparty.test', '/t.js')}"></script>`,
      `<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="${p('fonts.thirdparty.test', '/css?family=Test')}">`,
    ),
    { 'x-fixture': 'shop-home', 'strict-transport-security': 'max-age=1' },
  );
});
route('www.shop.test', '/style.css', (_req, res) => send(res, 200, 'text/css', 'body { color: #222; }'));
route('www.shop.test', '/impressum', (_req, res) => send(res, 200, 'text/html', html('Impressum')));
route('cdn.shop.test', '/logo.svg', (_req, res) =>
  send(res, 200, 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'),
);
route('fonts.thirdparty.test', '/css', (_req, res, port) =>
  send(res, 200, 'text/css', `@font-face { font-family: Test; src: url(http://fontfiles.thirdparty.test:${port}/test.woff2) format('woff2'); } h1 { font-family: Test; }`),
);
route('fontfiles.thirdparty.test', '/test.woff2', (_req, res) => send(res, 200, 'font/woff2', 'not really a font'));
route('tracker.thirdparty.test', '/t.js', (_req, res, port) =>
  send(res, 200, 'application/javascript', `setTimeout(function () { navigator.sendBeacon('http://tracker.thirdparty.test:${port}/collect', 'x'); }, 300);`),
);
route('tracker.thirdparty.test', '/collect', (_req, res) => send(res, 204, 'text/plain', ''));
route('video.thirdparty.test', '/embed/1', (_req, res, port) =>
  send(res, 200, 'text/html', html(`<img src="http://ads.adnetwork.test:${port}/pixel.gif" alt="">`)),
);
route('ads.adnetwork.test', '/pixel.gif', (_req, res) => send(res, 200, 'image/gif', 'GIF89a'));

// 2. A page that keeps the network busy forever (long polling): must stop at maxWaitMs.
route('www.busy.test', '/', (_req, res) =>
  send(
    res,
    200,
    'text/html',
    html(`<script>function poll(){ fetch('/poll?' + Math.random()).then(function(){ poll(); }); } poll();</script>`),
  ),
);
route('www.busy.test', '/poll', (_req, res) => {
  setTimeout(() => send(res, 200, 'text/plain', 'ok'), 400);
});

// 3. Consent banners that the probe must see, and look-alikes it must not take for a banner.
const shadowBox = (hostTag: string, hostAttrs: string, inner: string): string =>
  `<${hostTag} id="host" ${hostAttrs}></${hostTag}>
   <script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = ${JSON.stringify(inner)};</script>`;
const consentText = '<p>Diese Website verwendet Cookies, um Ihnen das beste Nutzererlebnis zu bieten.</p><button>Akzeptieren</button><button>Ablehnen</button>';
// A zero-size custom element whose open shadow root holds a fixed dialog in the middle.
route('www.banner.test', '/shadow-dialog', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Shop</h1>` +
    shadowBox('consent-box', 'role="region" aria-label="Cookie consent" style="position:fixed;top:0;left:0"',
      `<dialog open style="position:fixed;top:300px;left:520px;width:400px;height:260px;margin:0;background:#fff">${consentText}</dialog>`))));
// An empty wrapper at the end of the page whose open shadow root holds a fixed bar at the top.
route('www.banner.test', '/shadow-top', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Maler</h1><p style="height:2000px">Inhalt</p>` +
    shadowBox('div', '',
      `<div style="position:fixed;top:0;left:0;right:0;height:120px;background:#fff">Auf dieser Webseite kommen einwilligungsbedürftige Cookies zum Einsatz. <a href="#">Cookie-Einstellungen</a><button>Alle akzeptieren</button></div>`))));
// A 40 px bar at the very bottom, below the old probe points.
route('www.banner.test', '/bottom-bar', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Praxis</h1>
    <div class="notice" style="position:fixed;bottom:0;left:0;right:0;height:40px;background:#000;color:#fff">Diese Webseite benutzt Cookies. <a href="#">Zustimmen</a></div>`)));
// The Cookie Notice plugin bar with the classes of an older version.
route('www.banner.test', '/cookie-notice', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Praxis</h1>
    <div id="cookie-notice" role="banner" class="cn-bottom bootstrap" style="position:fixed;bottom:0;left:0;right:0;height:70px;visibility:visible">Diese Webseite benutzt Cookies. <a href="#">Zustimmen</a></div>`)));
// No banner, every look-alike under a probe point of the 1440 x 900 window: a sticky header and
// a 45 px footer bar with a "Cookie-Einstellungen" link (consent word only in a link), a small
// fixed "Cookie-Einstellungen" box (under 15,000 px²), a reopener with an aria-label in a shadow
// root, a newsletter popup without consent words, and a hidden Cookie Notice bar.
route('www.banner.test', '/look-alikes', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html(`
    <header style="position:sticky;top:0;height:90px;background:#eee"><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a> <a href="#">Cookie-Einstellungen</a></header>
    <p style="height:2000px">Inhalt</p>
    <div style="position:fixed;left:150px;bottom:70px;width:140px;height:36px;background:#ccc">Cookie-Einstellungen <button>Öffnen</button></div>
    <div role="dialog" style="position:fixed;top:250px;left:470px;width:500px;height:300px;background:#fff">Newsletter abonnieren und 10 % sparen <button>Anmelden</button></div>
    <div id="cookie-notice" class="cookie-notice-hidden" style="position:fixed;bottom:0;left:0;right:0;height:70px;visibility:hidden">Diese Webseite benutzt Cookies. <a href="#">Zustimmen</a></div>
    <footer style="position:fixed;bottom:0;left:0;right:0;height:45px;background:#333"><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a> <a href="#">Cookie-Einstellungen</a></footer>` +
    shadowBox('consent-widget', 'aria-label="Cookie-Einstellungen" style="position:fixed;bottom:70px;right:190px;width:60px;height:44px"',
      '<button aria-label="Cookie-Einstellungen öffnen" style="width:60px;height:44px">C</button>'))));

// 4. Security (A3): a page with four headers and a referrer meta tag, and redirect chains for the
//    http redirect check (requested by Node's fetch on 127.0.0.1, so they are routed by path).
route('www.headers.test', '/', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', html('<h1>Kopfzeilen</h1>', '<meta name="referrer" content="no-referrer">'), {
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff',
    'permissions-policy': 'geolocation=()',
  }),
);
route('127.0.0.1', '/redirect/start', (_req, res, port) => {
  res.writeHead(301, { location: `http://127.0.0.1:${port}/redirect/www` });
  res.end();
});
route('127.0.0.1', '/redirect/www', (_req, res) => {
  res.writeHead(308, { location: 'https://www.secure.test/' });
  res.end();
});
route('127.0.0.1', '/plain', (_req, res) => send(res, 200, 'text/html', html('Nur http')));
route('127.0.0.1', '/loop', (_req, res) => {
  res.writeHead(302, { location: '/loop' });
  res.end();
});

// 5. Error pages.
// Session fix-a1: a page whose script never ends: no load event, the hard limit of the page cuts the capture off.
route('www.busy.test', '/forever', (_req, res) => send(res, 200, 'text/html', html('<h1>Besetzt</h1><script>for (;;) {}</script>')));
route('www.blocked.test', '/', (_req, res) => send(res, 403, 'text/html', html('Just a moment...'), { 'cf-mitigated': 'challenge' }));
route('www.broken.test', '/', (_req, res) => send(res, 500, 'text/html', html('Internal Server Error')));

// 6. Session A4: legal links and the Impressum in a second tab.
const IMPRESSUM_PAGES = resolve(import.meta.dirname, '../../fixtures/impressum/pages');
const legalHome = (footer: string, body = '<h1>Willkommen</h1><p>Schöne Seite.</p>'): string =>
  html(`<header><nav><a href="/">Start</a> <a href="/kontakt">Kontakt</a></nav></header><main>${body}</main><footer>${footer}</footer>`);
route('www.legal.test', '/', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', legalHome('<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutzerklärung</a>')),
);
route('www.legal.test', '/impressum', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', readFileSync(resolve(IMPRESSUM_PAGES, '01-gmbh-klassisch.html'), 'utf8')),
);
// The Impressum text is written 1.2 s after the load event: the tab must wait for it.
route('www.slowlegal.test', '/', (_req, res) => send(res, 200, 'text/html; charset=utf-8', legalHome('<a href="/impressum">Impressum</a>')));
route('www.slowlegal.test', '/impressum', (_req, res) =>
  send(
    res,
    200,
    'text/html; charset=utf-8',
    html(`<main id="m">Lade …</main><script>window.addEventListener('load', function () { setTimeout(function () {
      document.getElementById('m').innerText = 'Impressum\\nLangsam GmbH\\nTrägeweg 5\\n12345 Wartestadt\\nE-Mail: info@langsam.example';
    }, 1200); });</script>`),
  ),
);
route('www.onepager.test', '/', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', legalHome('<a href="#impressum">Impressum</a>', '<h1>Willkommen</h1><section id="impressum"><h2>Impressum</h2><p>Eins GmbH<br>Seitenweg 1<br>12345 Einseitig</p></section>')),
);
route('www.nolegal.test', '/', (_req, res) => send(res, 200, 'text/html; charset=utf-8', legalHome('<a href="/kontakt">Kontakt</a>')));
route('www.nolegal.test', '/impressum', (_req, res) => send(res, 200, 'text/html; charset=utf-8', html('Impressum')));

// Session fix-a3 (review finding 6): pages with HTTP 200 behind the Impressum link that are no Impressum.
// The footer of every page carries the firm's data, as many real footers do.
const SOFT_FOOT =
  '<p>Muster Werkstatt GmbH<br>Erlenweg 12<br>12345 Musterhausen</p><p>E-Mail: info@muster-werkstatt.example</p><p>Amtsgericht Musterhausen, HRB 4711 · USt-IdNr. DE123456788</p><p><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></p>';
const softPage = (title: string, main: string): string =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title></head><body><header><nav><a href="/">Start</a></nav></header><main>${main}</main><footer>${SOFT_FOOT}</footer></body></html>`;
const softHome = softPage('Muster Werkstatt – Reparaturen in Musterhausen', '<h1>Muster Werkstatt</h1><p>Ihre Werkstatt in Musterhausen.</p>');
for (const host of ['www.soft404.test', 'www.backhome.test']) route(host, '/', (_req, res) => send(res, 200, 'text/html; charset=utf-8', softHome));
route('www.soft404.test', '/impressum', (_req, res) =>
  send(res, 200, 'text/html; charset=utf-8', softPage('Seite nicht gefunden – Muster Werkstatt', '<h1>Seite nicht gefunden</h1><p>Die angeforderte Seite existiert leider nicht.</p>')),
);
route('www.backhome.test', '/impressum', (_req, res, port) => {
  res.writeHead(302, { location: `http://www.backhome.test:${port}/?lang=de` });
  res.end();
});

// 7. Session A5, SSRF protection. Fixture hosts (*.test) are exempt from the guard in these tests,
//    the internal targets (127.0.0.1 in several notations) are not. `/ssrf/secret` on 127.0.0.1 or
//    localhost counts every request that reaches it: with the guard in place it must stay 0.
let secretHits = 0;
export function ssrfSecretHits(): number {
  return secretHits;
}
const secret: Handler = (_req, res) => {
  secretHits += 1;
  send(res, 200, 'text/html; charset=utf-8', html('<h1>Interner Bereich</h1>'));
};
route('127.0.0.1', '/ssrf/secret', secret);
route('localhost', '/ssrf/secret', secret);
route('www.ssrf.test', '/ok', (_req, res) => send(res, 200, 'text/html; charset=utf-8', html('<h1>Öffentliche Seite</h1>')));
route('www.ssrf.test', '/redirect-loopback', (_req, res, port) => {
  res.writeHead(302, { location: `http://127.0.0.1:${port}/ssrf/secret` });
  res.end();
});
// Decimal notation of 127.0.0.1, after one harmless hop on the exempt host.
route('www.ssrf.test', '/redirect-decimal', (_req, res) => {
  res.writeHead(301, { location: '/redirect-decimal-2' });
  res.end();
});
route('www.ssrf.test', '/redirect-decimal-2', (_req, res, port) => {
  res.writeHead(307, { location: `http://2130706433:${port}/ssrf/secret` });
  res.end();
});
route('www.ssrf.test', '/meta-refresh', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html('<h1>Gleich geht es weiter</h1>', `<meta http-equiv="refresh" content="0; url=http://127.0.0.1:${port}/ssrf/secret">`)),
);
route('www.ssrf.test', '/script-redirect', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><script>setTimeout(function () { location.href = 'http://0x7f.0.0.1:${port}/ssrf/secret'; }, 200);</script>`)),
);
route('www.ssrf.test', '/impressum-internal', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Willkommen</h1><footer><a href="http://127.0.0.1:${port}/ssrf/secret">Impressum</a></footer>`)),
);
// Seven redirects on the exempt host: the sixth is refused.
for (let i = 0; i < 7; i += 1) {
  route('www.ssrf.test', `/chain/${i}`, (_req, res) => {
    res.writeHead(302, { location: `/chain/${i + 1}` });
    res.end();
  });
}
route('www.ssrf.test', '/chain/7', (_req, res) => send(res, 200, 'text/html; charset=utf-8', html('<h1>Ende</h1>')));
// Review of A5: navigation paths outside the plain document request of the first tab.
// A speculation-rules prerender of an allowed page that then navigates to 127.0.0.1 once activated.
route('www.ssrf.test', '/prerender', (_req, res) =>
  send(
    res,
    200,
    'text/html; charset=utf-8',
    html(
      '<h1>Start</h1><script>setTimeout(function () { location.href = "/prerender-next"; }, 1500);</script>',
      '<script type="speculationrules">{"prerender":[{"source":"list","urls":["/prerender-next"]}]}</script>',
    ),
  ),
);
route('www.ssrf.test', '/prerender-next', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Weiter</h1><script>setTimeout(function () { location.href = 'http://127.0.0.1:${port}/ssrf/secret'; }, 300);</script>`)),
);
// A popup opened by script without any user action.
route('www.ssrf.test', '/popup', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><script>window.open('http://127.0.0.1:${port}/ssrf/secret');</script>`)),
);
route('www.ssrf.test', '/popup-noopener', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><script>window.open('http://127.0.0.1:${port}/ssrf/secret', '_blank', 'noopener');</script>`)),
);
route('www.ssrf.test', '/popup-link', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><a id="l" href="http://127.0.0.1:${port}/ssrf/secret" target="_blank">x</a><script>document.getElementById('l').click();</script>`)),
);
// A same-origin iframe that navigates the top document.
route('www.ssrf.test', '/iframe-top', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><iframe srcdoc="<script>top.location = 'http://127.0.0.1:${port}/ssrf/secret';</script>"></iframe>`)),
);
// Session fix-a2, review finding 23: a page that prefetches an internal page with speculation rules and
// moves there right after the scanner read it (the read of `document.title` is the scanner's snapshot).
// The navigation to a prefetched address sends no document request, so the guard on requests does not see it.
export const PRIVATE_MARK = 'INTVAL';
let privateNavigations = 0;
/** Requests to the internal page that were a navigation, not a prefetch. */
export function ssrfPrivateNavigations(): number {
  return privateNavigations;
}
route('127.0.0.1', '/ssrf/private', (req, res) => {
  if (!/prefetch/.test(String(req.headers['sec-purpose'] ?? ''))) privateNavigations += 1;
  send(
    res,
    200,
    'text/html; charset=utf-8',
    `<!doctype html><html><head><meta charset="utf-8"><title>${PRIVATE_MARK}-title</title></head><body><h1>Bereich</h1><p style="color:#bbb;background:#fff">${PRIVATE_MARK}-contrast</p><input type="text" name="${PRIVATE_MARK}-input"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="/${PRIVATE_MARK}-href"></a></body></html>`,
    { 'supports-loading-mode': 'credentialed-prefetch' },
  );
});
route('www.ssrf.test', '/prefetch-swap', (_req, res, port) => {
  const internal = `http://127.0.0.1:${port}/ssrf/private`;
  send(
    res,
    200,
    'text/html; charset=utf-8',
    html(
      '<h1>Willkommen</h1><p>Normaler Inhalt.</p>',
      `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${internal}"],"eagerness":"immediate"}]}</script>
       <script>Object.defineProperty(document, 'title', { get: function () { if (!window.__moved) { window.__moved = true; setTimeout(function () { location.href = '${internal}'; }, 0); } return 'Startseite'; } });</script>`,
    ),
  );
});
// Session fix-a2, review finding 24: pages that wait until the scanner's own calls gave them "user
// activation" and then open a window to the internal page (a script, a form into a new window, the Impressum).
const openOnActivation = (port: number): string =>
  `<script>var t = setInterval(function () { if (navigator.userActivation && navigator.userActivation.isActive) { clearInterval(t); window.open('http://127.0.0.1:${port}/ssrf/secret'); } }, 50);</script>`;
route('www.ssrf.test', '/activation-open', (_req, res, port) => send(res, 200, 'text/html; charset=utf-8', html(`<h1>Start</h1><p>Text der Seite.</p>${openOnActivation(port)}`)));
route('www.ssrf.test', '/activation-post', (_req, res, port) =>
  send(
    res,
    200,
    'text/html; charset=utf-8',
    html(
      `<h1>Start</h1><form id="f" method="post" target="_blank" action="http://127.0.0.1:${port}/ssrf/secret"><input name="a" value="1"></form>
       <script>var t = setInterval(function () { if (navigator.userActivation.isActive) { clearInterval(t); document.getElementById('f').submit(); } }, 50);</script>`,
    ),
  ),
);
route('www.ssrf.test', '/activation-impressum', (_req, res) => send(res, 200, 'text/html; charset=utf-8', html('<h1>Start</h1><footer><a href="/impressum-activation">Impressum</a></footer>')));
route('www.ssrf.test', '/impressum-activation', (_req, res, port) =>
  send(res, 200, 'text/html; charset=utf-8', html(`<h1>Impressum</h1><p>Muster GmbH, Beispielweg 1, 12345 Musterstadt</p>${openOnActivation(port)}`)),
);
// For the http redirect check (Node's fetch, exempt host 127.0.0.1): a redirect to localhost.
route('127.0.0.1', '/ssrf/probe-to-localhost', (_req, res, port) => {
  res.writeHead(301, { location: `http://localhost:${port}/ssrf/secret` });
  res.end();
});

// Session fix-a2, review finding 20: images that pass the axe rule `image-alt` with and without a description.
const IMAGE = (color: string): string => `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect width='300' height='200' fill='%23${color}'/%3E%3C/svg%3E`;
const figure = (attributes: string): string => `<figure class="wp-block-image size-large"><img src="${IMAGE('1f3a5f')}" width="300" height="200" ${attributes}></figure>`;
const times = (n: number, part: string): string => Array.from({ length: n }, () => part).join('');
const imagePage = (body: string): string =>
  html(`<main><h1>Beispiel</h1>${'<p>Willkommen bei der Erfundenen Beispiel GmbH in Musterstadt. Wir bieten Beratung und Service rund um das Haus.</p>'.repeat(10)}${body}</main><footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer>`);
export const IMAGE_PAGES: Record<string, { body: string; described: number; decorative: number; without: number }> = {
  // Three content images the way a CMS prints an image whose alternative text was never entered.
  'empty-alt-only': { body: times(3, figure('alt=""')), described: 0, decorative: 3, without: 0 },
  // 8 real descriptions, 4 empty alt, 5 without alt at all.
  'mixed-8-4-5': { body: times(8, figure('alt="Team vor der Werkstatt"')) + times(4, figure('alt=""')) + times(5, figure('')), described: 8, decorative: 4, without: 5 },
  'roles-only': { body: times(2, figure('role="presentation"')) + figure('role="none"'), described: 0, decorative: 3, without: 0 },
  // Names from aria-label and title, and an empty alt next to an aria-label (the label wins: axe gives it the role img).
  'other-names': { body: figure('aria-label="Werkstatt von außen"') + figure('title="Unser Team"') + figure('alt="" aria-label="Logo der Beispiel GmbH"'), described: 3, decorative: 0, without: 0 },
  // An empty alt on an image that axe does not treat as presentation (focusable, a global ARIA attribute): the
  // rule passes, but there is no description.
  'empty-alt-not-presentation': { body: figure('alt="" tabindex="0"') + figure('alt="" aria-describedby="t"') + '<p id="t">Text</p>' + figure('alt="Team vor der Werkstatt"'), described: 1, decorative: 2, without: 0 },
  'control-described': { body: times(3, figure('alt="Team vor der Werkstatt"')), described: 3, decorative: 0, without: 0 },
  // Images that axe does not count at all.
  'hidden-only': { body: `<div style="display:none">${figure('')}</div><div aria-hidden="true">${figure('')}</div>`, described: 0, decorative: 0, without: 0 },
  'no-images': { body: '', described: 0, decorative: 0, without: 0 },
};
// Session fix-a6, review findings 26 and 77, and "Feld B2".
route('www.field.test', '/feld', (_req, res, port) => send(res, 200, 'text/html; charset=utf-8', fieldPage(`http://karte.mapco.test:${port}/embed`)));
route('karte.mapco.test', '/embed', (_req, res) => send(res, 200, 'text/html; charset=utf-8', '<!doctype html><title>Karte</title><p>Karte</p>'));
for (const [name, body] of Object.entries({ ...HOSTILE_AXE_PAGES, ...CSP_META_PAGES })) route('www.hostile.test', `/${name}`, (_req, res) => send(res, 200, 'text/html; charset=utf-8', body));
for (const [name, page] of Object.entries(IMAGE_PAGES)) route('www.images.test', `/${name}`, (_req, res) => send(res, 200, 'text/html; charset=utf-8', imagePage(page.body)));

/**
 * The SSRF guard of the integration tests: the made-up fixture hosts (`*.test`, mapped to
 * 127.0.0.1 inside Chromium) are exempt, everything else is checked as in production.
 */
export const fixtureGuard = createLocalGuard({ exempt: (url) => url.hostname.endsWith('.test') });

function a11yPage(path: string): Handler | undefined {
  try {
    const body = readFileSync(resolve(A11Y_DIR, path.slice(1)), 'utf8');
    return (_req, res) => send(res, 200, 'text/html; charset=utf-8', body);
  } catch {
    return undefined;
  }
}

export async function startFixtureServer(): Promise<FixtureServer> {
  let port = 0;
  const server: Server = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const handler = routes[`${host}${path}`] ?? (host === 'www.a11y.test' && /^\/[a-z-]+\.html$/.test(path) ? a11yPage(path) : undefined);
    // Session fix-a4: the heavy pages of the review, shared with the tests of the Cloudflare adapter.
    const heavy = handler === undefined && host === 'www.heavy.test' ? heavyPage(path) : null;
    if (heavy !== null) send(res, heavy.status, heavy.type, heavy.body, heavy.headers);
    else if (handler === undefined) send(res, 404, 'text/plain', 'not found');
    else handler(req, res, port);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    port,
    url: (host, path = '/') => `http://${host}:${port}${path}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
