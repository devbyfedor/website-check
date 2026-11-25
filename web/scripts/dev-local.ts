// The site with its API on this computer (session B2 part 2): the production build of web/ served by the API Worker
// (Workers Static Assets), the scan Worker with the queue object, both on plain `wrangler dev` (local workerd, a fresh
// local D1, the local Chrome of wrangler's Browser Run emulation; no Cloudflare account, no browser minutes), and
// three fixture sites of an invented business to check. Only these fixture origins pass the address rules (the dev
// switch, which the API refuses on any host but 127.0.0.1 and localhost).
//
//   npm run dev:local                      builds web/, then http://127.0.0.1:8787/
//   node web/scripts/dev-local.ts --no-build [--port 8787]
//
// Fixture sites (enter them in the form of the home page):
//   http://localhost:8791/   an ordinary homepage with an Impressum (a few findings)
//   http://localhost:8792/   the same, but one image answers only after 8 s: the scan runs about 10 s
//   http://localhost:8793/   the same as the first; start it while the second runs to see the queue and cancel it
// The queue runs one scan at a time here, so the third waits behind the second.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const WRANGLER = resolve(ROOT, 'node_modules/wrangler/bin/wrangler.js');
const API_CONFIG = 'worker/wrangler.jsonc';
const SCANNER_CONFIG = 'worker/wrangler.scanner.jsonc';

export type FixtureKind = 'plain' | 'slow' | 'queued';

export interface FixtureSite {
  kind: FixtureKind;
  origin: string;
  /** Requests per path, counted by this server. */
  hits: Map<string, number>;
}

export interface DevSite {
  origin: string;
  fixtures: Record<FixtureKind, FixtureSite>;
  stop(): Promise<void>;
}

export interface DevOptions {
  port?: number;
  fixturePorts?: [number, number, number];
  /** Scans at the same time (default 1, so a second scan waits in the queue). */
  parallel?: number;
  build?: boolean;
  /** Print wrangler's output (the command line does, the test does not). */
  echo?: boolean;
  /**
   * Session B5 part 2: the site's own origin passes the address rules too (`http://localhost:<port>`), so that our
   * scanner can check our own site (web/scripts/self-scan.ts). Local only, like the fixture origins.
   */
  self?: boolean;
}

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${body}</body></html>`;

/** The pages of the invented business; `slow` keeps one image open for 8 s, so the scan takes about 10 s. */
function handle(kind: FixtureKind, port: number, hits: Map<string, number>, req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  hits.set(path, (hits.get(path) ?? 0) + 1);
  const html = (body: string, title = 'Muster Werkstatt'): void => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(page(title, body));
  };
  if (path === '/') {
    const slow = kind === 'slow' ? '<img src="/langsam.svg" alt="Werkstattfoto" width="40" height="40">' : '';
    html(
      `<header><h1>Muster Werkstatt</h1><p>Reparaturen aller Art in Musterhausen.</p></header>
<main><p style="color:#9a9a9a;background:#ffffff">Termine nach Vereinbarung.</p>
<img src="/werkstatt.svg" width="40" height="40">
<img src="http://127.0.0.1:${port}/zaehler.svg" alt="" width="1" height="1">${slow}
<a href="/angebot"></a></main>
<footer><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></footer>`,
    );
  } else if (path === '/impressum') {
    html('<main><h1>Impressum</h1><p>Muster Werkstatt GmbH<br>Musterweg 12<br>87654 Musterhausen</p><p>E-Mail: kontakt [at] muster-werkstatt.example</p><p>Handelsregister: HRB 12345, Amtsgericht Beispielburg</p><p>USt-IdNr.: DE123456789</p></main>', 'Impressum');
  } else if (path === '/datenschutz') {
    html('<main><h1>Datenschutzerklärung</h1><p>Beispieltext.</p></main>', 'Datenschutz');
  } else if (path === '/trace') {
    // Stand-in for Cloudflare's trace page (DEV_TRACE_URL), read once per browser.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('fl=dev\nloc=XX\ncolo=DEV\n');
  } else if (path.endsWith('.svg')) {
    const send = (): void => {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#cccccc"/></svg>');
    };
    if (path === '/langsam.svg') setTimeout(send, 8_000);
    else send();
  } else {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('nicht gefunden');
  }
}

async function startFixture(kind: FixtureKind, port: number): Promise<{ site: FixtureSite; server: Server }> {
  const hits = new Map<string, number>();
  let actual = port;
  const server = createServer((req, res) => handle(kind, actual, hits, req, res));
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => {
      actual = (server.address() as { port: number }).port;
      done();
    });
  });
  return { site: { kind, origin: `http://localhost:${actual}`, hits }, server };
}

