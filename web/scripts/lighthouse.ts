// Lighthouse on every page of the production build (session B5 part 2, the quality gate of the brief): desktop at
// 1440 × 900 (the desktop preset of Lighthouse: its throttling, no mobile emulation) and mobile at 390 × 844 (the mobile
// preset: slow 4G and a CPU four times slower, simulated), three runs each, the median counts. Pages: the home page, the
// BFSG page, the scan screen of a finished scan and the report page with two reports (the example report and the cut
// list of 80 services), answered by a mocked API; the production build of web/ with the headers of web/out/_headers
// (the CSP), served on this computer; the local Chromium of Playwright. Required by the brief: desktop Accessibility
// 100, Best Practices at least 95, Performance at least 95; mobile Performance at least 85. Also counted: errors in the
// console and issues of the Content Security Policy that Lighthouse saw. Results in local/lighthouse.
//
//   npm run lighthouse                 builds web/ first
//   node web/scripts/lighthouse.ts --no-build [--runs 3] [--only home,bfsg]
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import * as constants from 'lighthouse/core/config/constants.js';
import { chromium } from 'playwright';
import type { Report } from '../../scanner/src/report/types.ts';
import { EXAMPLE_REPORT_STATES } from '../components/report/example-report-states.ts';
import { OUT_DIR, ROOT } from './browser-setup.ts';
import { startStaticServer } from './static-server.ts';

const RESULT_DIR = join(ROOT, 'local', 'lighthouse');
const args = process.argv.slice(2);
const RUNS = args.includes('--runs') ? Number(args[args.indexOf('--runs') + 1]) : 3;
const only = args.includes('--only') ? (args[args.indexOf('--only') + 1] ?? '').split(',') : null;

const ID_EXAMPLE = 'lighthouseberichtbeispielaa';
const ID_CUT = 'lighthouseberichtgekuerztaa';

if (!args.includes('--no-build')) {
  const build = spawnSync('npm run build:web', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(1);
}

const example = JSON.parse(await readFile(join(ROOT, 'web', 'components', 'report', 'example-report.json'), 'utf8')) as Report;
const cutShown = EXAMPLE_REPORT_STATES.find((s) => s.slug === 'gekuerzt')?.show();
if (cutShown === undefined || !('report' in cutShown)) throw new Error('no example state gekuerzt');
const REPORTS: Record<string, Report> = { [ID_EXAMPLE]: { ...example, id: ID_EXAMPLE }, [ID_CUT]: { ...cutShown.report, id: ID_CUT } };
const scanBody = (id: string) => ({
  id,
  status: 'done',
  state: null,
  cached: false,
  displayHost: REPORTS[id]!.site.displayHost,
  queuePosition: null,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  country: 'DE',
  errorReason: null,
  statusUrl: `/api/scans/${id}`,
  reportUrl: `/api/scans/${id}/report`,
});
function api(path: string): { status: number; body: string } | null {
  const m = /^\/api\/scans\/([a-z0-9]+)(\/report)?$/.exec(path);
  if (m === null || REPORTS[m[1]!] === undefined) return null;
  return { status: 200, body: JSON.stringify(m[2] === undefined ? scanBody(m[1]!) : REPORTS[m[1]!]) };
}

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'bfsg', path: '/bfsg' },
  { name: 'pruefung', path: `/pruefung?id=${ID_EXAMPLE}` },
  { name: 'bericht', path: `/bericht?id=${ID_EXAMPLE}` },
  { name: 'bericht-gekuerzt', path: `/bericht?id=${ID_CUT}` },
].filter((p) => only === null || only.includes(p.name));

const FORMS = {
  desktop: {
    extends: 'lighthouse:default',
    settings: {
      formFactor: 'desktop',
      throttling: constants.throttling.desktopDense4G,
      screenEmulation: { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false },
      emulatedUserAgent: constants.userAgents.desktop,
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
    },
  },
  mobile: {
    extends: 'lighthouse:default',
    settings: {
      formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1.75, disabled: false },
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
    },
  },
} as const;
const NEEDS: Record<keyof typeof FORMS, Partial<Record<string, number>>> = {
  desktop: { performance: 95, accessibility: 100, 'best-practices': 95 },
  mobile: { performance: 85 },
};

