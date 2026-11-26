import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { validateReport } from '../report/validate.ts';
import { parseSitesFile } from './sites-file.ts';

/**
 * Driver of the measurements of session C1 against the lab Workers (`worker/src/lab/e2e.ts` with the lab scan Worker
 * behind it, `worker/src/lab/pages.ts` as the pages and the tracker Worker). The same steps run against plain
 * `wrangler dev` (`c1-lab-dev.ts`, 0 Cloudflare minutes) and against the lab Workers on workers.dev:
 *
 *   node scanner/src/local/c1-lab.ts --step sites --mode sequential --only 06,10,14 --run seq   (or --targets url,url)
 *   node scanner/src/local/c1-lab.ts --step sites --mode parallel --only 06,10,14 --run par
 *   node scanner/src/local/c1-lab.ts --step compare --a seq --b par
 *   node scanner/src/local/c1-lab.ts --step tracker [--flood] --run tracker-alone
 *   node scanner/src/local/c1-lab.ts --step reader --run reader
 *   node scanner/src/local/c1-lab.ts --step errors --run errors
 *   node scanner/src/local/c1-lab.ts --step cpu --round r1 --first status|cancel --run cpu
 *   node scanner/src/local/c1-lab.ts --step launches --dir c2 --run launches [--race-ms 300]   (session C2, step 5)
 *
 * Bases: `--base` (lab API), `--pages`, `--tracker`. Everything goes to `local/c1/<run>/` (git-ignored); the console
 * shows anonymous labels only ("Site NN", "pages", "tracker"). The token is read from `worker/.dev.vars`, never printed.
 * Every API request carries `?label=<run>-<nn>-<kind>` for the tail filter.
 */

const { values } = parseArgs({
  options: {
    step: { type: 'string' },
    base: { type: 'string', default: 'http://127.0.0.1:8788' },
    pages: { type: 'string', default: 'http://127.0.0.1:8794' },
    tracker: { type: 'string', default: 'http://127.0.0.1:8795' },
    launcher: { type: 'string', default: 'http://127.0.0.1:8796' },
    dir: { type: 'string', default: 'c1' },
    'race-ms': { type: 'string' },
    'max-browser-s': { type: 'string', default: '60' },
    mode: { type: 'string', default: 'sequential' },
    only: { type: 'string' },
    targets: { type: 'string' },
    run: { type: 'string' },
    flood: { type: 'boolean', default: false },
    variant: { type: 'string', default: 'tracker-2s' },
    forget: { type: 'boolean', default: false },
    // Sequential mode: the next start waits until this long after the previous start. The queue spaces its browser
    // launches by 20 s from before its own acquire, Browser Run from the session's start (C1: a launch 1 s early was
    // refused and the queue marked the whole UTC day as used up), so the measurement keeps a margin.
    'gap-s': { type: 'string', default: '30' },
    round: { type: 'string', default: 'r1' },
    first: { type: 'string', default: 'status' },
    a: { type: 'string' },
    b: { type: 'string' },
    modes: { type: 'string', default: 'small,html-028,html-060,html-059,html-020,html-024,html-025' },
    sites: { type: 'string', default: 'local/sites.txt' },
    'dev-vars': { type: 'string', default: 'worker/.dev.vars' },
    'timeout-s': { type: 'string', default: '180' },
  },
});

const strip = (url: string) => url.replace(/\/$/, '');
const BASE = strip(values.base);
const PAGES = strip(values.pages);
const TRACKER = strip(values.tracker);
const LAUNCHER = strip(values.launcher);
for (const url of [BASE, PAGES, TRACKER, LAUNCHER]) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1') throw new Error(`${url}: https or local wrangler dev only`);
}
const RUN = values.run ?? `${values.step}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const OUT = resolve('local', values.dir, RUN);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function readToken(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  const token = /^LAB_TOKEN=(.+)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '');
  if (token === undefined || token.length < 32) throw new Error(`LAB_TOKEN missing in ${path}`);
  return token;
}
const TOKEN = await readToken(resolve(values['dev-vars']));

interface Answer {
  label: string;
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  isolate: string | null;
  served: number | null;
  at: number;
  ms: number;
}

const calls: Answer[] = [];
let seq = 0;

async function call(base: string, method: 'GET' | 'POST', path: string, kind: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> {
  seq += 1;
  const label = `${RUN}-${String(seq).padStart(2, '0')}-${kind}`;
  const at = Date.now();
  const sep = path.includes('?') ? '&' : '?';
  const response = await fetch(`${base}${path}${sep}label=${encodeURIComponent(label)}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  const served = Number(response.headers.get('x-lab-served'));
  const answer: Answer = { label, status: response.status, json, text, isolate: response.headers.get('x-lab-isolate'), served: Number.isInteger(served) && served > 0 ? served : null, at, ms: Date.now() - at };
  calls.push(answer);
  return answer;
}

