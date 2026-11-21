import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Capture, CaptureStrategy } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
import { compareCaptures, type CaptureComparison } from './compare-captures.ts';
import { startLabFixture, type LabFixture, type RecordedRequest } from './lab-fixture.ts';
import { captureWithPlaywright, launchLocalBrowser } from './playwright-capture.ts';
import { parseSitesFile } from './sites-file.ts';

/**
 * Driver for the lab endpoint of session A2 (`worker/src/lab/`):
 *
 *   npm run lab:cloudflare -- --base https://website-check-lab.<sub>.workers.dev --only 10,6,4 --trace
 *   npm run lab:cloudflare -- --base http://127.0.0.1:8787 --fixture        (plain wrangler dev)
 *
 * Opens ONE browser session, optionally reads the Cloudflare trace page, captures every site
 * with each strategy (one request per page and strategy, labelled `?label=site-07-b` so the
 * Worker's CPU time can be matched in `wrangler tail`), and closes the session in any case.
 * Then it captures the same sites locally with Playwright and compares. Everything goes to
 * `local/a2/<run>/` (git-ignored); the console shows anonymous labels only. The token is read
 * from `worker/.dev.vars` and never printed.
 */

interface Target {
  label: string;
  number: string;
  url: string;
}

const STRATEGY_CODE: Record<CaptureStrategy, string> = { 'cdp-events': 'a', 'resource-timing': 'b' };

