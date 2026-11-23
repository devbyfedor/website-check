import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateReport } from '../report/validate.ts';
import { parseSitesFile } from './sites-file.ts';
import type { TailRecord } from './tail-filter.ts';

/**
 * CPU of the API Worker per request, sessions A5 part 4 and 5, against the lab API Worker (`worker/src/lab/e2e.ts`)
 * and the lab scan Worker behind it. One round right after each deploy of the lab API Worker:
 *
 *   npm run lab:cpu -- --base https://website-check-lab.<sub>.workers.dev --round r1
 *   npm run lab:cpu -- --base ... --round r4 --first status       (the first request is a status read)
 *   npm run lab:cpu -- --summary                                   (joins the rounds with the tail files)
 *   npm run lab:cpu -- --base ... --round r5 --cache-site 14       (part 5: the cache path first and last)
 *
 * `--dir` names the folder under `local/a5/` (default `part5`; part 4 used `part4`). `--cache-site <n>`
 * (part 5) starts the address of a listed site whose full check finished in the end-to-end check before: the
 * queue object answers from the 24-hour cache (`cached: true`), so nothing is checked and the site is not
 * visited; it is the first request of the round and once more the last. A finished quick check is never
 * reused by the cache (docs/decisions.md, A5 part 2), so the repeated starts of example.com are new scans.
 *
 * New scans are quick checks without a browser (`x-lab-force: quick`) of example.com, the domain reserved for
 * examples; no test site is visited. Every request carries `?label=<round>-<nn>-<kind>`, which
 * `tail-filter.ts` keeps, so each request is matched with its tail event; the lab gate's `x-lab-isolate` and
 * `x-lab-served` headers tell the first requests of a fresh instance. Rounds go to `local/a5/<dir>/<round>.json`,
 * the tail of the lab API Worker to `local/a5/<dir>/tail-<round>.jsonl` (git-ignored). The token is read from
 * `worker/.dev.vars` and never printed.
 */

let OUT = resolve('local', 'a5', 'part5');
// The fourth spelling normalizes to the same address as the first, so starting it at once joins the queued scan (cache path).
const EXAMPLE_ADDRESSES = ['example.com', 'https://example.com/', 'EXAMPLE.com', 'https://EXAMPLE.com/irgendwo'];
const CPU_LIMIT_MS = 8;

interface Call {
  label: string;
  kind: string;
  method: 'GET' | 'POST';
  status: number;
  isolate: string | null;
  served: number | null;
  ms: number;
  body: Record<string, unknown> | null;
}