async function save(name: string, data: unknown): Promise<void> {
  await mkdir(resolve(OUT, 'reports'), { recursive: true });
  await writeFile(resolve(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
}

interface Target {
  label: string;
  url: string;
}

async function siteTargets(): Promise<Target[]> {
  const out: Target[] = [];
  if (values.only !== undefined) {
    const { sites, errors } = parseSitesFile(await readFile(resolve(values.sites), 'utf8'));
    if (errors.length > 0) throw new Error(errors.join('\n'));
    for (const n of values.only.split(',').map((s) => s.trim().padStart(2, '0'))) {
      const site = sites.find((s) => s.number === n);
      if (site === undefined) throw new Error(`no site ${n}`);
      out.push({ label: site.label, url: site.url });
    }
  }
  for (const [i, url] of (values.targets ?? '').split(',').filter((s) => s.trim() !== '').entries()) out.push({ label: `Target ${i + 1}`, url: url.trim() });
  return out;
}

interface Started {
  target: Target;
  id: string;
  token: string | null;
  startStatus: number;
  cached: boolean;
  startedAt: number;
  doneAt: number | null;
  final: Record<string, unknown> | null;
}

async function startScan(target: Target, quick = false): Promise<Started> {
  const answer = await call(BASE, 'POST', '/api/scans', quick ? 'start-quick' : 'start', { url: target.url }, quick ? { 'x-lab-force': 'quick' } : {});
  const id = typeof answer.json?.['id'] === 'string' ? (answer.json['id'] as string) : '';
  const token = typeof answer.json?.['cancelToken'] === 'string' ? (answer.json['cancelToken'] as string) : null;
  console.log(`${target.label}: start HTTP ${answer.status}${answer.json?.['cached'] === true ? ' (cached)' : ''}, place ${String(answer.json?.['queuePosition'] ?? '-')}${id === '' ? `, ${answer.text.slice(0, 160)}` : ''}`);
  return { target, id, token, startStatus: answer.status, cached: answer.json?.['cached'] === true, startedAt: answer.at, doneAt: null, final: null };
}

async function waitDone(list: Started[], pollMs = 2_000): Promise<void> {
  const deadline = Date.now() + Number(values['timeout-s']) * 1000;
  while (Date.now() < deadline) {
    let open = 0;
    for (const s of list) {
      if (s.final !== null || s.id === '') continue;
      const status = await call(BASE, 'GET', `/api/scans/${s.id}`, 'status');
      const st = status.json?.['status'];
      if (st === 'done' || st === 'error') {
        s.final = status.json;
        s.doneAt = Date.now();
      } else open += 1;
    }
    if (open === 0) return;
    await sleep(pollMs);
  }
  console.log('timeout: not every scan finished');
}

interface ReportFacts {
  state: string;
  mode: string;
  country: string | null;
  colo: string | null;
  pages: unknown;
  thirdPartyHosts: string[];
  services: { key: string; riskClass: string; requestCount: number; firstStartMs: number; hosts: string[] }[];
  findings: string[];
  durationMs: number | null;
  valid: boolean;
  bytes: number;
  failure: unknown;
}

async function fetchReport(s: Started, fileLabel: string): Promise<ReportFacts | null> {
  if (s.id === '') return null;
  const report = await call(BASE, 'GET', `/api/scans/${s.id}/report`, 'report');
  if (report.status !== 200 || report.json === null) {
    console.log(`${s.target.label}: report HTTP ${report.status} ${report.text.slice(0, 160)}`);
    return null;
  }
  await mkdir(resolve(OUT, 'reports'), { recursive: true });
  await writeFile(resolve(OUT, 'reports', `${fileLabel}.json`), `${JSON.stringify(report.json, null, 2)}\n`);
  if (s.final !== null) await writeFile(resolve(OUT, 'reports', `${fileLabel}.status.json`), `${JSON.stringify(s.final, null, 2)}\n`);
  const r = report.json as unknown as { state: string; scan: { mode: string; durationMs: number | null }; visit: { country: string | null; colo: string | null }; pages: unknown; failure: unknown; services: { key: string; riskClass: string; requestCount: number; firstStartMs: number; hosts: string[] }[]; findings: { id: string; risk: string | null }[] };
  return {
    state: r.state,
    mode: r.scan.mode,
    country: r.visit.country,
    colo: r.visit.colo,
    pages: r.pages,
    thirdPartyHosts: [...new Set(r.services.flatMap((x) => x.hosts))].sort(),
    services: r.services.map((x) => ({ key: x.key, riskClass: x.riskClass, requestCount: x.requestCount, firstStartMs: x.firstStartMs, hosts: x.hosts })),
    findings: r.findings.map((f) => `${f.id}${f.risk === null ? '' : ` [${f.risk}]`}`).sort(),
    durationMs: r.scan.durationMs,
    valid: validateReport(report.json).length === 0,
    bytes: report.text.length,
    failure: r.failure,
  };
}

async function labInfo(ids: Map<string, string>): Promise<Record<string, unknown>> {
  const stats = await call(BASE, 'GET', '/lab/stats', 'stats');
  let limits = await call(BASE, 'GET', '/lab/limits', 'limits');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const history = (limits.json?.['history'] as { endTime?: number | null }[] | undefined) ?? [];
    if (history.length === 0 || (history[0]?.endTime !== null && history[0]?.endTime !== undefined)) break;
    await sleep(2_000);
    limits = await call(BASE, 'GET', '/lab/limits', 'limits');
  }
  const q = stats.json as { metrics?: Record<string, unknown>[]; browsers?: Record<string, unknown>[]; day?: unknown } | null;
  const metrics = (q?.metrics ?? []).filter((m) => ids.has(String(m['id']))).map((m) => ({ ...m, id: ids.get(String(m['id'])) }));
  const history = ((limits.json?.['history'] as { startTime?: number; endTime?: number | null; closeReasonText?: string }[] | undefined) ?? []).slice(0, 6).map((h) => ({ startTime: h.startTime ?? null, seconds: h.endTime && h.startTime ? (h.endTime - h.startTime) / 1000 : null, close: h.closeReasonText ?? null }));
  return { metrics, browsers: q?.browsers ?? [], day: q?.day ?? null, history, usedBrowserTimeSeconds: (limits.json?.['limits'] as { usedBrowserTimeSeconds?: unknown } | undefined)?.usedBrowserTimeSeconds ?? null };
}

const fileLabelOf = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function stepSites(): Promise<void> {
  if (values.forget) await forget();
  const targets = await siteTargets();
  if (targets.length === 0) throw new Error('--only or --targets');
  const startedAt = Date.now();
  const all: Started[] = [];
  if (values.mode === 'parallel') {
    all.push(...(await Promise.all(targets.map((t) => startScan(t)))));
    await waitDone(all);
  } else {
    for (const t of targets) {
      const previous = all.at(-1);
      if (previous !== undefined) {
        const wait = previous.startedAt + Number(values['gap-s']) * 1000 - Date.now();
        if (wait > 0) await sleep(wait);
      }
      const s = await startScan(t);
      all.push(s);
      await waitDone([s]);
    }
  }
  const facts: Record<string, unknown> = {};
  for (const s of all) {
    const f = await fetchReport(s, fileLabelOf(s.target.label));
    facts[s.target.label] = f;
    console.log(`${s.target.label}: ${s.final?.['status'] ?? '-'} ${f === null ? 'no report' : `${f.state} ${f.mode} valid=${f.valid} country=${f.country} colo=${f.colo} pages=${JSON.stringify(f.pages)} hosts=${f.thirdPartyHosts.length} findings=${f.findings.length} ${Math.round((s.doneAt ?? 0) - s.startedAt)} ms`}`);
  }
  const info = await labInfo(new Map(all.map((s) => [s.id, s.target.label])));
  console.log(JSON.stringify({ metrics: info['metrics'], history: info['history'], used: info['usedBrowserTimeSeconds'] }, null, 1));
  await save('summary.json', { run: RUN, mode: values.mode, startedAt, scans: all.map((s) => ({ label: s.target.label, id: s.id, startStatus: s.startStatus, cached: s.cached, startedAt: s.startedAt, doneAt: s.doneAt, status: s.final?.['status'] ?? null })), facts, info });
}

async function stepCompare(): Promise<void> {
  if (values.a === undefined || values.b === undefined) throw new Error('--a and --b');
  const load = async (run: string) => JSON.parse(await readFile(resolve('local', 'c1', run, 'summary.json'), 'utf8')) as { facts: Record<string, ReportFacts | null> };
  const a = await load(values.a);
  const b = await load(values.b);
  const lines: Record<string, unknown>[] = [];
  for (const label of Object.keys(a.facts)) {
    const fa = a.facts[label];
    const fb = b.facts[label];
    if (fa === null || fa === undefined || fb === null || fb === undefined) {
      lines.push({ label, missing: true });
      continue;
    }
    const diff = (x: string[], y: string[]) => ({ onlyA: x.filter((v) => !y.includes(v)), onlyB: y.filter((v) => !x.includes(v)) });
    const hosts = diff(fa.thirdPartyHosts, fb.thirdPartyHosts);
    const findings = diff(fa.findings, fb.findings);
    lines.push({ label, stateA: fa.state, stateB: fb.state, hostsA: fa.thirdPartyHosts.length, hostsB: fb.thirdPartyHosts.length, sameHosts: hosts.onlyA.length === 0 && hosts.onlyB.length === 0, hosts, findingsA: fa.findings.length, findingsB: fb.findings.length, sameFindings: findings.onlyA.length === 0 && findings.onlyB.length === 0, findings });
  }
  await mkdir(resolve('local', 'c1'), { recursive: true });
  await writeFile(resolve('local', 'c1', `compare-${values.a}-${values.b}.json`), `${JSON.stringify(lines, null, 2)}\n`);
  // The console shows counts only (the host names stay in the file).
  for (const l of lines) console.log(JSON.stringify({ label: l['label'], sameHosts: l['sameHosts'], sameFindings: l['sameFindings'], hostsA: l['hostsA'], hostsB: l['hostsB'], findingsA: l['findingsA'], findingsB: l['findingsB'], diffHosts: l['hosts'] === undefined ? null : [(l['hosts'] as { onlyA: string[] }).onlyA.length, (l['hosts'] as { onlyB: string[] }).onlyB.length], diffFindings: l['findings'] === undefined ? null : l['findings'] }));
}

async function setPage(page: string, base = PAGES): Promise<void> {
  const answer = await call(base, 'POST', '/lab/mode', 'mode', { page });
  if (answer.status !== 200) throw new Error(`mode ${page}: HTTP ${answer.status} ${answer.text.slice(0, 120)}`);
}

/** The lab's cache forgets finished scans, so an address checked before is checked again (lab D1 only). */
async function forget(): Promise<void> {
  const answer = await call(BASE, 'POST', '/lab/forget', 'forget');
  console.log(`cache of the lab forgotten: HTTP ${answer.status} ${answer.text.slice(0, 80)}`);
}

async function stepTracker(): Promise<void> {
  if (values.forget) await forget();
  await setPage(values.variant, TRACKER);
  const startedAt = Date.now();
  const targets: Target[] = [{ label: 'tracker', url: `${TRACKER}/` }];
  if (values.flood) {
    await setPage('flood-net');
    targets.push({ label: 'flood', url: `${PAGES}/` });
  }
  const all = await Promise.all(targets.map((t) => startScan(t)));
  await waitDone(all);
  const facts: Record<string, unknown> = {};
  for (const s of all) {
    const f = await fetchReport(s, s.target.label);
    facts[s.target.label] = f;
    console.log(`${s.target.label}: ${s.final?.['status'] ?? '-'} ${f === null ? 'no report' : `${f.state} valid=${f.valid} pages=${JSON.stringify(f.pages)} failure=${JSON.stringify(f.failure)} services=${JSON.stringify(f.services)}`}`);
  }
  await sleep(1_000);
  const hits = await call(TRACKER, 'GET', `/lab/hits?since=${startedAt}`, 'hits');
  const floodHits = values.flood ? await call(PAGES, 'GET', `/lab/hits?since=${startedAt}`, 'hits') : null;
  const info = await labInfo(new Map(all.map((s) => [s.id, s.target.label])));
  console.log(`tracker hits: ${hits.text}`);
  console.log(JSON.stringify({ metrics: info['metrics'], browsers: (info['browsers'] as unknown[]).slice(-1), history: (info['history'] as unknown[]).slice(0, 1), used: info['usedBrowserTimeSeconds'] }, null, 1));
  await save('summary.json', { run: RUN, flood: values.flood, variant: values.variant, startedAt, scans: all.map((s) => ({ label: s.target.label, id: s.id, startedAt: s.startedAt, doneAt: s.doneAt, status: s.final?.['status'] ?? null, error: s.final?.['error'] ?? null })), facts, hits: hits.json ?? hits.text, floodHits: floodHits?.json ?? null, info });
}

async function stepReader(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const mode of values.modes.split(',').map((m) => m.trim()).filter((m) => m !== '')) {
    await setPage(mode);
    await sleep(3_000);
    const s = await startScan({ label: `reader ${mode}`, url: `${PAGES}/` }, true);
    await waitDone([s], 1_000);
    const f = await fetchReport(s, `reader-${mode}`);
    rows.push({ mode, id: s.id, startedAt: s.startedAt, doneAt: s.doneAt, status: s.final?.['status'] ?? null, error: s.final?.['error'] ?? null, state: f?.state ?? null, pages: f?.pages ?? null, valid: f?.valid ?? null, bytes: f?.bytes ?? null, durationMs: f?.durationMs ?? null });
    console.log(`${mode}: ${s.final?.['status'] ?? '-'} ${f?.state ?? '-'} pages=${JSON.stringify(f?.pages ?? null)} ${Math.round((s.doneAt ?? 0) - s.startedAt)} ms`);
    await sleep(3_000);
  }
  await setPage('small');
  const info = await labInfo(new Map(rows.map((r) => [String(r['id']), String(r['mode'])])));
  console.log(JSON.stringify(info['metrics'], null, 1));
  await save('summary.json', { run: RUN, rows, info });
}

