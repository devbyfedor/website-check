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

// 3. Error pages.
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
