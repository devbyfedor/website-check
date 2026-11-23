import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { REPORT_SCHEMA_V1, validateReport } from '../report/validate.ts';
import { parseSitesFile } from './sites-file.ts';

/**
 * Driver of the end-to-end check of session A5 part 3 against the lab Worker (`worker/src/lab/e2e.ts`):
 *
 *   npm run lab:e2e -- --base https://website-check-lab.<sub>.workers.dev --only 10,14,26 --fixture --quick-fixture
 *   npm run lab:e2e -- --base http://127.0.0.1:8787 --fixture --quick-fixture        (plain wrangler dev, local Chrome)
 *
 * Goes through the real API: `--quick-fixture` first starts the lab's fixture homepage as a quick check
 * (`x-lab-force: quick`, no browser); then it starts the sites and the fixture as full checks in a row, so
 * the queue runs them in one browser session; it polls the status (and the place in the queue) until every
 * scan is done, fetches every report, validates it with our validator and with Ajv against the schema, and
 * reads the queue's measurements, the fixture's hit counts and Browser Run's limits and session history.
 * Everything goes to `local/a5/<run>/` (git-ignored); the console shows anonymous labels only. The token is
 * read from `worker/.dev.vars` and never printed.
 */

interface Target {
  label: string;
  url: string;
}

interface Started {
  target: Target;
  id: string;
  status: number;
  firstPosition: number | null;
  positions: number[];
  final: Record<string, unknown> | null;
}