function run(args: string[]): void {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', input: '', timeout: 180_000 });
  if (result.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed:\n${result.stdout}${result.stderr}`);
}

export async function startDevSite(options: DevOptions = {}): Promise<DevSite> {
  const port = options.port ?? 8787;
  if (options.build ?? true) {
    const build = spawnSync('npm run build:web', { cwd: ROOT, stdio: options.echo ? 'inherit' : 'pipe', shell: true, encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`npm run build:web failed:\n${build.stdout ?? ''}${build.stderr ?? ''}`);
  }
  const ports = options.fixturePorts ?? [8791, 8792, 8793];
  const started = await Promise.all((['plain', 'slow', 'queued'] as const).map((kind, i) => startFixture(kind, ports[i]!)));
  const fixtures = Object.fromEntries(started.map((s) => [s.site.kind, s.site])) as Record<FixtureKind, FixtureSite>;
  const origins = [...started.map((s) => s.site.origin), ...(options.self ? [`http://localhost:${port}`] : [])].join(',');

  // A fresh local database each time: the cache, the rate limit and the queue start empty.
  const persist = mkdtempSync(join(tmpdir(), 'wc-dev-'));
  run(['d1', 'migrations', 'apply', 'website-check', '--local', '-c', API_CONFIG, '--persist-to', persist]);

  // With several `-c` configs `--var` reaches only the first Worker: the scan Worker gets its variables from a
  // git-ignored copy of its config. The secret of the rate limit is random for each start and never printed.
  const copy = `worker/wrangler.scanner.dev-${process.pid}.local.jsonc`;
  const vars = {
    DEV_MODE: '1',
    DEV_ORIGINS: origins,
    DEV_TRACE_URL: `${fixtures.plain.origin}/trace`,
    RATE_LIMIT_SECRET: randomBytes(32).toString('hex'),
    QUEUE_MAX_PARALLEL: String(options.parallel ?? 1),
  };
  const text = readFileSync(resolve(ROOT, SCANNER_CONFIG), 'utf8');
  writeFileSync(resolve(ROOT, copy), text.replace(/\}\s*$/, `,\n  "vars": ${JSON.stringify(vars)}\n}\n`));

  const args = [WRANGLER, 'dev', '-c', API_CONFIG, '-c', copy, '--ip', '127.0.0.1', '--port', String(port), '--local', '--persist-to', persist, '--var', 'DEV_MODE:1', '--var', `DEV_ORIGINS:${origins}`];
  const child: ChildProcess = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const origin = `http://127.0.0.1:${port}`;

  const stop = async (): Promise<void> => {
    if (child.pid !== undefined && child.exitCode === null) {
      // wrangler starts workerd as a child process; end the whole tree.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else child.kill('SIGTERM');
    }
    await Promise.all(started.map((s) => new Promise<void>((done) => s.server.close(() => done()))));
    rmSync(resolve(ROOT, copy), { force: true });
    // workerd may hold the database files a moment after it ended (Windows): try again, then leave the temp folder.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(persist, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  try {
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`wrangler dev did not start:\n${output.slice(-2000)}`)), 120_000);
      const onData = (chunk: Buffer): void => {
        const piece = chunk.toString();
        output += piece;
        if (options.echo) process.stdout.write(piece);
        if (output.includes(`Ready on ${origin}`)) {
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
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, fixtures, stop };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const portArg = process.argv.indexOf('--port');
  const site = await startDevSite({ build: !process.argv.includes('--no-build'), echo: false, ...(portArg >= 0 ? { port: Number(process.argv[portArg + 1]) } : {}) });
  console.log(`\nWebsite-Check DE on this computer: ${site.origin}/   (stop with Ctrl+C)`);
  console.log('Fixture sites to enter in the form:');
  console.log(`  ${site.fixtures.plain.origin}/   an ordinary homepage with an Impressum`);
  console.log(`  ${site.fixtures.slow.origin}/   the same, scan takes about 10 s`);
  console.log(`  ${site.fixtures.queued.origin}/   start it while the second runs: it waits in the queue and can be cancelled`);
  const end = (): void => {
    void site.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', end);
  process.on('SIGTERM', end);
}