async function readToken(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  const token = /^LAB_TOKEN=(.+)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '');
  if (token === undefined || token.length < 32) throw new Error(`LAB_TOKEN missing in ${path}`);
  return token;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function round(base: string, name: string, first: 'start' | 'status', devVars: string, cacheUrl: string | null): Promise<void> {
  const token = await readToken(devVars);
  const calls: Call[] = [];
  let seq = 0;
  const call = async (method: 'GET' | 'POST', path: string, kind: string, body?: unknown): Promise<Call> => {
    seq += 1;
    const label = `${name}-${String(seq).padStart(2, '0')}-${kind}`;
    const started = performance.now();
    const response = await fetch(`${base}${path}?label=${encodeURIComponent(label)}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json', 'x-lab-force': 'quick' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    // Kept: the API's own fields; a report is reduced to its state and whether it passes the schema.
    let kept: Record<string, unknown> | null = null;
    if (kind === 'report' && json !== null && response.status === 200) kept = { state: json['state'], valid: validateReport(json).length === 0, bytes: text.length };
    else if (json !== null) kept = Object.fromEntries(Object.entries(json).filter(([key]) => ['id', 'status', 'state', 'cached', 'queuePosition', 'error', 'reason'].includes(key)));
    const served = Number(response.headers.get('x-lab-served'));
    const record: Call = { label, kind, method, status: response.status, isolate: response.headers.get('x-lab-isolate'), served: Number.isInteger(served) && served > 0 ? served : null, ms, body: kept };
    calls.push(record);
    console.log(`${label}: HTTP ${record.status} isolate ${record.isolate ?? '-'} #${record.served ?? '-'} ${ms} ms ${JSON.stringify(kept)}`);
    return record;
  };

  // Part 5: the cache path, a start of an address whose full check finished before (no check, no visit).
  const cachedStart = async (): Promise<void> => {
    if (cacheUrl === null) return;
    const answer = await call('POST', '/api/scans', 'start-cached', { url: cacheUrl });
    if (answer.body?.['cached'] !== true) console.log(`${answer.label}: not answered from the cache`);
  };
  await cachedStart();
  const previous = await readFile(resolve(OUT, 'last-id.txt'), 'utf8').catch(() => '');
  if (first === 'status') {
    if (previous.trim() === '') throw new Error('no scan id of an earlier round for --first status');
    await call('GET', `/api/scans/${previous.trim()}`, 'status');
  }
  const waitDone = async (id: string): Promise<void> => {
    for (let i = 0; i < 40; i += 1) {
      const status = await call('GET', `/api/scans/${id}`, 'status');
      const s = status.body?.['status'];
      if (s === 'done' || s === 'error') return;
      await sleep(400);
    }
    throw new Error(`scan of ${name} not done`);
  };
  let firstId = '';
  for (const [i, address] of EXAMPLE_ADDRESSES.slice(0, 3).entries()) {
    const started = await call('POST', '/api/scans', 'start', { url: address });
    const id = typeof started.body?.['id'] === 'string' ? (started.body['id'] as string) : '';
    if (id === '') throw new Error(`start answered HTTP ${started.status}`);
    if (i === 0) {
      firstId = id;
      // The same address again at once: joins the queued scan (cache path) or starts a new one.
      await call('POST', '/api/scans', 'start-again', { url: EXAMPLE_ADDRESSES[3] });
    }
    await waitDone(id);
    await call('GET', `/api/scans/${id}/report`, 'report');
  }
  await call('GET', `/api/scans/${firstId}`, 'status');
  await call('POST', '/api/scans', 'refused', { url: 'http://127.0.0.1/' });
  await call('GET', '/api/scans/aaaaaaaaaaaaaaaaaaaaaaaaaa', 'unknown');
  await cachedStart();
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, 'last-id.txt'), `${firstId}\n`);
  await writeFile(resolve(OUT, `${name}.json`), `${JSON.stringify({ round: name, first, at: new Date().toISOString(), calls }, null, 2)}\n`);
  console.log(`saved ${name}.json (${calls.length} API requests)`);
}

/** Diagnosis: each operation of a scan start alone (`/lab/cost`), interleaved, after a fresh deploy. */
async function probe(base: string, name: string, devVars: string): Promise<void> {
  const token = await readToken(devVars);
  const calls: Call[] = [];
  const ops = ['none', 'd1', 'd1x6', 'doh', 'do', 'hmac'];
  let seq = 0;
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (const op of ops) {
      seq += 1;
      const label = `${name}-${String(seq).padStart(2, '0')}-cost-${op}`;
      const started = performance.now();
      const response = await fetch(`${base}/lab/cost?op=${op}&label=${encodeURIComponent(label)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      await response.text();
      const served = Number(response.headers.get('x-lab-served'));
      const record: Call = { label, kind: `cost-${op}`, method: 'GET', status: response.status, isolate: response.headers.get('x-lab-isolate'), served: Number.isInteger(served) && served > 0 ? served : null, ms: Math.round(performance.now() - started), body: null };
      calls.push(record);
      console.log(`${label}: HTTP ${record.status} isolate ${record.isolate ?? '-'} #${record.served ?? '-'} ${record.ms} ms`);
    }
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, `${name}.json`), `${JSON.stringify({ round: name, first: 'probe', at: new Date().toISOString(), calls }, null, 2)}\n`);
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))] ?? Number.NaN;
}

