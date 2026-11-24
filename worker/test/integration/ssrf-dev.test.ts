import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Report } from '@website-check/scanner';

/**
 * The SSRF guard of the Cloudflare adapter on the production code path, on plain `wrangler dev` (local workerd and
 * the local Chrome of wrangler's Browser Run emulation; no Cloudflare account, no browser minutes).
 *
 * Since session fix-a6 (the A2 lab Worker is gone) this runs the real thing, as `npm run lab:e2e:dev` does: the
 * lab API Worker `wrangler.lab-e2e.jsonc` (the real API behind a token, with a local D1 database) and the scan
 * Worker `wrangler.lab-e2e-scanner.jsonc` with the real `ScanQueueObject`, which runs `captureWithCdpEvents` with
 * the guard, the navigation guard, the popup guard and the Impressum tab exactly as in production. Every case is a
 * scan started through `POST /api/scans`, read from its report. The scan Worker gets its dev switch from a
 * git-ignored copy of its config (see `startWrangler`).
 *
 * The scan takes only the homepage of an address, so every case has a fixture server of its own (its own port, and
 * so its own origin): the dev switch exempts exactly these origins, `http://localhost:<port>`. The pages lead the
 * browser to the same server as `127.0.0.1`, which is not exempt; the guard must refuse every such navigation
 * before it is sent, so `/ssrf/secret` never gets a request (counted per server). A page that loads an image from
 * 127.0.0.1 shows that the browser can reach that address at all (subresources are not checked, see
 * `docs/decisions.md`, A5), so a count of 0 is the guard's doing.
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const WRANGLER = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const API_CONFIG = 'worker/wrangler.lab-e2e.jsonc';
const SCANNER_CONFIG = 'worker/wrangler.lab-e2e-scanner.jsonc';
const SCANNER_COPY = `worker/wrangler.lab-e2e-scanner.ssrf-${process.pid}.local.jsonc`;
const DATABASE = 'website-check-lab-db';

const CASES = [
  'ok',
  'image-from-internal',
  'redirect-loopback',
  'redirect-decimal',
  'meta-refresh',
  'script-redirect',
  'iframe-top',
  'prerender',
  'popup',
  'popup-noopener',
  'popup-link',
  'with-impressum',
  'impressum-internal',
  'chain',
] as const;
type CaseName = (typeof CASES)[number];

interface Counters {
  home: number;
  secret: number;
  image: number;
}

const fixtures = new Map<CaseName, { server: Server; port: number; hits: Counters }>();
let wrangler: ChildProcess | null = null;
let wranglerOutput = '';
let wranglerExited = false;
let base = '';
let persistDir = '';
const token = randomBytes(32).toString('hex');

interface Outcome {
  id: string;
  status: string;
  report: Report | null;
}
const outcomes = new Map<CaseName, Outcome>();
let metrics: { id: string; popupsBlocked?: number; impressumOpened: boolean; outcome: string }[] = [];

const page = (body: string, head = ''): string => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>SSRF</title>${head}</head><body>${body}</body></html>`;
const origin = (name: CaseName): string => `http://localhost:${fixtures.get(name)?.port}`;
const internal = (name: CaseName): string => `http://127.0.0.1:${fixtures.get(name)?.port}`;
const hitsOf = (name: CaseName): Counters => fixtures.get(name)?.hits ?? { home: 0, secret: 0, image: 0 };

/** The page of each case at `/`; the other paths are shared. */
function home(name: CaseName, port: number): { status: number; headers?: Record<string, string>; body?: string } {
  const html = (body: string, head = ''): { status: number; body: string } => ({ status: 200, body: page(body, head) });
  const to = `http://127.0.0.1:${port}/ssrf/secret`;
  switch (name) {
    case 'ok':
      return html('<h1>Öffentliche Seite</h1>');
    case 'image-from-internal':
      return html(`<h1>Bild</h1><img src="http://127.0.0.1:${port}/ssrf/secret.svg" alt="">`);
    case 'redirect-loopback':
      return { status: 302, headers: { location: to } };
    case 'redirect-decimal':
      return { status: 301, headers: { location: '/redirect-decimal-2' } };
    case 'meta-refresh':
      return html('<h1>Weiter</h1>', `<meta http-equiv="refresh" content="0; url=${to}">`);
    case 'script-redirect':
      return html(`<h1>Start</h1><script>setTimeout(function () { location.href = 'http://0x7f.0.0.1:${port}/ssrf/secret'; }, 200);</script>`);
    case 'iframe-top':
      return html(`<h1>Start</h1><iframe srcdoc="<script>top.location = '${to}';</script>"></iframe>`);
    case 'prerender':
      return html(
        '<h1>Start</h1><script>setTimeout(function () { location.href = "/prerender-next"; }, 1500);</script>',
        '<script type="speculationrules">{"prerender":[{"source":"list","urls":["/prerender-next"]}]}</script>',
      );
    case 'popup':
      return html(`<h1>Start</h1><script>window.open('${to}');</script>`);
    case 'popup-noopener':
      return html(`<h1>Start</h1><script>window.open('${to}', '_blank', 'noopener');</script>`);
    case 'popup-link':
      return html(`<h1>Start</h1><a id="l" href="${to}" target="_blank">x</a><script>document.getElementById('l').click();</script>`);
    case 'with-impressum':
      return html('<h1>Muster Werkstatt</h1><footer><a href="/impressum-page">Impressum</a></footer>');
    case 'impressum-internal':
      return html(`<h1>Muster Werkstatt</h1><footer><a href="${to}">Impressum</a></footer>`);
    case 'chain':
      return { status: 302, headers: { location: '/chain/0' } };
  }
}