const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;

const server = await startStaticServer([{ prefix: '/', dir: OUT_DIR }], { notFoundFile: join(OUT_DIR, '404.html'), api });
const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-extensions'] });
await mkdir(RESULT_DIR, { recursive: true });
const summary: Record<string, unknown> = { lighthouse: '13.6.0', chromium: '', runs: RUNS, pages: {} };
const problems: string[] = [];
try {
  for (const page of PAGES) {
    for (const [form, config] of Object.entries(FORMS) as [keyof typeof FORMS, (typeof FORMS)[keyof typeof FORMS]][]) {
      const scores: Record<string, number[]> = { performance: [], accessibility: [], 'best-practices': [] };
      const consoleErrors: string[] = [];
      const cspIssues: string[] = [];
      const failedAudits = new Set<string>();
      for (let run = 0; run < RUNS; run++) {
        const result = await lighthouse(`${server.origin}${page.path}`, { port: chrome.port, output: 'json', logLevel: 'error' }, config as never);
        const lhr = result?.lhr;
        if (lhr === undefined) throw new Error(`${page.name} ${form}: no result`);
        summary.chromium = lhr.environment.hostUserAgent;
        if (lhr.runtimeError !== undefined) problems.push(`${page.name} ${form} run ${run + 1}: ${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
        for (const [id, cat] of Object.entries(lhr.categories)) scores[id]?.push(Math.round((cat.score ?? 0) * 100));
        const errors = (lhr.audits['errors-in-console']?.details as { items?: { source?: string; description?: string; url?: string }[] } | undefined)?.items ?? [];
        for (const e of errors) consoleErrors.push(`${e.source ?? ''}: ${(e.description ?? '').slice(0, 160)}`);
        const issues = (lhr.audits['inspector-issues']?.details as { items?: { issueType?: string | { value?: string } }[] } | undefined)?.items ?? [];
        for (const i of issues) {
          const type = typeof i.issueType === 'string' ? i.issueType : (i.issueType?.value ?? '');
          if (/content security policy/i.test(type)) cspIssues.push(type);
        }
        for (const e of errors) if (/Content Security Policy/i.test(e.description ?? '')) cspIssues.push(e.description ?? '');
        for (const [id, audit] of Object.entries(lhr.audits)) {
          if (audit.score !== null && audit.score < 1 && (audit.scoreDisplayMode === 'binary' || audit.scoreDisplayMode === 'metricSavings' || audit.scoreDisplayMode === 'numeric')) failedAudits.add(`${id} (${audit.displayValue ?? audit.score})`);
        }
        if (run === 0) await writeFile(join(RESULT_DIR, `${page.name}-${form}.json`), JSON.stringify(lhr));
      }
      const medians = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, median(v)]));
      (summary.pages as Record<string, unknown>)[`${page.name}-${form}`] = { scores, medians, consoleErrors: [...new Set(consoleErrors)], cspIssues: [...new Set(cspIssues)], notFull: [...failedAudits].sort() };
      console.log(`${page.name} ${form}: ${Object.entries(scores).map(([k, v]) => `${k} ${v.join('/')} (median ${medians[k]})`).join(', ')}; console errors ${consoleErrors.length}, CSP ${cspIssues.length}`);
      if (failedAudits.size > 0) console.log(`  audits below full score: ${[...failedAudits].sort().join(', ')}`);
      for (const [cat, need] of Object.entries(NEEDS[form])) if ((medians[cat] ?? 0) < need!) problems.push(`${page.name} ${form}: ${cat} median ${medians[cat]}, needs ${need}`);
      if (consoleErrors.length > 0) problems.push(`${page.name} ${form}: ${consoleErrors.length} errors in the console: ${[...new Set(consoleErrors)].join(' | ')}`);
      if (cspIssues.length > 0) problems.push(`${page.name} ${form}: ${cspIssues.length} CSP issues`);
    }
  }
} finally {
  await chrome.kill();
  await server.close();
}
await writeFile(join(RESULT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nChromium: ${String(summary.chromium)}; results in ${RESULT_DIR}`);
console.log(problems.length ? `Problems (${problems.length}):\n  ${problems.join('\n  ')}` : 'Problems: 0');
if (problems.length) process.exitCode = 1;