async function readToken(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  const token = /^LAB_TOKEN=(.+)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '');
  if (token === undefined || token.length < 32) throw new Error(`LAB_TOKEN missing in ${path}`);
  return token;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      only: { type: 'string' },
      fixture: { type: 'boolean', default: false },
      // Local wrangler dev only: the fixture once more under localhost, a second site for parallel scans.
      'fixture-localhost': { type: 'boolean', default: false },
      'quick-fixture': { type: 'boolean', default: false },
      sites: { type: 'string', default: 'local/sites.txt' },
      'dev-vars': { type: 'string', default: 'worker/.dev.vars' },
      out: { type: 'string' },
      'timeout-s': { type: 'string', default: '360' },
    },
  });
  if (values.base === undefined) throw new Error('--base is required');
  const base = values.base.replace(/\/$/, '');
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)) throw new Error('--base must be https (or local wrangler dev)');
  const token = await readToken(resolve(values['dev-vars']));
  const runName = values.out ?? `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = resolve('local', 'a5', runName);
  await mkdir(resolve(outDir, 'reports'), { recursive: true });
  const save = (name: string, data: unknown) => writeFile(resolve(outDir, name), `${JSON.stringify(data, null, 2)}\n`);

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; json: unknown; text: string }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  };

  const targets: Target[] = [];
  if (values.only !== undefined) {
    const { sites, errors } = parseSitesFile(await readFile(resolve(values.sites), 'utf8'));
    if (errors.length > 0) throw new Error(errors.join('\n'));
    for (const n of values.only.split(',').map((s) => s.trim().padStart(2, '0'))) {
      const site = sites.find((s) => s.number === n);
      if (site === undefined) throw new Error(`no site ${n}`);
      targets.push({ label: site.label, url: site.url });
    }
  }
  if (values.fixture) targets.push({ label: 'Fixture', url: `${base}/` });
  if (values['fixture-localhost'] && baseUrl.hostname === '127.0.0.1') targets.push({ label: 'Fixture localhost', url: `${base.replace('127.0.0.1', 'localhost')}/` });

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const ajvValidate = ajv.compile(REPORT_SCHEMA_V1 as object);

  const runStartedAt = Date.now();
  const limitsBefore = await call('GET', '/lab/limits');
  await save('limits-before.json', limitsBefore.json);
  console.log(`limits before: HTTP ${limitsBefore.status}, used browser time ${JSON.stringify((limitsBefore.json as { limits?: { usedBrowserTimeSeconds?: unknown } } | null)?.limits?.usedBrowserTimeSeconds ?? null)} s`);

  const waitFor = async (started: Started[], timeoutMs: number): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let open = 0;
      for (const s of started) {
        if (s.final !== null || s.id === '') continue;
        const status = await call('GET', `/api/scans/${s.id}`);
        const body = status.json as Record<string, unknown> | null;
        if (body === null) continue;
        if (typeof body['queuePosition'] === 'number') s.positions.push(body['queuePosition'] as number);
        if (body['status'] === 'done' || body['status'] === 'error') s.final = body;
        else open += 1;
      }
      if (open === 0) return;
      await sleep(2_000);
    }
    console.log('timeout: not every scan finished');
  };

  const start = async (target: Target, extra: Record<string, string> = {}): Promise<Started> => {
    const response = await call('POST', '/api/scans', { url: target.url }, extra);
    const body = response.json as Record<string, unknown> | null;
    const id = typeof body?.['id'] === 'string' ? body['id'] : '';
    const s: Started = { target, id, status: response.status, firstPosition: typeof body?.['queuePosition'] === 'number' ? (body['queuePosition'] as number) : null, positions: [], final: null };
    console.log(`${target.label}: start HTTP ${response.status}${body?.['cached'] === true ? ' (cached)' : ''}, place in the queue ${s.firstPosition ?? '-'}${id === '' ? `, ${response.text.slice(0, 120)}` : ''}`);
    return s;
  };

  const all: Started[] = [];
  if (values['quick-fixture']) {
    const quick = await start({ label: 'Fixture (quick)', url: `${base}/` }, { 'x-lab-force': 'quick' });
    all.push(quick);
    await waitFor([quick], 60_000);
  }
  const full: Started[] = [];
  for (const target of targets) full.push(await start(target));
  all.push(...full);
  await waitFor(full, Number(values['timeout-s']) * 1000);

  const summary: Record<string, unknown>[] = [];
  for (const s of all) {
    const fileLabel = s.target.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const report = s.id === '' ? null : await call('GET', `/api/scans/${s.id}/report`);
    let valid: boolean | null = null;
    let ajvValid: boolean | null = null;
    let reportSummary: Record<string, unknown> = {};
    if (report !== null && report.status === 200 && report.json !== null) {
      valid = validateReport(report.json).length === 0;
      ajvValid = ajvValidate(report.json) === true;
      const r = report.json as { state: string; scan: { mode: string; durationMs: number | null }; visit: { country: string | null; colo: string | null }; findings: unknown[]; services: unknown[]; pages: unknown; counts: unknown; notice: unknown };
      reportSummary = { state: r.state, mode: r.scan.mode, durationMs: r.scan.durationMs, country: r.visit.country, colo: r.visit.colo, findings: r.findings.length, services: r.services.length, pages: r.pages, counts: r.counts, notice: r.notice, bytes: report.text.length };
      await writeFile(resolve(outDir, 'reports', `${fileLabel}.json`), `${JSON.stringify(report.json, null, 2)}\n`);
    }
    const line = { label: s.target.label, startStatus: s.status, firstPosition: s.firstPosition, maxPosition: s.positions.length > 0 ? Math.max(...s.positions) : null, status: s.final?.['status'] ?? null, reportStatus: report?.status ?? null, valid, ajvValid, ...reportSummary };
    summary.push(line);
    console.log(JSON.stringify(line));
  }

  const stats = await call('GET', '/lab/stats');
  await save('queue-stats.json', stats.json);
  const hits = await call('GET', `/lab/hits?since=${runStartedAt}`);
  await save('hits.json', hits.json);
  console.log(`fixture hits: ${JSON.stringify(hits.json)}`);
  let limitsAfter = await call('GET', '/lab/limits');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const history = (limitsAfter.json as { history?: { endTime?: number | null }[] } | null)?.history ?? [];
    if (history.length > 0 && history[0]?.endTime !== null && history[0]?.endTime !== undefined) break;
    await sleep(2_000);
    limitsAfter = await call('GET', '/lab/limits');
  }
  await save('limits-after.json', limitsAfter.json);
  // Measurements of the queue per job, with anonymous labels instead of the scan ids.
  const labelOf = new Map(all.map((s) => [s.id, s.target.label]));
  const q = stats.json as { metrics?: Record<string, unknown>[]; browsers?: unknown[]; day?: unknown } | null;
  for (const m of q?.metrics ?? []) console.log(JSON.stringify({ ...m, id: labelOf.get(String(m['id'])) ?? 'other' }));
  console.log(`browsers: ${JSON.stringify(q?.browsers ?? [])}`);
  console.log(`day: ${JSON.stringify(q?.day ?? null)}`);
  const history = (limitsAfter.json as { history?: { startTime?: number; endTime?: number | null; closeReasonText?: string }[] } | null)?.history ?? [];
  console.log(`browser sessions (Cloudflare history, newest first): ${JSON.stringify(history.slice(0, 3).map((h) => ({ seconds: h.endTime && h.startTime ? (h.endTime - h.startTime) / 1000 : null, close: h.closeReasonText ?? null })))}`);
  console.log(`limits after: used browser time ${JSON.stringify((limitsAfter.json as { limits?: { usedBrowserTimeSeconds?: unknown } } | null)?.limits?.usedBrowserTimeSeconds ?? null)} s`);
  await save('summary.json', { runName, summary, labels: Object.fromEntries(labelOf) });
  console.log(`saved to local/a5/${runName}/`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