function handle(name: CaseName, port: number, hits: Counters, req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const html = (body: string, head = ''): void => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page(body, head));
  };
  const redirect = (status: number, location: string): void => {
    res.writeHead(status, { location });
    res.end();
  };
  const chain = /^\/chain\/(\d)$/.exec(path);
  if (path === '/') {
    hits.home += 1;
    const answer = home(name, port);
    res.writeHead(answer.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...answer.headers });
    res.end(answer.body ?? '');
  } else if (path === '/ssrf/secret') {
    hits.secret += 1;
    html('<h1>Interner Bereich</h1>');
  } else if (path === '/ssrf/secret.svg') {
    hits.image += 1;
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  } else if (path === '/trace') {
    // Stand-in for Cloudflare's trace page (DEV_TRACE_URL), read once per browser session.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('fl=dev\nloc=XX\ncolo=DEV\n');
  } else if (path === '/redirect-decimal-2') redirect(307, `http://2130706433:${port}/ssrf/secret`);
  else if (path === '/prerender-next') html(`<h1>Weiter</h1><script>setTimeout(function () { location.href = 'http://127.0.0.1:${port}/ssrf/secret'; }, 300);</script>`);
  else if (path === '/impressum-page')
    html('<main><h1>Impressum</h1><p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p><p>E-Mail: kontakt [at] muster-werkstatt.example</p><p>Handelsregister: HRB 12345, Amtsgericht Beispielburg</p></main>');
  else if (chain !== null) {
    const n = Number(chain[1]);
    if (n < 7) redirect(302, `/chain/${n + 1}`);
    else html('<h1>Ende</h1>');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

async function startFixtures(): Promise<void> {
  for (const name of CASES) {
    const hits: Counters = { home: 0, secret: 0, image: 0 };
    let port = 0;
    const server = createServer((req, res) => handle(name, port, hits, req, res));
    await new Promise<void>((done) =>
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        done();
      }),
    );
    fixtures.set(name, { server, port, hits });
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

function runWrangler(args: string[]): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', input: '', timeout: 120_000 });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * With several `-c` configs in one wrangler process `--var` reaches only the first Worker (the lab API Worker). The
 * queue object in the scan Worker needs the dev switch, the exempt origins, the fixture trace page and the secret of
 * the rate limit too, so they go into a git-ignored copy of its config, as `scanner/src/local/lab-e2e-dev.ts` does.
 */
function writeScannerCopy(vars: Record<string, string>): void {
  const text = readFileSync(resolve(ROOT, SCANNER_CONFIG), 'utf8');
  const marker = '"vars": { "QUEUE_MAX_PARALLEL": "1" }';
  if (!text.includes(marker)) throw new Error(`${SCANNER_CONFIG}: vars line not found`);
  writeFileSync(resolve(ROOT, SCANNER_COPY), text.replace(marker, `"vars": ${JSON.stringify(vars)}`));
}

function startWrangler(port: number, devOrigins: string): Promise<void> {
  const args = [
    WRANGLER, 'dev', '-c', API_CONFIG, '-c', SCANNER_COPY, '--ip', '127.0.0.1', '--port', String(port), '--local', '--persist-to', persistDir,
    '--var', 'DEV_MODE:1', '--var', `DEV_ORIGINS:${devOrigins}`, '--var', `LAB_TOKEN:${token}`,
  ];
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  wrangler = child;
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`wrangler dev did not start:\n${wranglerOutput.slice(-2000)}`)), 120_000);
    const onData = (chunk: Buffer): void => {
      wranglerOutput += chunk.toString();
      if (wranglerOutput.includes(`Ready on http://127.0.0.1:${port}`)) {
        clearTimeout(timer);
        done();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      wranglerExited = true;
      clearTimeout(timer);
      fail(new Error(`wrangler dev exited with ${code}:\n${wranglerOutput.slice(-2000)}`));
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

async function api(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON: the text tells
  }
  return { status: response.status, json, text };
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Starts one scan per case and waits until every scan is done (or has ended with an error). */
async function runScans(): Promise<void> {
  const started = new Map<CaseName, string>();
  for (const name of CASES) {
    const answer = await api('/api/scans', { url: `${origin(name)}/` });
    const id = answer.json?.['id'];
    if (answer.status !== 202 || typeof id !== 'string') throw new Error(`${name}: the start answered HTTP ${answer.status} ${answer.text.slice(0, 300)}`);
    started.set(name, id);
  }
  const open = new Set<CaseName>(CASES);
  const deadline = Date.now() + 8 * 60_000;
  while (open.size > 0 && Date.now() < deadline) {
    if (wranglerExited) throw new Error(`wrangler dev exited during the scans:\n${wranglerOutput.slice(-2000)}`);
    for (const name of [...open]) {
      const id = started.get(name) as string;
      const status = (await api(`/api/scans/${id}`)).json?.['status'];
      if (status !== 'done' && status !== 'error') continue;
      open.delete(name);
      const report = status === 'done' ? ((await api(`/api/scans/${id}/report`)).json as unknown as Report | null) : null;
      outcomes.set(name, { id, status, report });
    }
    if (open.size > 0) await sleep(2_000);
  }
  if (open.size > 0) throw new Error(`these scans did not finish in 8 minutes: ${[...open].join(', ')}`);
  metrics = ((await api('/lab/stats')).json?.['metrics'] ?? []) as typeof metrics;
  // A late navigation of a page would show up here; the tabs are closed by now.
  await sleep(1_000);
}

const reportOf = (name: CaseName): Report => {
  const outcome = outcomes.get(name);
  expect(outcome?.status, `${name}: the scan ended as ${outcome?.status}`).toBe('done');
  return outcome?.report as Report;
};
const metricOf = (name: CaseName): { popupsBlocked?: number; impressumOpened: boolean; outcome: string } | undefined => metrics.find((m) => m.id === outcomes.get(name)?.id);

beforeAll(async () => {
  await startFixtures();
  persistDir = mkdtempSync(join(tmpdir(), 'website-check-ssrf-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const devOrigins = CASES.map(origin).join(',');
  // The default queue settings of production (three scans at the same time, one browser for all of them).
  writeScannerCopy({ DEV_MODE: '1', DEV_ORIGINS: devOrigins, DEV_TRACE_URL: `${origin('ok')}/trace`, RATE_LIMIT_SECRET: randomBytes(32).toString('hex') });
  const migrated = runWrangler(['d1', 'migrations', 'apply', DATABASE, '--local', '-c', API_CONFIG, '--persist-to', persistDir]);
  if (migrated.status !== 0) throw new Error(`the D1 migrations failed:\n${migrated.output.slice(-2000)}`);
  await startWrangler(port, devOrigins);
  await runScans();
}, 15 * 60_000);

afterAll(async () => {
  stopWrangler();
  await Promise.all([...fixtures.values()].map(({ server }) => new Promise<void>((done) => server.close(() => done()))));
  await sleep(500);
  rmSync(resolve(ROOT, SCANNER_COPY), { force: true });
  if (persistDir !== '') rmSync(persistDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
});

describe('SSRF guard of the Cloudflare adapter on the production path (wrangler dev, queue object)', () => {
  it('loads a normal page on the exempt fixture origin (control)', () => {
    const report = reportOf('ok');
    expect(report.state).toBe('complete');
    expect(report.failure).toBeNull();
    expect(report.scan.mode).toBe('full');
    expect(report.visit.adapter).toBe('cloudflare-browser-run');
    expect(report.site.finalUrl).toBe(`${origin('ok')}/`);
    expect(hitsOf('ok').home).toBeGreaterThan(0);
  });

  it('control: the browser does reach 127.0.0.1 for a subresource, which the guard does not check', () => {
    const report = reportOf('image-from-internal');
    expect(report.state).toBe('complete');
    expect(hitsOf('image-from-internal').image).toBeGreaterThan(0);
  });

  it.each([
    ['an HTTP redirect to 127.0.0.1', 'redirect-loopback'],
    ['a redirect to 127.0.0.1 in decimal notation, after one allowed hop', 'redirect-decimal'],
    ['a meta refresh to 127.0.0.1', 'meta-refresh'],
    ['a script navigation to 127.0.0.1 in hex notation', 'script-redirect'],
    ['a same-origin iframe that navigates the top document to 127.0.0.1', 'iframe-top'],
  ] as const)('refuses %s before it is sent', (_what, name) => {
    const report = reportOf(name);
    expect(report.state).toBe('not-allowed');
    expect(report.failure?.reason).toBe('not-allowed');
    expect(report.notice).toMatchObject({ textId: 'report-not-allowed', params: { rejection: 'address' } });
    // The first document was fetched (so it is the later hop that was refused) and the internal page never got a request.
    expect(hitsOf(name).home).toBeGreaterThan(0);
    expect(hitsOf(name).secret).toBe(0);
  });

  it('a prerendered page that navigates to 127.0.0.1 once activated reaches nothing', () => {
    const report = reportOf('prerender');
    expect(hitsOf('prerender').secret).toBe(0);
    expect(report.site.finalUrl ?? '').not.toContain('127.0.0.1');
  });

  it.each(['popup', 'popup-noopener', 'popup-link'] as const)('the window %s opens by script reaches nothing', (name) => {
    const report = reportOf(name);
    expect(report.state).toBe('complete');
    expect(report.failure).toBeNull();
    expect(hitsOf(name).home).toBeGreaterThan(0);
    // The window did open, and the popup guard refused it (the queue object counts them).
    expect(metricOf(name)?.popupsBlocked ?? 0, `${name}: popups blocked`).toBeGreaterThan(0);
    expect(hitsOf(name).secret).toBe(0);
  });

  it('opens the Impressum in a second tab of the same context and reads its text', () => {
    const report = reportOf('with-impressum');
    expect(report.state).toBe('complete');
    expect(report.pages).toEqual({ homepage: 'checked', impressum: 'checked' });
    expect(report.legal?.impressum).toEqual({ state: 'analyzed', url: `${origin('with-impressum')}/impressum-page`, crossSite: false });
    expect(report.legal?.fields.address).toMatchObject({ status: 'found' });
    expect(report.legal?.fields.handelsregister).toMatchObject({ status: 'found' });
    expect(metricOf('with-impressum')).toMatchObject({ impressumOpened: true, outcome: 'saved' });
  });

  it('refuses an Impressum link to 127.0.0.1 before it is sent, the homepage stays captured', () => {
    const report = reportOf('impressum-internal');
    expect(report.state).toBe('complete');
    expect(report.pages.homepage).toBe('checked');
    expect(report.pages.impressum).toBe('not-checked');
    expect(report.legal?.impressum.state).toBe('failed');
    expect(hitsOf('impressum-internal').secret).toBe(0);
  });

  it('refuses the sixth redirect of the main document', () => {
    const report = reportOf('chain');
    expect(report.state).toBe('not-allowed');
    expect(report.failure?.reason).toBe('not-allowed');
    expect(report.notice).toMatchObject({ textId: 'report-not-allowed', params: { rejection: 'too-many-redirects' } });
  });

  it('refuses internal addresses before the browser opens a tab, also in dev mode', async () => {
    const port = fixtures.get('ok')?.port ?? 0;
    // A port that no fixture server uses: the exemption is the exact origin, not every port of localhost.
    const unused = Math.max(...[...fixtures.values()].map((f) => f.port)) + 1;
    const before = hitsOf('ok').secret;
    for (const url of [`http://127.0.0.1:${port}/ssrf/secret`, `http://localhost:${unused}/`, 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/']) {
      const answer = await api('/api/scans', { url });
      expect(answer.status, url).toBe(400);
      expect(answer.json, url).toMatchObject({ error: 'address-not-allowed' });
    }
    expect(hitsOf('ok').secret).toBe(before);
  });

  it('no fixture server got a request to the internal page, in any case', () => {
    for (const name of CASES) expect(hitsOf(name).secret, name).toBe(0);
  });
});