async function summary(pattern: RegExp, outName: string): Promise<void> {
  const files = (await readdir(OUT)).filter((f) => pattern.test(f)).sort();
  const all: (Call & { round: string; cpu: number | null; wall: number | null; outcome: string | null })[] = [];
  let tailEvents = 0;
  let unlabelled = 0;
  for (const file of files) {
    const roundData = JSON.parse(await readFile(resolve(OUT, file), 'utf8')) as { round: string; calls: Call[] };
    const tail = (await readFile(resolve(OUT, `tail-${roundData.round}.jsonl`), 'utf8').catch(() => ''))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as TailRecord);
    tailEvents += tail.length;
    unlabelled += tail.filter((t) => t.label === null).length;
    const byLabel = new Map(tail.filter((t) => t.label !== null).map((t) => [t.label as string, t]));
    for (const c of roundData.calls) {
      const t = byLabel.get(c.label);
      all.push({ ...c, round: roundData.round, cpu: t?.cpuTime ?? null, wall: t?.wallTime ?? null, outcome: t?.outcome ?? null });
    }
  }
  const measured = all.filter((c) => c.cpu !== null);
  const cpus = measured.map((c) => c.cpu as number);
  console.log(`rounds ${files.length}, API requests ${all.length}, matched with a tail event ${measured.length}, missing ${all.length - measured.length}; tail events ${tailEvents} (without a label ${unlabelled})`);
  console.log(`CPU ms: median ${quantile(cpus, 0.5)}, p90 ${quantile(cpus, 0.9)}, max ${Math.max(...cpus)}; above ${CPU_LIMIT_MS} ms: ${cpus.filter((v) => v > CPU_LIMIT_MS).length}`);
  console.log(`outcomes: ${JSON.stringify(Object.fromEntries([...new Set(measured.map((c) => c.outcome))].map((o) => [o, measured.filter((c) => c.outcome === o).length])))}`);
  const firstOfIsolate = all.filter((c) => c.served === 1);
  console.log(`first request of an isolate: ${firstOfIsolate.map((c) => `${c.label} ${c.cpu ?? '?'} ms`).join(', ')}`);
  const early = all.filter((c) => c.served !== null && c.served <= 3);
  console.log(`requests 1 to 3 of an isolate: max ${Math.max(...early.map((c) => c.cpu ?? 0))} ms over ${early.length}`);
  for (const kind of [...new Set(all.map((c) => c.kind))]) {
    const v = measured.filter((c) => c.kind === kind).map((c) => c.cpu as number);
    console.log(`  ${kind}: n=${v.length} median ${quantile(v, 0.5)} max ${Math.max(...v)}`);
  }
  for (const file of files) {
    const r = all.filter((c) => `${c.round}.json` === file);
    console.log(`  ${file.replace('.json', '')}: ${r.length} requests, isolates ${new Set(r.map((c) => c.isolate)).size}, CPU ${r.map((c) => c.cpu ?? '?').join(' ')}`);
  }
  await writeFile(resolve(OUT, outName), `${JSON.stringify(all, null, 2)}\n`);
}

const { values } = parseArgs({
  options: {
    base: { type: 'string' },
    round: { type: 'string' },
    first: { type: 'string', default: 'start' },
    summary: { type: 'boolean', default: false },
    // Diagnosis round `p<n>` of the operations of a start (`/lab/cost`), and its summary with --summary --probe.
    probe: { type: 'boolean', default: false },
    'dev-vars': { type: 'string', default: 'worker/.dev.vars' },
    dir: { type: 'string', default: 'part5' },
    'cache-site': { type: 'string' },
    sites: { type: 'string', default: 'local/sites.txt' },
  },
});
if (!/^part\d+$/.test(values.dir)) throw new Error('--dir must be part<n>');
OUT = resolve('local', 'a5', values.dir);
let cacheUrl: string | null = null;
if (values['cache-site'] !== undefined) {
  const { sites, errors } = parseSitesFile(await readFile(resolve(values.sites), 'utf8'));
  if (errors.length > 0) throw new Error(errors.join('\n'));
  const n = values['cache-site'].trim().padStart(2, '0');
  const site = sites.find((entry) => entry.number === n);
  if (site === undefined) throw new Error(`no site ${n}`);
  cacheUrl = site.url;
}
if (values.summary) await summary(values.probe ? /^p\d+\.json$/ : /^r\d+\.json$/, values.probe ? 'summary-probe.json' : 'summary.json');
else {
  const pattern = values.probe ? /^p\d+$/ : /^r\d+$/;
  if (values.base === undefined || values.round === undefined || !pattern.test(values.round)) throw new Error('usage: --base <url> --round r<n> [--first start|status] | --probe --round p<n> | --summary [--probe]');
  const base = values.base.replace(/\/$/, '');
  const url = new URL(base);
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('--base must be https (or local wrangler dev)');
  if (values.probe) await probe(base, values.round, resolve(values['dev-vars']));
  else await round(base, values.round, values.first === 'status' ? 'status' : 'start', resolve(values['dev-vars']), cacheUrl);
}