async function stepErrors(): Promise<void> {
  const answer = await call(PAGES, 'GET', '/lab/fetch-errors', 'errors');
  console.log(JSON.stringify(answer.json ?? answer.text, null, 1));
  await save('summary.json', { run: RUN, at: answer.at, status: answer.status, body: answer.json ?? answer.text });
}

/**
 * One CPU round (run right after a deploy of the lab API Worker, so it begins on a fresh instance). The queue runs one
 * scan at a time: the quick check of the slow page runs, the next two wait and are cancelled with their tokens.
 */
async function stepCpu(): Promise<void> {
  // One `--run` per round (cpu-r1, cpu-r2, …), so every label is unique; the last scan of a round is kept for the next.
  const round = values.round;
  const lastFile = resolve('local', 'c1', 'cpu-last.json');
  const last = JSON.parse(await readFile(lastFile, 'utf8').catch(() => 'null')) as { id: string; token: string } | null;
  const log = (a: Answer) => console.log(`${a.label}: HTTP ${a.status} isolate ${a.isolate ?? '-'} #${a.served ?? '-'} ${a.ms} ms ${a.text.length < 200 ? a.text : ''}`);
  if (last !== null) {
    if (values.first === 'cancel') log(await call(BASE, 'POST', `/api/scans/${last.id}/cancel`, `${round}-cancel-first`, { token: last.token }));
    else log(await call(BASE, 'GET', `/api/scans/${last.id}`, `${round}-status-first`));
  }
  // After the first request, so that one is the first of the fresh instance: the full checks of the hosts are forgotten.
  await forget();
  await setPage('slow');
  const running = await startScan({ label: 'slow', url: `${PAGES}/` }, true);
  log(calls.at(-1) as Answer);
  for (let i = 0; i < 10; i += 1) {
    const st = await call(BASE, 'GET', `/api/scans/${running.id}`, `${round}-status`);
    log(st);
    if (st.json?.['status'] === 'running') break;
    await sleep(300);
  }
  for (const target of [{ label: 'tracker', url: `${TRACKER}/` }, { label: 'api', url: `${BASE}/` }]) {
    const queued = await startScan(target, true);
    log(calls.at(-1) as Answer);
    log(await call(BASE, 'GET', `/api/scans/${queued.id}`, `${round}-status`));
    log(await call(BASE, 'POST', `/api/scans/${queued.id}/cancel`, `${round}-cancel`, { token: queued.token }));
    log(await call(BASE, 'GET', `/api/scans/${queued.id}`, `${round}-status`));
  }
  for (let i = 0; i < 30; i += 1) {
    const st = await call(BASE, 'GET', `/api/scans/${running.id}`, `${round}-status`);
    log(st);
    if (st.json?.['status'] === 'done' || st.json?.['status'] === 'error') break;
    await sleep(1_000);
  }
  log(await call(BASE, 'POST', `/api/scans/${running.id}/cancel`, `${round}-cancel-late`, { token: running.token }));
  log(await call(BASE, 'GET', `/api/scans/${running.id}`, `${round}-status`));
  await mkdir(resolve('local', 'c1', RUN), { recursive: true });
  await writeFile(lastFile, JSON.stringify({ id: running.id, token: running.token }));
  await writeFile(resolve('local', 'c1', RUN, 'calls.json'), `${JSON.stringify(calls.map((c) => ({ label: c.label, status: c.status, isolate: c.isolate, served: c.served, at: c.at, ms: c.ms, body: c.json === null ? null : Object.fromEntries(Object.entries(c.json).filter(([k]) => ['status', 'state', 'cached', 'queuePosition', 'error', 'page'].includes(k))) })), null, 2)}\n`);
}

