import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Capture } from '../capture/types.ts';
import { DEFAULT_RULES, RULES_FILE } from '../data.ts';
import { SCANNER_VERSION } from '../index.ts';
import { buildReport } from '../report/build.ts';
import { normalizeSiteAddress } from '../report/site-address.ts';
import { validateReport } from '../report/validate.ts';
import { parseSitesFile } from './sites-file.ts';

/**
 * Session A5: builds the report JSON from saved captures and validates it against the schema, without
 * visiting any site: `npm run report:check [-- --captures local/a4/captures --out local/a5]`.
 *
 * Writes every report to `<out>/reports/site-07.json` (git-ignored) and prints aggregated numbers with
 * anonymous labels only: reports that validate, report size, findings and network rows per scan (the
 * rows the D1 tables `findings` and `network_requests` would get).
 */

function stats(values: number[]): { median: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return { median, max: sorted.at(-1) ?? 0, mean: sorted.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sites: { type: 'string', default: 'local/sites.txt' },
      captures: { type: 'string', default: 'local/a4/captures' },
      out: { type: 'string', default: 'local/a5' },
    },
  });
  const { sites, errors } = parseSitesFile(await readFile(resolve(values.sites), 'utf8'));
  if (errors.length > 0) throw new Error(`problems in ${values.sites}: ${errors.length}`);
  const outDir = resolve(values.out, 'reports');
  await mkdir(outDir, { recursive: true });
  const sizes: number[] = [];
  const findingRows: number[] = [];
  const hostRows: number[] = [];
  const services: number[] = [];
  const states = new Map<string, number>();
  const invalid: string[] = [];
  let dropped = 0;
  for (const site of sites) {
    const label = `Site ${site.number}`;
    const capture = JSON.parse(await readFile(resolve(values.captures, `site-${site.number}.json`), 'utf8')) as Capture;
    const address = normalizeSiteAddress(site.url);
    if (!address.ok) {
      invalid.push(`${label}: address refused (${address.error})`);
      continue;
    }
    const built = buildReport({
      id: `local${site.number.padStart(2, '0')}`.padEnd(26, 'a').replace(/[^a-z2-7]/g, 'a'),
      createdAt: capture.startedAt,
      siteUrl: address.url,
      mode: 'full',
      capture,
      rules: DEFAULT_RULES,
      scannerVersion: SCANNER_VERSION,
      rulesUpdated: RULES_FILE.updated,
      visit: { country: null, colo: null },
    });
    const text = JSON.stringify(built.report);
    const problems = validateReport(built.report);
    if (problems.length > 0) invalid.push(`${label}: ${problems.length} schema errors, first ${problems[0]?.path} ${problems[0]?.message}`);
    sizes.push(new TextEncoder().encode(text).byteLength);
    findingRows.push(built.report.findings.length);
    hostRows.push(built.networkHosts.length);
    services.push(built.report.services.length);
    dropped += built.networkHostsDropped;
    states.set(built.report.state, (states.get(built.report.state) ?? 0) + 1);
    await writeFile(resolve(outDir, `site-${site.number}.json`), `${JSON.stringify(built.report, null, 2)}\n`);
  }
  const summary = {
    reports: sites.length,
    valid: sites.length - invalid.length,
    states: Object.fromEntries(states),
    reportBytes: stats(sizes),
    findingRows: stats(findingRows),
    networkHostRows: stats(hostRows),
    networkHostsDropped: dropped,
    services: stats(services),
    invalid,
  };
  await writeFile(resolve(values.out, 'report-check.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (invalid.length > 0) process.exitCode = 1;
}

await main();
