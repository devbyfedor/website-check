import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { heavyPage } from '../../../scanner/test/integration/heavy-pages.ts';
import { CSP_META_PAGES, fieldPage, HOSTILE_AXE_PAGES } from '../../../scanner/test/integration/hostile-a6-pages.ts';
import type { Browser as PuppeteerBrowser } from '@cloudflare/puppeteer';
import { launchLocalBrowser } from '@website-check/scanner/local';

/**
 * Session fix-a1: the Cloudflare adapter (`captureWithCdpEvents`, @cloudflare/puppeteer) against the local
 * Chromium of Playwright, with pages this file serves on 127.0.0.1 (Chromium maps every `.test` name
 * there, so no request leaves the machine). No Cloudflare account, no browser minutes.
 *
 * The connection between the "Worker" (the test) and the browser can get a delay in both directions,
 * with the order of the messages kept: with it Puppeteer learns the address of an iframe later than the
 * iframe's first requests, as the review of stage A reproduced it.
 */

export interface CdpFixture {
  port: number;
  url(host: string, path: string): string;
  /** How much later the second widget of the page `/race` answers than the first, in ms. */
  setGap(ms: number): void;
  /** Called once when the next page document of `www.shop.test` is requested. */
  onNextDocument(callback: () => void): void;
  hits(prefix: string): number;
  /**
   * A Puppeteer browser on the local Chromium; `delayMs` delays every message in both directions. `wire`
   * counts what the browser sent (session fix-a4): the number of messages and the longest one in characters.
   */
  connect(delayMs?: number): Promise<{ browser: PuppeteerBrowser; dropConnection(): void; wire: { messages: number; largest: number } }>;
  close(): Promise<void>;
}

