import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Capture, CaptureStrategy } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
import { compareCaptures, type CaptureComparison } from './compare-captures.ts';
import { AXE_RULES } from '../a11y/types.ts';
import { a11yFixtureExpectations, startLabFixture, type LabFixture, type RecordedRequest } from './lab-fixture.ts';
import { createLocalGuard } from './node-resolver.ts';
import { captureWithPlaywright, launchLocalBrowser } from './playwright-capture.ts';
import { parseSitesFile } from './sites-file.ts';

/**
 * Driver for the lab endpoint of session A2 (`worker/src/lab/`):
 *
 *   npm run lab:cloudflare -- --base https://website-check-lab.<sub>.workers.dev --only 10,6,4 --trace
 *   npm run lab:cloudflare -- --base http://127.0.0.1:8787 --fixture        (plain wrangler dev)
 *   npm run lab:cloudflare -- --base https://... --cpu-steps 1100000000      (CPU experiment, no browser)
 *   npm run lab:cloudflare -- --base https://... --only 10,4,14,6 --trace --compare-with local/a2/cf-run-1,local/a2/cf-run-2
 *
 * Opens ONE browser session, optionally reads the Cloudflare trace page, captures every site
 * with each strategy (one request per page and strategy, labelled `?label=site-07-b` so the
 * Worker's CPU time can be matched in `wrangler tail`), and closes the session in any case.
 * Then it captures the same sites locally with Playwright and compares. With `--compare-with` it
 * also compares every new capture with the capture of the same site and strategy saved by an
 * earlier run (A2 part 2 against part 1). Everything goes to
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
      // Browser seconds for the whole step (all runs of the day): Cloudflare's usedBrowserTimeSeconds counts.
      'budget-s': { type: 'string', default: '180' },
      // Browser seconds for this run alone (client clock from before the launch), whatever the day budget says.
      'run-budget-s': { type: 'string', default: '120' },
      out: { type: 'string' },
      // Folder under local/ for the run (A2: a2, A3: a3).
      root: { type: 'string', default: 'a2' },
      'dev-vars': { type: 'string', default: 'worker/.dev.vars' },
      sites: { type: 'string', default: 'local/sites.txt' },
      'cpu-steps': { type: 'string' },
      'compare-with': { type: 'string' },
    },
    allowNegative: true,
  });
  if (values.base === undefined) throw new Error('--base is required');
  const base = values.base.replace(/\/$/, '');
  const baseUrl = new URL(base);
  if (baseUrl.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(baseUrl.hostname)) throw new Error('--base must be https (or a local wrangler dev address)');
  const token = await readToken(resolve(values['dev-vars']));
  const strategies = values.strategies.split(',').map((s) => s.trim()) as CaptureStrategy[];
  const budgetS = Number(values['budget-s']);
  if (!Number.isFinite(budgetS) || budgetS <= 0) throw new Error('--budget-s must be a positive number of seconds');
  const runBudgetS = Number(values['run-budget-s']);
  if (!Number.isFinite(runBudgetS) || runBudgetS <= 0) throw new Error('--run-budget-s must be a positive number of seconds');
  /**
   * Worst case for one more page: the hard limit of 20 s plus setup and closing. Trace and capture
   * requests are cut off by the client after this time too, so the guard's worst case is the real one.
   */
  const NEXT_PAGE_MS = 30_000;
  const runName = values.out ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const outDir = resolve('local', values.root, runName);
  await mkdir(outDir, { recursive: true });

  let fixture: LabFixture | null = null;
  let targets: Target[];
  if (values.fixture) {
    // Fixed port, so `worker/.dev.vars` can point LAB_TRACE_URL at http://127.0.0.1:8790/cdn-cgi/trace.
    fixture = await startLabFixture(8790);
    targets = [
      { label: 'Fixture', number: 'fx', url: fixture.startUrl },
      { label: 'Fixture 300 images', number: 'fm', url: fixture.manyUrl },
      // A3: the accessibility fixture pages, compared with their expected counts below.
      ...Object.entries(fixture.a11yUrls).map(([name, url]) => ({ label: `Fixture ${name}`, number: `a11y-${name.replace(/\.html$/, '')}`, url })),
    ];
  } else if (values['cpu-steps'] !== undefined) {
    targets = [];
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

  // Every label starts with the run name, so tail records of different runs in one stream never mix.
  const labelled = (path: string, label: string): string => `${path}?label=${encodeURIComponent(`${runName}.${label}`)}`;
  const call = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 45_000,
  ): Promise<{ status: number; json: unknown; clientMs: number; startedAt: string }> => {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
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
    return { status: response.status, json, clientMs: Date.now() - started, startedAt };
  };
  /** Console text without addresses: error messages of the browser can end with " at <url>". */
  const redact = (text: string | undefined): string => (text ?? '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 120);
  const save = (name: string, data: unknown): Promise<void> => writeFile(resolve(outDir, name), `${JSON.stringify(data, null, 2)}\n`);

  if (values['cpu-steps'] !== undefined) {
    // CPU experiment of A2 part 2: no browser; the CPU time comes from wrangler tail (label cpu-<steps>).
    const steps = Number(values['cpu-steps']);
    const result = await call('POST', labelled('/lab/cpu', `cpu-${steps}`), { steps });
    await save(`cpu-${steps}.json`, result);
    console.log(`cpu ${steps} steps: HTTP ${result.status} ${JSON.stringify(result.json)} in ${result.clientMs} ms (client clock)`);
    return;
  }

  const limits = await call('GET', labelled('/lab/limits', 'limits-before'));
  await save('limits-before.json', limits);
  console.log(`limits: HTTP ${limits.status} ${JSON.stringify(limits.json).slice(0, 300)}`);
  if (limits.status !== 200) throw new Error('lab endpoint not ready');
  // Local wrangler dev reports no usage; on Cloudflare this is today's browser time of the account.
  const usedBefore = (limits.json as { limits?: { usedBrowserTimeSeconds?: number } }).limits?.usedBrowserTimeSeconds ?? 0;
  const remainingMs = Math.min((budgetS - usedBefore) * 1000, runBudgetS * 1000);
  console.log(`browser budget: ${budgetS} s for the day, ${usedBefore} s already used today, at most ${runBudgetS} s for this run: ${Math.round(remainingMs / 1000)} s`);
  if (remainingMs < NEXT_PAGE_MS + 10_000) throw new Error('browser budget for this step is used up; not opening a session');

  const cloud = new Map<string, Capture>();
  const headerLog: Record<string, RecordedRequest[]> = {};
  // The clock starts before the launch, so the launch itself counts against the budget.
  const clockStart = Date.now();
  const opened = await call('POST', labelled('/lab/session', 'open'), undefined, NEXT_PAGE_MS);
  await save('session-open.json', opened);
  const openedAt = Date.now();
  const fits = (): boolean => Date.now() - clockStart + NEXT_PAGE_MS <= remainingMs;
  const sessionId = (opened.json as { sessionId?: string }).sessionId;
  if (opened.status !== 200 || sessionId === undefined) throw new Error(`open failed: HTTP ${opened.status} ${JSON.stringify(opened.json)}`);
  console.log(`session open: ${(opened.json as { browserVersion?: string }).browserVersion}, ${opened.clientMs} ms`);
  try {
    if (values.trace && fits()) {
      const trace = await call('POST', labelled('/lab/trace', 'trace'), { sessionId }, NEXT_PAGE_MS);
      await save('trace.json', trace);
      const t = trace.json as { loc?: string; colo?: string; environment?: unknown; object?: unknown };
      console.log(`trace: HTTP ${trace.status} browser loc=${t.loc} colo=${t.colo}; object ${JSON.stringify(t.object)}; env=${JSON.stringify(t.environment)}`);
    }
    for (const target of targets) {
      for (const strategy of strategies) {
        const code = STRATEGY_CODE[strategy];
        if (!fits()) {
          console.log(`${target.label} (${code}): skipped, the next page might not fit into the browser budget`);
          continue;
        }
        const before = fixture?.recorded.length ?? 0;
        const result = await call('POST', labelled('/lab/capture', `site-${target.number}-${code}`), { sessionId, url: target.url, strategy }, NEXT_PAGE_MS).catch(
          (error: unknown) => ({ status: 0, json: { error: 'client', message: error instanceof Error ? error.message : String(error) }, clientMs: NEXT_PAGE_MS, startedAt: '' }),
        );
        await save(`cloud-site-${target.number}-${code}.json`, result);
        if (fixture !== null) headerLog[`cloud-${code}-${target.number}`] = fixture.recorded.slice(before);
        const body = result.json as { capture?: Capture; stats?: unknown; doWallMs?: number; reconnected?: boolean; error?: string; message?: string };
        if (result.status === 200 && body.capture !== undefined) {
          cloud.set(`${target.number}-${code}`, body.capture);
          const c = body.capture;
          const axe = c.axe ?? null;
          console.log(
            `${target.label} (${code}): axe ${axe?.status ?? 'none'} ${axe?.status === 'ok' ? AXE_RULES.map((id) => `${id} ${axe.rules[id]?.violations}`).join(' ') : (axe?.error ?? '')}, ` +
              `axe time ${axe?.timing.totalMs ?? 0} ms (inject ${axe?.timing.injectMs ?? '-'}, run ${axe?.timing.runMs ?? '-'}); redirect check ${c.httpProbe?.outcome ?? 'none'} in ${c.httpProbe?.durationMs ?? '-'} ms`,
          );
          const expected = target.number.startsWith('a11y-') ? a11yFixtureExpectations()[`${target.number.slice(5)}.html`] : undefined;
          if (expected !== undefined) {
            const wrong = AXE_RULES.filter((id) => axe?.rules[id]?.violations !== expected.violations[id] || axe?.rules[id]?.incomplete !== (expected.incomplete[id] ?? 0));
            console.log(`  fixture ${wrong.length === 0 ? 'MATCHES expected.json' : `DIFFERS on ${wrong.join(', ')}`}`);
          }
          console.log(
            `${target.label} (${code}): ${c.ok ? 'ok' : `FAILED ${c.failure?.reason} (HTTP ${c.failure?.status ?? '-'})`} ${c.requests.length} requests, ` +
              `banner ${c.consentBanner.detected ? `${c.consentBanner.toolId} at ${c.consentBanner.visibleAtMs} ms` : 'not seen'}, ` +
              `stop ${c.timings.stopReason} at ${c.timings.endMs} ms, object wall ${body.doWallMs} ms, reconnected ${body.reconnected}, stats ${JSON.stringify(body.stats)}`,
          );
        } else {
          console.log(`${target.label} (${code}): HTTP ${result.status} ${body.error ?? ''} ${redact(body.message)}`);
        }
      }
    }
  } finally {
    // The close is retried: a browser left open keeps using the day's minutes until its idle timeout.
    let closed: { status: number; json: unknown; clientMs: number; startedAt: string } = { status: 0, json: null, clientMs: 0, startedAt: '' };
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        closed = await call('POST', labelled('/lab/close', `close-${attempt}`), { sessionId }, 20_000);
        if (closed.status === 200) break;
      } catch (error) {
        closed = { status: 0, json: { error: 'client', message: error instanceof Error ? error.message : String(error) }, clientMs: 0, startedAt: '' };
      }
    }
    const closedAt = Date.now();
    await save('session-close.json', { ...closed, openedAt, closedAt, clientSessionMs: closedAt - openedAt });
    console.log(`session closed: HTTP ${closed.status} ${JSON.stringify(closed.json)}, open for about ${Math.round((closedAt - openedAt) / 1000)} s (client clock)`);
    // Cloudflare reports the day's browser time in the limits (usedBrowserTimeSeconds).
    const after = await call('GET', labelled('/lab/limits', 'limits-after')).catch((error: unknown) => ({ status: 0, json: String(error), clientMs: 0, startedAt: '' }));
    await save('limits-after.json', after);
    console.log(`limits after: ${JSON.stringify(after.json).slice(0, 300)}`);
  }

  if (values['compare-with'] !== undefined) {
    const earlier: Record<string, CaptureComparison> = {};
    const dirs = values['compare-with'].split(',').map((d) => resolve(d.trim()));
    for (const [key, capture] of cloud) {
      let before: Capture | null = null;
      for (const dir of dirs) {
        const text = await readFile(resolve(dir, `cloud-site-${key}.json`), 'utf8').catch(() => null);
        const saved = text === null ? undefined : (JSON.parse(text) as { json?: { capture?: Capture } }).json?.capture;
        if (saved !== undefined) {
          before = saved;
          break;
        }
      }
      if (before === null) {
        console.log(`site-${key}: no earlier capture to compare with`);
        continue;
      }
      const comparison = compareCaptures(before, capture, DEFAULT_RULES);
      earlier[`site-${key}`] = comparison;
      console.log(
        `site-${key} now vs earlier run: ok ${comparison.local.ok} -> ${comparison.cloud.ok}; banner ${comparison.local.banner.toolId ?? 'none'} -> ${comparison.cloud.banner.toolId ?? 'none'}; ` +
          `requests ${comparison.local.requests} -> ${comparison.cloud.requests}; third-party hosts only now ${comparison.thirdPartyHosts.onlyCloud.length}, only earlier ${comparison.thirdPartyHosts.onlyLocal.length}; ` +
          `findings only now ${comparison.findings.onlyCloud.length}, only earlier ${comparison.findings.onlyLocal.length}`,
      );
    }
    await save('compare-earlier.json', earlier);
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
      // A5: in fixture mode only the fixture site's own origin is exempt from the SSRF guard (as in `npm run lab:dev`).
      const guard = fixture !== null ? createLocalGuard({ exempt: (url) => url.origin === `http://127.0.0.1:${fixture?.port}` }) : undefined;
      const { capture: local } = await captureWithPlaywright(browser, target.url, guard !== undefined ? { guard } : {});
      if (fixture !== null) headerLog[`local-${target.number}`] = fixture.recorded.slice(before);
      await save(`local-site-${target.number}.json`, local);
      for (const strategy of strategies) {
        const code = STRATEGY_CODE[strategy];
        const remote = cloud.get(`${target.number}-${code}`);
        if (remote === undefined) continue;
        const comparison = compareCaptures(local, remote, DEFAULT_RULES);
        comparisons[`site-${target.number}-${code}`] = comparison;
        // Different page loads, so differences can come from carousels or banners; for information only.
        if (local.axe?.status === 'ok' && remote.axe?.status === 'ok') {
          console.log(`${target.label} (${code}) axe local / cloud: ${AXE_RULES.map((id) => `${id} ${local.axe?.rules[id]?.violations}/${remote.axe?.rules[id]?.violations}`).join(', ')}`);
        }
        console.log(
          `${target.label} (${code}) vs local: banner local ${comparison.local.banner.toolId ?? 'none'} / cloud ${comparison.cloud.banner.toolId ?? 'none'}; ` +
            `requests ${comparison.local.requests} / ${comparison.cloud.requests} without ${comparison.cloud.preflights} CORS preflights (completeness ${comparison.completenessPct} %, only cloud ${comparison.onlyCloudRequests}); ` +
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
      const frameEnv = list.find((r) => r.path === '/frame-env');
      if (frameEnv !== undefined) console.log(`  inside the cross-site iframe: ${decodeURIComponent(frameEnv.query)}`);
    }
    await fixture.close();
  }
}

await main();