async function readToken(path: string): Promise<string> {
  const text = await readFile(path, 'utf8');
  const match = /^LAB_TOKEN=(.+)$/m.exec(text);
  const token = match?.[1]?.trim().replace(/^"|"$/g, '');
  if (token === undefined || token.length < 32) throw new Error(`LAB_TOKEN missing in ${path}`);
  return token;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      base: { type: 'string' },
      only: { type: 'string' },
      fixture: { type: 'boolean', default: false },
      trace: { type: 'boolean', default: false },
      local: { type: 'boolean', default: true },
      strategies: { type: 'string', default: 'resource-timing,cdp-events' },
      'budget-s': { type: 'string', default: '150' },
      out: { type: 'string' },
      'dev-vars': { type: 'string', default: 'worker/.dev.vars' },
      sites: { type: 'string', default: 'local/sites.txt' },
    },
    allowNegative: true,
  });
  if (values.base === undefined) throw new Error('--base is required');
  const base = values.base.replace(/\/$/, '');
  const token = await readToken(resolve(values['dev-vars']));
  const strategies = values.strategies.split(',').map((s) => s.trim()) as CaptureStrategy[];
  const budgetMs = Number(values['budget-s']) * 1000;
  const runName = values.out ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = resolve('local', 'a2', runName);
  await mkdir(outDir, { recursive: true });

  let fixture: LabFixture | null = null;
  let targets: Target[];
  if (values.fixture) {
    // Fixed port, so `worker/.dev.vars` can point LAB_TRACE_URL at http://127.0.0.1:8790/cdn-cgi/trace.
    fixture = await startLabFixture(8790);
    targets = [
      { label: 'Fixture', number: 'fx', url: fixture.startUrl },
      { label: 'Fixture 300 images', number: 'fm', url: fixture.manyUrl },
    ];
  } else {
    if (values.only === undefined) throw new Error('--only is required for real sites');
    const { sites, errors } = parseSitesFile(await readFile(resolve(values.sites), 'utf8'));
    if (errors.length > 0) throw new Error(errors.join('\n'));
    const wanted = values.only.split(',').map((n) => n.trim().padStart(2, '0'));
    targets = wanted.map((n) => {
      const site = sites.find((s) => s.number === n);
      if (site === undefined) throw new Error(`no site ${n}`);
      return { label: site.label, number: site.number, url: site.url };
    });
  }

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; json: unknown; clientMs: number }> => {
    const started = Date.now();
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'website-check-lab-client/0.1' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let json: unknown = text.slice(0, 500);
    try {
      json = JSON.parse(text);
    } catch {
      // keep the text
    }
    return { status: response.status, json, clientMs: Date.now() - started };
  };
  const save = (name: string, data: unknown): Promise<void> => writeFile(resolve(outDir, name), `${JSON.stringify(data, null, 2)}\n`);

  const limits = await call('GET', '/lab/limits');
  await save('limits-before.json', limits);
  console.log(`limits: HTTP ${limits.status} ${JSON.stringify(limits.json).slice(0, 300)}`);
  if (limits.status !== 200) throw new Error('lab endpoint not ready');

  const cloud = new Map<string, Capture>();
  const headerLog: Record<string, RecordedRequest[]> = {};
  const opened = await call('POST', '/lab/session?label=open');
  await save('session-open.json', opened);
  const openedAt = Date.now();
  const sessionId = (opened.json as { sessionId?: string }).sessionId;
  if (opened.status !== 200 || sessionId === undefined) throw new Error(`open failed: HTTP ${opened.status} ${JSON.stringify(opened.json)}`);
  console.log(`session open: ${(opened.json as { browserVersion?: string }).browserVersion}, ${opened.clientMs} ms`);
  try {
    if (values.trace) {
      const trace = await call('POST', '/lab/trace?label=trace', { sessionId });
      await save('trace.json', trace);
      const t = trace.json as { loc?: string; colo?: string; environment?: unknown };
      console.log(`trace: HTTP ${trace.status} loc=${t.loc} colo=${t.colo} env=${JSON.stringify(t.environment)}`);
    }
    for (const target of targets) {
      for (const strategy of strategies) {
        const code = STRATEGY_CODE[strategy];
        if (Date.now() - openedAt > budgetMs) {
          console.log(`${target.label} (${code}): skipped, browser budget of ${budgetMs / 1000} s reached`);
          continue;
        }
        const before = fixture?.recorded.length ?? 0;
        const result = await call('POST', `/lab/capture?label=site-${target.number}-${code}`, { sessionId, url: target.url, strategy });
        await save(`cloud-site-${target.number}-${code}.json`, result);
        if (fixture !== null) headerLog[`cloud-${code}-${target.number}`] = fixture.recorded.slice(before);
        const body = result.json as { capture?: Capture; stats?: unknown; workerWallMs?: number; error?: string; message?: string };
        if (result.status === 200 && body.capture !== undefined) {
          cloud.set(`${target.number}-${code}`, body.capture);
          const c = body.capture;
          console.log(
            `${target.label} (${code}): ${c.ok ? 'ok' : `FAILED ${c.failure?.reason}`} ${c.requests.length} requests, ` +
              `banner ${c.consentBanner.detected ? `${c.consentBanner.toolId} at ${c.consentBanner.visibleAtMs} ms` : 'not seen'}, ` +
              `stop ${c.timings.stopReason} at ${c.timings.endMs} ms, worker wall ${body.workerWallMs} ms, stats ${JSON.stringify(body.stats)}`,
          );
        } else {
          console.log(`${target.label} (${code}): HTTP ${result.status} ${body.error ?? ''} ${body.message ?? ''}`);
        }
      }
    }
  } finally {
    const closed = await call('POST', '/lab/close?label=close', { sessionId });
    const closedAt = Date.now();
    await save('session-close.json', { ...closed, openedAt, closedAt, clientSessionMs: closedAt - openedAt });
    console.log(`session closed: HTTP ${closed.status} ${JSON.stringify(closed.json)}, open for about ${Math.round((closedAt - openedAt) / 1000)} s (client clock)`);
    // Cloudflare reports the day's browser time in the limits (usedBrowserTimeSeconds).
    const after = await call('GET', '/lab/limits?label=limits-after').catch((error: unknown) => ({ status: 0, json: String(error), clientMs: 0 }));
    await save('limits-after.json', after);
    console.log(`limits after: ${JSON.stringify(after.json).slice(0, 300)}`);
  }

  if (!values.local) {
    await fixture?.close();
    return;
  }
  const browser = await launchLocalBrowser();
  const comparisons: Record<string, CaptureComparison> = {};
  try {
    for (const target of targets) {
      const before = fixture?.recorded.length ?? 0;
      const { capture: local } = await captureWithPlaywright(browser, target.url);
      if (fixture !== null) headerLog[`local-${target.number}`] = fixture.recorded.slice(before);
      await save(`local-site-${target.number}.json`, local);
      for (const strategy of strategies) {
        const code = STRATEGY_CODE[strategy];
        const remote = cloud.get(`${target.number}-${code}`);
        if (remote === undefined) continue;
        const comparison = compareCaptures(local, remote, DEFAULT_RULES);
        comparisons[`site-${target.number}-${code}`] = comparison;
        console.log(
          `${target.label} (${code}) vs local: banner local ${comparison.local.banner.toolId ?? 'none'} / cloud ${comparison.cloud.banner.toolId ?? 'none'}; ` +
            `requests ${comparison.local.requests} / ${comparison.cloud.requests} (completeness ${comparison.completenessPct} %); ` +
            `third-party hosts only cloud ${comparison.thirdPartyHosts.onlyCloud.length}, only local ${comparison.thirdPartyHosts.onlyLocal.length}; ` +
            `findings only cloud ${comparison.findings.onlyCloud.length}, only local ${comparison.findings.onlyLocal.length}` +
            (comparison.needsReview ? '  -> review' : ''),
        );
      }
    }
  } finally {
    await browser.close();
  }
  await save('compare.json', comparisons);
  if (fixture !== null) {
    await save('fixture-headers.json', headerLog);
    for (const [who, list] of Object.entries(headerLog)) {
      const summary = new Set(list.map((r) => `${r.host}${r.path.startsWith('/pixel') ? '/pixel*' : r.path} lang=${r.acceptLanguage} platform=${r.chUaPlatform} ua=${/Headless/.test(r.userAgent ?? '') ? 'HEADLESS' : (r.userAgent ?? '').slice(0, 40)}`));
      console.log(`headers ${who}:\n  ${[...summary].join('\n  ')}`);
    }
    await fixture.close();
  }
}

await main();