interface Tail {
  eventTimestamp: number | null;
  outcome: string | null;
  cpuTime: number | null;
  wallTime: number | null;
  path: string | null;
  label: string | null;
  executionModel: string | null;
  entrypoint: string | null;
}

async function readTail(file: string): Promise<Tail[]> {
  const text = await readFile(resolve('local', 'c1', file), 'utf8').catch(() => '');
  return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Tail);
}

/** `--step cpu-summary --a tail-api.jsonl`: every API request of the CPU rounds with its tail event, by kind. */
async function stepCpuSummary(): Promise<void> {
  const tail = await readTail(values.a ?? 'tail-api.jsonl');
  const byLabel = new Map(tail.filter((t) => t.label !== null).map((t) => [t.label as string, t]));
  const { readdir } = await import('node:fs/promises');
  const dirs = (await readdir(resolve('local', 'c1'))).filter((d) => /^cpu-r\d+$/.test(d)).sort();
  const rows: { round: string; label: string; kind: string; isolate: string | null; served: number | null; cpu: number | null; outcome: string | null }[] = [];
  for (const dir of dirs) {
    const list = JSON.parse(await readFile(resolve('local', 'c1', dir, 'calls.json'), 'utf8')) as { label: string; isolate: string | null; served: number | null }[];
    for (const c of list) {
      const kind = c.label.replace(/^cpu-r\d+-\d+-/, '').replace(/^r\d+-/, '');
      if (kind === 'mode') continue;
      const t = byLabel.get(c.label);
      rows.push({ round: dir, label: c.label, kind, isolate: c.isolate, served: c.served, cpu: t?.cpuTime ?? null, outcome: t?.outcome ?? null });
    }
  }
  const kinds = [...new Set(rows.map((r) => r.kind))];
  const out: Record<string, unknown> = {};
  for (const kind of kinds) {
    const list = rows.filter((r) => r.kind === kind);
    const cpus = list.map((r) => r.cpu).filter((c): c is number => c !== null);
    out[kind] = { requests: list.length, matched: cpus.length, max: cpus.length > 0 ? Math.max(...cpus) : null, over8: cpus.filter((c) => c > 8).length, values: cpus.sort((x, y) => x - y) };
  }
  const firsts = rows.filter((r) => r.served === 1).map((r) => ({ round: r.round, kind: r.kind, cpu: r.cpu }));
  const outcomes = [...new Set(rows.map((r) => r.outcome))];
  console.log(JSON.stringify({ kinds: out, firstOfFreshInstance: firsts, outcomes, unmatched: rows.filter((r) => r.cpu === null).map((r) => r.label) }, null, 1));
  await writeFile(resolve('local', 'c1', 'cpu-summary.json'), `${JSON.stringify({ rows, kinds: out, firsts }, null, 2)}\n`);
}

