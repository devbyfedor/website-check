import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { holdBadPorts } from './ports.ts';

/**
 * Session C1, step 3: the lab Workers of the measurements on plain `wrangler dev` (local workerd, local Chrome, no
 * Cloudflare account, no browser minutes), each on a port of its own, so each is a host of its own:
 *
 *   node scanner/src/local/c1-lab-dev.ts [--parallel 3]
 *
 *   http://127.0.0.1:8788  the lab API Worker with the lab scan Worker (queue object) behind it (`worker/src/lab/e2e.ts`)
 *   http://127.0.0.1:8794  the lab pages Worker (`worker/src/lab/pages.ts`, page chosen with POST /lab/mode)
 *   http://127.0.0.1:8795  the lab tracker Worker (the same code, always the page that calls a tracker after 2 s)
 *   http://127.0.0.1:8796  the lab launcher Worker of session C2 (`worker/src/lab/launcher.ts`: one browser opened and closed)
 *
 * The queue object gets the dev switch with the three origins in a git-ignored copy of its config (with several `-c`
 * configs `--var` reaches only the first Worker). The local secrets come from `worker/.dev.vars`. Every process of it
 * gets a temp folder of its own, deleted when this script ends (Ctrl+C).
 */

const { values } = parseArgs({ options: { parallel: { type: 'string', default: '1' } } });
const parallel = String(Number(values.parallel));

const API = 8788;
const PAGES = 8794;
const TRACKER = 8795;
const LAUNCHER = 8796;
const origin = (port: number) => `http://127.0.0.1:${port}`;
const DEV_VARS = { DEV_MODE: '1', DEV_ORIGINS: [API, PAGES, TRACKER].map(origin).join(','), DEV_TRACE_URL: `${origin(API)}/fixture/trace` };

const root = resolve(import.meta.dirname, '../../..');
const source = resolve(root, 'worker/wrangler.lab-e2e-scanner.jsonc');
const copy = resolve(root, 'worker/wrangler.lab-e2e-scanner.c1-dev.local.jsonc');
const marker = '"vars": { "QUEUE_MAX_PARALLEL": "1" }';
const text = readFileSync(source, 'utf8');
if (!text.includes(marker)) throw new Error(`${source}: vars line not found`);
writeFileSync(copy, text.replace(marker, `"vars": ${JSON.stringify({ QUEUE_MAX_PARALLEL: parallel, ...DEV_VARS })}`));

const hold = await holdBadPorts();
const temp = mkdtempSync(join(tmpdir(), 'wc-c1-dev-'));
const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp };

const children: ChildProcess[] = [];
function start(name: string, args: string[]): void {
  const child = spawn('npx', ['wrangler', 'dev', ...args, '--ip', '127.0.0.1', '--local'], { cwd: root, env, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = (chunk: Buffer) => chunk.toString().split('\n').filter((l) => l.trim() !== '').map((l) => `[${name}] ${l}`).join('\n');
  child.stdout?.on('data', (chunk: Buffer) => console.log(prefix(chunk)));
  child.stderr?.on('data', (chunk: Buffer) => console.error(prefix(chunk)));
  child.on('exit', (code) => console.log(`[${name}] exited ${code}`));
  children.push(child);
}

// A local D1 of its own for each process (one SQLite file is not shared between processes), the API's with the migrations.
const persist = (name: string) => join(temp, `state-${name}`);
const migrate = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'website-check-lab-db', '--local', '--persist-to', persist('api'), '-c', 'worker/wrangler.lab-e2e.jsonc'], { cwd: root, env: { ...env, CI: '1' }, shell: process.platform === 'win32', encoding: 'utf8' });
if (migrate.status !== 0) throw new Error(`migrations failed:\n${(migrate.stdout ?? '') + (migrate.stderr ?? '')}`);
const apiVars = Object.entries(DEV_VARS).flatMap(([key, value]) => ['--var', `${key}:${value}`]);
start('api', ['-c', 'worker/wrangler.lab-e2e.jsonc', '-c', 'worker/wrangler.lab-e2e-scanner.c1-dev.local.jsonc', '--port', String(API), '--inspector-port', '9231', '--persist-to', persist('api'), ...apiVars]);
start('pages', ['-c', 'worker/wrangler.lab-pages.jsonc', '--port', String(PAGES), '--inspector-port', '9232', '--persist-to', persist('pages')]);
start('tracker', ['-c', 'worker/wrangler.lab-tracker.jsonc', '--port', String(TRACKER), '--inspector-port', '9233', '--persist-to', persist('tracker')]);
start('launcher', ['-c', 'worker/wrangler.lab-launcher.jsonc', '--port', String(LAUNCHER), '--inspector-port', '9234', '--persist-to', persist('launcher')]);
console.log(`queue: ${parallel} at a time; api ${origin(API)}, pages ${origin(PAGES)}, tracker ${origin(TRACKER)}, launcher ${origin(LAUNCHER)}; temp ${temp}`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid === undefined) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  await new Promise((done) => setTimeout(done, 1_500));
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  rmSync(copy, { force: true });
  await hold.release();
  process.exit(0);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
// The driver can end it too: a file `local/c1/stop-dev` appearing.
const stopFile = resolve(root, 'local/c1/stop-dev');
rmSync(stopFile, { force: true });
setInterval(() => {
  try {
    readFileSync(stopFile);
    void stop();
  } catch {
    // not yet
  }
}, 1_000);
