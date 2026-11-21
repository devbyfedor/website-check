import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

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

// 4. Error pages.
route('www.blocked.test', '/', (_req, res) => send(res, 403, 'text/html', html('Just a moment...'), { 'cf-mitigated': 'challenge' }));
route('www.broken.test', '/', (_req, res) => send(res, 500, 'text/html', html('Internal Server Error')));

export async function startFixtureServer(): Promise<FixtureServer> {
  let port = 0;
  const server: Server = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const handler = routes[`${host}${path}`];
    if (handler === undefined) send(res, 404, 'text/plain', 'not found');
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