/** `--step do-summary --a tail-scan.jsonl --b <run with rows>`: the events of the queue object during each check of a run. */
async function stepDoSummary(): Promise<void> {
  const tail = await readTail(values.a ?? 'tail-scan.jsonl');
  const summary = JSON.parse(await readFile(resolve('local', 'c1', values.b ?? 'reader', 'summary.json'), 'utf8')) as { rows?: { mode: string; startedAt: number; doneAt: number | null }[]; scans?: { label: string; startedAt: number; doneAt: number | null }[] };
  const rows = summary.rows?.map((r) => ({ name: r.mode, startedAt: r.startedAt, doneAt: r.doneAt })) ?? summary.scans?.map((s) => ({ name: s.label, startedAt: s.startedAt, doneAt: s.doneAt })) ?? [];
  const lines: Record<string, unknown>[] = [];
  for (const r of rows) {
    const events = tail.filter((t) => t.eventTimestamp !== null && t.eventTimestamp >= r.startedAt - 1_500 && t.eventTimestamp <= (r.doneAt ?? r.startedAt) + 1_500);
    lines.push({ name: r.name, events: events.map((e) => ({ at: (e.eventTimestamp as number) - r.startedAt, path: e.path, cpu: e.cpuTime, wall: e.wallTime, outcome: e.outcome })) });
  }
  console.log(JSON.stringify(lines, null, 1));
  const maxAll = tail.map((t) => t.cpuTime ?? 0);
  console.log(`events ${tail.length}, outcomes ${JSON.stringify([...new Set(tail.map((t) => t.outcome))])}, max cpu ${Math.max(0, ...maxAll)} ms`);
  await writeFile(resolve('local', 'c1', `do-summary-${values.b ?? 'reader'}.json`), `${JSON.stringify(lines, null, 2)}\n`);
}


