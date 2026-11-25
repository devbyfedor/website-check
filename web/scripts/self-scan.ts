// Our scanner on our own site (session B5 part 2, Fedor; the brief: "Our own site passes our own scanner with zero
// findings"): the production build with both Workers on plain `wrangler dev` (dev-local.ts, local Chrome, a fresh local
// D1, no Cloudflare account), a scan of the site's own address through the API, as the form starts it, and the report
// read back. Checked: every security header but HSTS counts (HSTS and HTTPS only after the deploy: a browser and our
// scanner ignore HSTS over http://), 0 third-party services, 0 violations of the accessibility checks, no system
// detected falsely. The report goes to local/self-scan/report.json.
//
//   npm run self-scan            builds web/ first
//   node web/scripts/self-scan.ts --no-build
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '@website-check/scanner/report';
import { ROOT } from './browser-setup.ts';
import { startDevSite } from './dev-local.ts';

const PORT = 8787;
const site = await startDevSite({ build: !process.argv.includes('--no-build'), self: true, port: PORT });
const target = `http://localhost:${PORT}/`;
const problems: string[] = [];
try {
  const started = await fetch(`${site.origin}/api/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) });
  const scan = (await started.json()) as { id?: string; error?: string };
  if (started.status !== 202 || typeof scan.id !== 'string') throw new Error(`the start answered ${started.status} ${JSON.stringify(scan)}`);
  console.log(`scan ${scan.id} of ${target} started`);
  let status = '';
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const s = (await (await fetch(`${site.origin}/api/scans/${scan.id}`)).json()) as { status: string };
    status = s.status;
    if (status === 'done' || status === 'error') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (status !== 'done') throw new Error(`the scan ended with ${status}`);
  const answer = await fetch(`${site.origin}/api/scans/${scan.id}/report`);
  const apiHeaders = Object.fromEntries(answer.headers.entries());
  const report = (await answer.json()) as Report;
  const dir = join(ROOT, 'local', 'self-scan');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nReport: state ${report.state}, pages ${JSON.stringify(report.pages)}`);
  console.log('Security headers of the homepage:');
  for (const h of report.security?.headers ?? []) console.log(`  ${h.header}: ${h.status}${h.counts ? ', counts' : ', does not count'}`);
  const notCounted = (report.security?.headers ?? []).filter((h) => !h.counts);
  for (const h of notCounted) if (h.key !== 'hsts') problems.push(`${h.header} does not count (${h.status})`);
  console.log(`  counted ${report.security?.headersPresent} of ${report.security?.headersTotal}; HTTPS ${report.security?.https}, redirect ${report.security?.httpRedirect}`);
  console.log(`Third-party services: ${report.services.length} (counts ${report.counts.services})`);
  if (report.counts.services !== 0) problems.push(`${report.counts.services} third-party services: ${report.services.map((s) => s.name).join(', ')}`);
  // The six checks of axe-core run in the scan: a violation is a finding of the area accessibility.
  const a11y = report.sections.accessibility;
  const a11yFindings = report.findings.filter((f) => f.area === 'accessibility');
  const rows = report.measures.filter((m) => m.id === 'lowest-contrast' || m.id === 'images-described');
  console.log(`Accessibility: section ${a11y.status}; findings ${a11yFindings.map((f) => `${f.kind} ${f.textId}`).join(', ') || 'none'}; ${rows.map((m) => `${m.id} ${m.result}`).join(', ')}`);
  if (a11y.status !== 'checked') problems.push(`accessibility ${a11y.status}`);
  for (const f of a11yFindings) if (f.kind === 'finding') problems.push(`accessibility: ${f.textId}`);
  const system = report.platform?.system ?? null;
  console.log(`System: ${system ?? 'not detected'} (section ${report.sections.platform.status})`);
  if (system !== null && system !== 'unknown') problems.push(`system detected falsely: ${system}`);
  console.log('Findings:');
  for (const f of report.findings) console.log(`  ${f.kind}${f.risk === null ? '' : ` (${f.risk})`}: ${f.textId}`);
  console.log(`Priorities: ${report.priorities.join(', ') || 'none'}`);
  console.log(`Headers of the API answer: ${['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options'].map((k) => `${k} ${apiHeaders[k] === undefined ? 'MISSING' : 'set'}`).join(', ')}`);
  for (const k of ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options']) if (apiHeaders[k] === undefined) problems.push(`the API answer has no ${k}`);
  const home = await fetch(`${site.origin}/`);
  const pageHeaders = ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options'].map((k) => [k, home.headers.get(k)] as const);
  console.log(`Headers of the home page through wrangler dev: ${pageHeaders.map(([k, v]) => `${k} ${v === null ? 'MISSING' : `${v.length} chars`}`).join(', ')}`);
  for (const [k, v] of pageHeaders) if (v === null) problems.push(`the home page has no ${k}`);
  if ((home.headers.get('content-security-policy') ?? '').includes(',')) problems.push('the home page has two CSPs (the rule /* and its own)');
} catch (error) {
  problems.push(String(error));
} finally {
  await site.stop();
}
console.log(problems.length ? `\nProblems (${problems.length}):\n  ${problems.join('\n  ')}` : '\nProblems: 0');
if (problems.length) process.exitCode = 1;
