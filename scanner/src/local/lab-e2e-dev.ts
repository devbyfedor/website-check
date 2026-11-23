import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Local `wrangler dev` of the two lab Workers of session A5 part 4 (local workerd and local Chrome, no
 * Cloudflare account, no browser minutes):
 *
 *   npm run lab:e2e:dev
 *
 * With several `-c` configs in one wrangler process, `--var` reaches only the first Worker. The queue
 * object in the lab scan Worker needs the dev switch too (exempt fixture origin, fixture trace page), so
 * this writes a git-ignored copy `worker/wrangler.lab-e2e-scanner.dev.local.jsonc` with those variables and
 * starts both Workers on 127.0.0.1:8788. The dev switch never reaches a deployed Worker: the API refuses to
 * work with it on any host but a loopback address.
 */

const PORT = 8788;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DEV_VARS = { DEV_MODE: '1', DEV_ORIGINS: ORIGIN, DEV_TRACE_URL: `${ORIGIN}/fixture/trace` };

const root = resolve(import.meta.dirname, '../../..');
const source = resolve(root, 'worker/wrangler.lab-e2e-scanner.jsonc');
const copy = resolve(root, 'worker/wrangler.lab-e2e-scanner.dev.local.jsonc');

const text = await readFile(source, 'utf8');
const marker = '"vars": { "QUEUE_MAX_PARALLEL": "1" }';
if (!text.includes(marker)) throw new Error(`${source}: vars line not found`);
const vars = Object.entries(DEV_VARS).map(([key, value]) => `, ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join('');
await writeFile(copy, text.replace(marker, marker.replace(' }', `${vars} }`)));

const args = ['wrangler', 'dev', '-c', 'worker/wrangler.lab-e2e.jsonc', '-c', 'worker/wrangler.lab-e2e-scanner.dev.local.jsonc', '--ip', '127.0.0.1', '--port', String(PORT), '--local'];
for (const [key, value] of Object.entries(DEV_VARS)) args.push('--var', `${key}:${value}`);
const child = spawn('npx', args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