/**
 * Session C2, step 5: fix 1 on Cloudflare, invented lab pages only. Three full checks of the lab page, each started
 * as soon as the one before was done (C1's case: the second start 12.5 s after the first), then one browser of the
 * launcher Worker (a launch the queue's mark does not know about) and a fourth check right after it, whose launch
 * Browser Run should refuse by its rule of one new browser every 20 s. With `--race-ms N` the fourth check starts N ms
 * after the launcher was asked, without waiting for its answer. Stops before the launcher when the sessions of the
 * run already hold more than `--max-browser-s` minus 15 s of browser time.
 */
async function stepLaunches(): Promise<void> {
  const runStart = Date.now();
  await setPage('small');
  const url = `${PAGES}/`;
  const all: Started[] = [];
  for (let i = 1; i <= 3; i += 1) {
    await forget();
    const s = await startScan({ label: `check ${i}`, url });
    all.push(s);
    await waitDone([s], 1_000);
    console.log(`check ${i}: ${String(s.final?.['status'] ?? '-')} after ${(((s.doneAt ?? Date.now()) - s.startedAt) / 1000).toFixed(1)} s`);
  }
  const sessionsSince = async (): Promise<{ count: number; seconds: number; open: number }> => {
    const limits = await call(BASE, 'GET', '/lab/limits', 'limits');
    const history = ((limits.json?.['history'] as { startTime?: number; endTime?: number | null }[] | undefined) ?? []).filter((h) => (h.startTime ?? 0) >= runStart - 5_000);
    return { count: history.length, seconds: history.reduce((sum, h) => sum + (h.endTime && h.startTime ? (h.endTime - h.startTime) / 1000 : 0), 0), open: history.filter((h) => !h.endTime).length };
  };
  const before = await sessionsSince();
  console.log(`browser sessions of the run so far: ${before.count}, ${before.seconds.toFixed(2)} s, open ${before.open}`);
  let launch: Answer | null = null;
  if (before.seconds > Number(values['max-browser-s']) - 15) {
    console.log('stop: not enough browser time left for the launcher and a fourth check');
  } else {
    // The queue's mark is the moment the third check's acquire returned (its launch plus the launch time); the launcher
    // comes 24 s after it, so the queue's own 22 s are over and it does not wait for its mark.
    const third = await call(BASE, 'GET', '/lab/stats', 'stats');
    const marks = ((third.json?.['browsers'] as { launchedAt: number; launchMs: number }[] | undefined) ?? []).map((b) => b.launchedAt + b.launchMs);
    const wait = Math.max(0, ...marks) + 24_000 - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 60_000));
    let s4: Started;
    if (values['race-ms'] !== undefined) {
      const pending = call(LAUNCHER, 'POST', '/lab/launch', 'launch');
      await sleep(Number(values['race-ms']));
      s4 = await startScan({ label: 'check 4', url });
      launch = await pending;
    } else {
      launch = await call(LAUNCHER, 'POST', '/lab/launch', 'launch');
      await forget();
      s4 = await startScan({ label: 'check 4', url });
    }
    console.log(`launcher: HTTP ${launch.status} ${launch.text.slice(0, 600)}`);
    all.push(s4);
    await waitDone([s4], 1_000);
    console.log(`check 4: ${String(s4.final?.['status'] ?? '-')} after ${(((s4.doneAt ?? Date.now()) - s4.startedAt) / 1000).toFixed(1)} s`);
  }
  const facts: Record<string, unknown> = {};
  for (const s of all) {
    const f = await fetchReport(s, fileLabelOf(s.target.label));
    facts[s.target.label] = f === null ? null : { state: f.state, mode: f.mode, valid: f.valid, pages: f.pages };
    console.log(`${s.target.label}: ${String(s.final?.['status'] ?? '-')} ${f === null ? 'no report' : `${f.state} ${f.mode} valid=${f.valid} pages=${JSON.stringify(f.pages)}`}`);
  }
  const stats = await call(BASE, 'GET', '/lab/stats', 'stats');
  const q = stats.json as { day?: unknown; browsers?: { launchedAt: number; launchMs: number; openMs: number | null; refusals: string[]; waitedMs: number }[]; launchFailures?: unknown[] } | null;
  const browsers = (q?.browsers ?? []).filter((b) => b.launchedAt >= runStart - 5_000).map((b) => ({ at: b.launchedAt - runStart, launchMs: b.launchMs, openMs: b.openMs, waitedMs: b.waitedMs, refusals: b.refusals }));
  const after = await sessionsSince();
  const limits = await call(BASE, 'GET', '/lab/limits', 'limits');
  console.log(JSON.stringify({ day: q?.day ?? null, browsers, launchFailures: q?.launchFailures ?? [], sessions: after }, null, 1));
  await save('summary.json', { run: RUN, runStart, scans: all.map((s) => ({ label: s.target.label, id: s.id, startStatus: s.startStatus, startedAt: s.startedAt - runStart, doneAt: s.doneAt === null ? null : s.doneAt - runStart, status: s.final?.['status'] ?? null })), facts, launch: launch?.json ?? null, day: q?.day ?? null, browsers, launchFailures: q?.launchFailures ?? [], sessions: after, limits: limits.json });
}
const steps: Record<string, () => Promise<void>> = { sites: stepSites, compare: stepCompare, tracker: stepTracker, reader: stepReader, errors: stepErrors, cpu: stepCpu, 'cpu-summary': stepCpuSummary, 'do-summary': stepDoSummary, launches: stepLaunches };
const run = steps[values.step ?? ''];
if (run === undefined) throw new Error(`--step ${Object.keys(steps).join('|')}`);
await run();
