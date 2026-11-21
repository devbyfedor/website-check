import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, resolve } from 'node:path';

/** The accessibility fixture pages of session A3 (`scanner/fixtures/a11y/`), served at `/a11y/<file>`. */
export const A11Y_FIXTURE_DIR = resolve(import.meta.dirname, '../../fixtures/a11y');

export interface A11yFixtureExpectation {
  violations: Record<string, number>;
  incomplete: Record<string, number>;
  note?: string;
}

export function a11yFixtureExpectations(): Record<string, A11yFixtureExpectation> {
  const manifest = JSON.parse(readFileSync(resolve(A11Y_FIXTURE_DIR, 'expected.json'), 'utf8')) as { pages: Record<string, A11yFixtureExpectation> };
  return manifest.pages;
}

/**
 * Local fixture site for debugging the Cloudflare adapter with plain `wrangler dev` (which
 * starts a local Chrome). Two host names of the same machine stand for two sites:
 * `127.0.0.1` is the shop, `localhost` the third party, so the iframe is cross-site.
 * Every request's headers are recorded, to compare what the local Playwright adapter and the
 * Cloudflare adapter send (language, user agent, client hints).
 */

export interface RecordedRequest {
  host: string;
  path: string;
  userAgent: string | null;
  acceptLanguage: string | null;
  chUaPlatform: string | null;
  /** Query of `/frame-env`: time zone, language and platform as seen inside the cross-site iframe. */
  query: string;
}

export interface LabFixture {
  port: number;
  /** Entry URL: a redirect to the shop homepage. */
  startUrl: string;
  /** Page with 300 images, more than the default Resource Timing buffer of 250. */
  manyUrl: string;
  /** The accessibility fixture pages (A3), by file name. */
  a11yUrls: Record<string, string>;
  recorded: RecordedRequest[];
  close(): Promise<void>;
}

const page = (body: string, head = ''): string =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Lab fixture</title>${head}</head><body>${body}</body></html>`;

function send(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function handle(req: IncomingMessage, res: ServerResponse, port: number, recorded: RecordedRequest[]): void {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);
  recorded.push({
    host,
    path: url.pathname,
    userAgent: req.headers['user-agent'] ?? null,
    acceptLanguage: req.headers['accept-language'] ?? null,
    chUaPlatform: (req.headers['sec-ch-ua-platform'] as string | undefined) ?? null,
    query: url.pathname === '/frame-env' ? url.search : '',
  });
  const shop = (path: string): string => `http://127.0.0.1:${port}${path}`;
  const third = (path: string): string => `http://localhost:${port}${path}`;
  const key = `${host}${url.pathname}`;
  switch (key) {
    case '127.0.0.1/start':
      res.writeHead(301, { location: shop('/') });
      res.end();
      return;
    case '127.0.0.1/':
      send(
        res,
        200,
        'text/html; charset=utf-8',
        page(
          `<h1>Willkommen</h1><a href="/impressum">Impressum</a>
           <img src="${third('/logo.png')}" alt="Logo">
           <iframe src="${third('/embed')}" width="300" height="200" title="Video"></iframe>
           <div id="CybotCookiebotDialog" style="display:none;position:fixed;bottom:0;left:0;right:0;height:180px;background:#fff">
             Wir verwenden Cookies. <button>Alle akzeptieren</button></div>
           <script>setTimeout(function () { document.getElementById('CybotCookiebotDialog').style.display = 'block'; }, 800);</script>
           <script src="${third('/t.js')}"></script>
           <script>fetch('http://127.0.0.1:1/unreachable').catch(function () {});</script>`,
          `<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="${third('/css?family=Test')}">`,
        ),
        { 'x-fixture': 'shop-home', 'strict-transport-security': 'max-age=1' },
      );
      return;
    case '127.0.0.1/cdn-cgi/trace':
      send(res, 200, 'text/plain', `fl=0
h=127.0.0.1
uag=${req.headers['user-agent'] ?? ''}
colo=DEV
http=http/1.1
loc=XX
tls=off
`);
      return;
    case '127.0.0.1/style.css':
      send(res, 200, 'text/css', 'body { color: #222; }');
      return;
    case 'localhost/css':
      send(res, 200, 'text/css', `@font-face { font-family: Test; src: url(${third('/test.woff2')}) format('woff2'); } h1 { font-family: Test; }`);
      return;
    case 'localhost/test.woff2':
      send(res, 200, 'font/woff2', 'not really a font');
      return;
    case 'localhost/frame-env':
    case 'localhost/logo.png':
    case 'localhost/pixel.gif':
    case '127.0.0.1/pixel.gif':
      send(res, 200, 'image/gif', 'GIF89a');
      return;
    case 'localhost/t.js':
      send(res, 200, 'application/javascript', `setTimeout(function () { navigator.sendBeacon('${third('/collect')}', 'x'); }, 300);`);
      return;
    case 'localhost/collect':
      send(res, 204, 'text/plain', '');
      return;
    case 'localhost/embed':
      send(
        res,
        200,
        'text/html',
        page(
          `<img src="${third('/pixel.gif')}" alt=""><script>fetch('${third('/frame-xhr')}');
           new Image().src = '${third('/frame-env')}?tz=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)
             + '&lang=' + encodeURIComponent(navigator.language) + '&intl=' + encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().locale)
             + '&platform=' + encodeURIComponent(navigator.platform);</script>`,
        ),
      );
      return;
    case 'localhost/frame-xhr':
      send(res, 200, 'application/json', '{}', { 'access-control-allow-origin': '*' });
      return;
    case '127.0.0.1/many': {
      const images = Array.from({ length: 300 }, (_, i) => `<img src="/pixel.gif?n=${i}" alt="" width="1" height="1">`).join('');
      send(res, 200, 'text/html; charset=utf-8', page(images));
      return;
    }
    default: {
      if (host === '127.0.0.1' && url.pathname.startsWith('/a11y/')) {
        const name = basename(url.pathname);
        if (/^[a-z-]+\.html$/.test(name) && name in a11yFixtureExpectations()) {
          send(res, 200, 'text/html; charset=utf-8', readFileSync(resolve(A11Y_FIXTURE_DIR, name), 'utf8'));
          return;
        }
      }
      send(res, 404, 'text/plain', 'not found');
    }
  }
}

export async function startLabFixture(port = 0): Promise<LabFixture> {
  const recorded: RecordedRequest[] = [];
  let actualPort = port;
  const server: Server = createServer((req, res) => handle(req, res, actualPort, recorded));
  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
  actualPort = (server.address() as AddressInfo).port;
  return {
    port: actualPort,
    startUrl: `http://127.0.0.1:${actualPort}/start`,
    manyUrl: `http://127.0.0.1:${actualPort}/many`,
    a11yUrls: Object.fromEntries(Object.keys(a11yFixtureExpectations()).map((name) => [name, `http://127.0.0.1:${actualPort}/a11y/${name}`])),
    recorded,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
