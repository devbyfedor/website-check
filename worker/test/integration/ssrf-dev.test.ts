import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Capture, CaptureStrategy } from '@website-check/scanner';

/**
 * Session A5: the SSRF guard in the Cloudflare adapter, on plain `wrangler dev` (local workerd and
 * the local Chrome of wrangler's Browser Run emulation; no Cloudflare account, no browser minutes).
 *
 * The lab Worker runs with the dev switch and exactly one exempt origin, the fixture site on
 * `http://localhost:<port>`. Its pages lead the browser to the same server as `127.0.0.1`, which
 * is not exempt; the guard in the Durable Object must refuse every such navigation before it is
 * sent, so `/ssrf/secret` never gets a request. A page that loads an image from 127.0.0.1 shows
 * that the browser can reach that address at all (subresources are not checked, see
 * `docs/decisions.md`, A5), so a count of 0 is the guard's doing.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const WRANGLER = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');

let fixture: Server;
let fixturePort = 0;
let wrangler: ChildProcess | null = null;
let base = '';
const token = randomBytes(32).toString('hex');
let sessionId = '';
const hits = { secret: 0, image: 0 };

const page = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>SSRF</title>${head}</head><body>${body}</body></html>`;

function startFixture(): Promise<void> {
  fixture = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const internal = `http://127.0.0.1:${fixturePort}`;
    const html = (body: string, head = ''): void => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(page(body, head));
    };
    const redirect = (status: number, location: string): void => {
      res.writeHead(status, { location });
      res.end();
    };
    const chain = /^\/chain\/(\d)$/.exec(path);
    if (path === '/ssrf/secret') {
      hits.secret += 1;
      html('<h1>Interner Bereich</h1>');
    } else if (path === '/ssrf/secret.svg') {
      hits.image += 1;
      res.writeHead(200, { 'content-type': 'image/svg+xml' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    } else if (path === '/ok') html('<h1>Öffentliche Seite</h1>');
    else if (path === '/image-from-internal') html(`<h1>Bild</h1><img src="${internal}/ssrf/secret.svg" alt="">`);
    else if (path === '/redirect-loopback') redirect(302, `${internal}/ssrf/secret`);
    else if (path === '/redirect-decimal') redirect(301, '/redirect-decimal-2');
    else if (path === '/redirect-decimal-2') redirect(307, `http://2130706433:${fixturePort}/ssrf/secret`);
    else if (path === '/meta-refresh') html('<h1>Weiter</h1>', `<meta http-equiv="refresh" content="0; url=${internal}/ssrf/secret">`);
    else if (path === '/script-redirect') html(`<h1>Start</h1><script>setTimeout(function () { location.href = 'http://0x7f.0.0.1:${fixturePort}/ssrf/secret'; }, 200);</script>`);
    else if (chain !== null) {
      const n = Number(chain[1]);
      if (n < 7) redirect(302, `/chain/${n + 1}`);
      else html('<h1>Ende</h1>');
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((done) =>
    fixture.listen(0, '127.0.0.1', () => {
      fixturePort = (fixture.address() as AddressInfo).port;
      done();
    }),
  );
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

function startWrangler(port: number): Promise<void> {
  const args = [
    WRANGLER, 'dev', '-c', 'worker/wrangler.lab.jsonc', '--ip', '127.0.0.1', '--port', String(port),
    '--var', 'LAB_ALLOW_LOCAL:1', '--var', `LAB_TOKEN:${token}`, '--var', `LAB_DEV_ORIGINS:http://localhost:${fixturePort}`,
  ];
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  wrangler = child;
  return new Promise((done, fail) => {
    let output = '';
    const timer = setTimeout(() => fail(new Error(`wrangler dev did not start:\n${output.slice(-2000)}`)), 90_000);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes(`Ready on http://127.0.0.1:${port}`)) {
        clearTimeout(timer);
        done();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`wrangler dev exited with ${code}:\n${output.slice(-2000)}`));
    });
  });
}

function stopWrangler(): void {
  if (wrangler === null || wrangler.pid === undefined) return;
  // wrangler starts workerd as a child process; end the whole tree.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(wrangler.pid), '/T', '/F'], { stdio: 'ignore' });
  else wrangler.kill('SIGTERM');
  wrangler = null;
}

async function lab<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

const site = (path: string): string => `http://localhost:${fixturePort}${path}`;

async function capture(path: string, strategy: CaptureStrategy = 'cdp-events'): Promise<Capture> {
  const result = await lab<{ capture: Capture }>('/lab/capture', { sessionId, url: site(path), strategy });
  return result.capture;
}

beforeAll(async () => {
  await startFixture();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  await startWrangler(port);
  sessionId = (await lab<{ sessionId: string }>('/lab/session', {})).sessionId;
}, 150_000);

afterAll(async () => {
  if (sessionId !== '') await lab('/lab/close', { sessionId }).catch(() => undefined);
  stopWrangler();
  await new Promise<void>((done) => (fixture ? fixture.close(() => done()) : done()));
});

describe('SSRF guard in the Cloudflare adapter (wrangler dev)', () => {
  it('loads a normal page on the exempt fixture origin, with both strategies (control)', async () => {
    for (const strategy of ['cdp-events', 'resource-timing'] as const) {
      const c = await capture('/ok', strategy);
      expect(c.adapter).toBe('cloudflare-browser-run');
      expect(c.strategy).toBe(strategy);
      expect(c.ok, `${strategy}: ${c.failure?.message ?? ''}`).toBe(true);
    }
  });

  it('control: the browser does reach 127.0.0.1 for a subresource, which the guard does not check', async () => {
    const before = hits.image;
    const c = await capture('/image-from-internal');
    expect(c.ok).toBe(true);
    expect(hits.image).toBeGreaterThan(before);
  });

  it.each([
    ['an HTTP redirect to 127.0.0.1', '/redirect-loopback'],
    ['a redirect to 127.0.0.1 in decimal notation, after one allowed hop', '/redirect-decimal'],
    ['a meta refresh to 127.0.0.1', '/meta-refresh'],
    ['a script navigation to 127.0.0.1 in hex notation', '/script-redirect'],
  ])('strategy (a) refuses %s before it is sent', async (_name, path) => {
    const before = hits.secret;
    const c = await capture(path);
    expect(c.ok).toBe(false);
    expect(c.failure?.reason).toBe('not-allowed');
    expect(c.failure?.message).toContain('loopback');
    expect(c.failure?.message).toContain('127.0.0.1');
    expect(hits.secret).toBe(before);
  });

  it('strategy (b) refuses the redirect to 127.0.0.1 too', async () => {
    const before = hits.secret;
    const c = await capture('/redirect-loopback', 'resource-timing');
    expect(c.failure?.reason).toBe('not-allowed');
    expect(c.failure?.message).toContain('loopback');
    expect(hits.secret).toBe(before);
  });

  it('refuses the sixth redirect of the main document', async () => {
    const c = await capture('/chain/0');
    expect(c.failure?.reason).toBe('not-allowed');
    expect(c.failure?.message).toContain('too-many-redirects');
  });

  it('refuses internal addresses before the browser opens a tab, also in dev mode', async () => {
    const before = hits.secret;
    for (const url of [`http://127.0.0.1:${fixturePort}/ssrf/secret`, `http://localhost:${fixturePort + 1}/`, 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/']) {
      const response = await fetch(`${base}/lab/capture`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, url, strategy: 'cdp-events' }),
      });
      expect(response.status, url).toBe(400);
    }
    expect(hits.secret).toBe(before);
  });
});