const doc = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Fixture Shop</title>${head}</head><body>${body}</body></html>`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET' };
const GIF = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Passes the messages on after `delay` ms, in their order (Puppeteer's `ConnectionTransport`). */
class DelayTransport {
  onmessage?: (message: string) => void;
  onclose?: () => void;
  readonly #socket: WebSocket;
  readonly #delay: number;
  readonly wire = { messages: 0, largest: 0 };
  constructor(socket: WebSocket, delay: number) {
    this.#socket = socket;
    this.#delay = delay;
    socket.addEventListener('message', (event) => {
      const data = String(event.data);
      this.wire.messages += 1;
      if (data.length > this.wire.largest) this.wire.largest = data.length;
      if (delay === 0) this.onmessage?.(data);
      else setTimeout(() => this.onmessage?.(data), delay);
    });
    socket.addEventListener('close', () => this.onclose?.());
  }
  send(message: string): void {
    const go = (): void => {
      try {
        this.#socket.send(message);
      } catch {
        // closed
      }
    };
    if (this.#delay === 0) go();
    else setTimeout(go, this.#delay);
  }
  close(): void {
    this.#socket.close();
  }
}

export async function startCdpFixture(): Promise<CdpFixture> {
  let port = 0;
  let gapMs = 64;
  let nextDocument: (() => void) | null = null;
  const seen: string[] = [];
  const u = (host: string, path: string): string => `http://${host}:${port}${path}`;

  const server: Server = createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    seen.push(`${req.method} ${host}${path}`);
    const out = (status: number, type: string, body: string | Buffer, headers: Record<string, string> = {}, delay = 0): void => {
      setTimeout(() => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
        res.end(body);
      }, delay);
    };
    const page = (body: string): void => {
      const callback = nextDocument;
      nextDocument = null;
      callback?.();
      out(200, 'text/html; charset=utf-8', doc(`<h1>Willkommen</h1><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a>${body}`));
    };
    const player = (name: string): string => `<iframe title="Video" src="${u('embed.playerco.test', `/${name}`)}" width="320" height="180"></iframe>`;
    const jsonPost = (target: string): string => `fetch('${target}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"e":1}' }).then(function (r) { return r.text(); }).catch(function () {});`;
    // Session fix-a6, review findings 26 and 77.
    const hostile = host === 'www.hostile.test' ? ({ ...HOSTILE_AXE_PAGES, ...CSP_META_PAGES } as Record<string, string>)[path.slice(1)] : undefined;
    if (hostile !== undefined) return out(200, 'text/html; charset=utf-8', hostile);
    if (`${host}${path}` === 'www.field.test/feld') return out(200, 'text/html; charset=utf-8', fieldPage(u('karte.mapco.test', '/embed')));
    if (`${host}${path}` === 'karte.mapco.test/embed') return out(200, 'text/html; charset=utf-8', '<!doctype html><title>Karte</title><p>Karte</p>');
    switch (`${host}${path}`) {
      // The site. Its pages embed a third-party player or two third-party widgets, or act themselves.
      case 'www.shop.test/preflight':
        return page(player('preflight'));
      case 'www.shop.test/worker':
        return page(player('worker'));
      case 'www.shop.test/own':
        return page(`<script>${jsonPost(u('px.trackco.test', '/collect'))} new Worker('/own-worker.js');</script>`);
      case 'www.shop.test/own-worker.js':
        return out(200, 'text/javascript', `fetch('${u('css.fontco.test', '/font.css')}').catch(function () {});`);
      case 'www.shop.test/race':
        return page(`<iframe title="Formular" src="${u('forms.widget.test', '/embed')}" width="400" height="300"></iframe><iframe title="Termine" src="${u('termine.widget.test', '/embed')}" width="400" height="300"></iframe>`);
      // An ordinary page: a request of its own every 600 ms for about 5 s, a tracker of another host after 2.5 s.
      case 'www.shop.test/ticker':
        return page(
          `<script>var n = 0; var t = setInterval(function () { fetch('/n?' + (n++)).catch(function () {}); if (n > 8) clearInterval(t); }, 600);
           setTimeout(function () { var s = document.createElement('script'); s.src = '${u('px.trackco.test', '/t.js')}'; document.head.appendChild(s); }, 2500);</script>`,
        );
      // The parser never gets past this script: no load event, the page is busy for ever.
      case 'www.shop.test/busy':
        return page('<script>for (;;) {}</script>');
      case 'www.shop.test/n':
        return out(204, 'text/plain', '');
      // Session fix-a2, review finding 23: a page that prefetches an internal page and moves there right after
      // the scanner's snapshot read `document.title`; the internal page marks everything it shows.
      case 'www.shop.test/prefetch-swap':
        return out(
          200,
          'text/html; charset=utf-8',
          doc(
            '<h1>Willkommen</h1><p>Normaler Inhalt.</p>',
            `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${u('127.0.0.1', '/private')}"],"eagerness":"immediate"}]}</script>
             <script>Object.defineProperty(document, 'title', { get: function () { if (!window.__moved) { window.__moved = true; setTimeout(function () { location.href = '${u('127.0.0.1', '/private')}'; }, 0); } return 'Fixture Shop'; } });</script>`,
          ),
        );
      case '127.0.0.1/private':
        if (!/prefetch/.test(String(req.headers['sec-purpose'] ?? ''))) seen.push('NAVIGATION 127.0.0.1/private');
        return out(
          200,
          'text/html; charset=utf-8',
          '<!doctype html><html><head><meta charset="utf-8"><title>INTVAL-title</title></head><body><h1>Bereich</h1><p style="color:#bbb;background:#fff">INTVAL-contrast</p><input type="text" name="INTVAL-input"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a href="/INTVAL-href"></a></body></html>',
          { 'supports-loading-mode': 'credentialed-prefetch' },
        );
      // The embedded player (a product of the test rules).
      case 'embed.playerco.test/preflight':
        return out(200, 'text/html', doc(`<script>${jsonPost(u('px.trackco.test', '/collect'))}</script>`));
      case 'embed.playerco.test/worker':
        return out(200, 'text/html', doc(`<script>new Worker('/player-worker.js');</script>`));
      case 'embed.playerco.test/player-worker.js':
        return out(200, 'text/javascript', `fetch('${u('css.fontco.test', '/font.css')}').then(function (r) { return r.text(); }).catch(function () {});`);
      // Two widgets of providers without a rule; the first loads fonts of the "precedent" class.
      case 'forms.widget.test/embed':
        return out(200, 'text/html', doc('<p>Formular</p><img src="/logo.gif" alt="">', `<link rel="stylesheet" href="${u('css.fontco.test', '/font.css')}"><script src="/app.js"></script>`), {}, 100);
      case 'forms.widget.test/app.js':
        return out(200, 'text/javascript', 'window.x = 1;');
      case 'forms.widget.test/logo.gif':
        return out(200, 'image/gif', GIF);
      case 'termine.widget.test/embed':
        return out(200, 'text/html', doc('<p>Termine</p>'), {}, 100 + gapMs);
      // Third parties of the test rules.
      case 'px.trackco.test/collect':
        if (req.method === 'OPTIONS') {
          res.writeHead(204, CORS);
          return void res.end();
        }
        return out(200, 'application/json', '{}', CORS);
      case 'px.trackco.test/t.js':
        return out(200, 'text/javascript', 'window.__tracked = 1;');
      case 'css.fontco.test/font.css':
        return out(200, 'text/css', 'h1 { color: #111; }', { 'access-control-allow-origin': '*' });
      default: {
        // Session fix-a6: the accessibility fixture pages of A3 (`scanner/fixtures/a11y/`) at `/a11y/<file>`.
        const a11y = host === 'www.shop.test' ? /^\/a11y\/([a-z0-9-]+\.html)$/.exec(path)?.[1] : undefined;
        if (a11y !== undefined) return out(200, 'text/html; charset=utf-8', readFileSync(resolve(import.meta.dirname, '../../../scanner/fixtures/a11y', a11y)));
        // Session fix-a4: the heavy pages of the review, shared with the tests of the local adapter.
        const heavy = host === 'www.shop.test' ? heavyPage(path) : null;
        if (heavy !== null) return out(heavy.status, heavy.type, heavy.body, heavy.headers);
        if (`${host}${path}` === 'www.shop.test/impressum') return out(200, 'text/html; charset=utf-8', doc('<h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p><p>Muster GmbH<br>Musterweg 1<br>80331 München</p>').replace('<title>Fixture Shop</title>', '<title>Impressum</title>'));
        return out(404, 'text/plain', 'not found');
      }
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;

  const debugPort = await freePort();
  const chromium = await launchLocalBrowser(['--host-resolver-rules=MAP *.test 127.0.0.1', `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1']);
  const version = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  // Puppeteer's own way to a browser behind a WebSocket; the Worker reaches Browser Run through the same class.
  const connectorPath = '@cloudflare/puppeteer/internal/cdp/BrowserConnector.js';
  const connector = (await import(connectorPath)) as { _connectToCdpBrowser(transport: unknown, url: string, options: unknown): Promise<PuppeteerBrowser> };
  const connections: PuppeteerBrowser[] = [];

  return {
    port,
    url: u,
    setGap: (ms) => {
      gapMs = ms;
    },
    onNextDocument: (callback) => {
      nextDocument = callback;
    },
    hits: (prefix) => seen.filter((line) => line.startsWith(prefix)).length,
    connect: async (delayMs = 0) => {
      const socket = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve());
        socket.addEventListener('error', () => reject(new Error('no WebSocket to the local browser')));
      });
      const transport = new DelayTransport(socket, delayMs);
      const browser = await connector._connectToCdpBrowser(transport, version.webSocketDebuggerUrl, { defaultViewport: null });
      connections.push(browser);
      return { browser, dropConnection: () => socket.close(), wire: transport.wire };
    },
    close: async () => {
      for (const browser of connections) await browser.disconnect().catch(() => undefined);
      await chromium.close().catch(() => undefined);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
