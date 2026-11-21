import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeCapture } from '../analyzers/capture.ts';
import type { ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import { recheckCapture } from '../capture/failure.ts';
import type { Capture, CaptureFailureReason } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
import type { AxeCapture } from '../a11y/types.ts';
import { compareAxeRuns, runReferenceAxe, type AxeComparison, type ReferenceRun } from './axe-reference.ts';
import { loadAxeSource } from './axe-source.ts';
import { captureWithPlaywright, launchLocalBrowser, runAxeInPlaywright, type LocalCaptureResult } from './playwright-capture.ts';
import { parseSitesFile } from './sites-file.ts';
import { renderSummaryMarkdown, summarizeRun, type SiteRunResult } from './summary.ts';

/**
 * Local run over the test sites: `npm run scan:local [-- --only 3,7]`.
 *
 * Captures the homepage of every site in `local/sites.txt` with Playwright (one site after
 * the other, one fresh browser context each, no interaction), analyzes third-party services
 * and writes everything to `local/` (git-ignored):
 *   local/captures/site-07.json|.html|.png   the capture, final HTML and a screenshot
 *   local/results/site-07.json               the third-party analysis
 *   local/results/summary.json|.md           aggregated numbers, anonymous labels only
 * The console shows anonymous labels only.
 *
 * `--axe-reference 3,7` (session A3): on these sites, right after our axe run, the standard
 * `@axe-core/playwright` run of the same rules and then our run once more, all on the same page
 * load; the comparison goes to local/results/axe-reference-site-07.json.
 */

const RETRYABLE = new Set<CaptureFailureReason>(['timeout', 'unreachable', 'other']);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sites: { type: 'string', default: 'local/sites.txt' },
      out: { type: 'string', default: 'local' },
      only: { type: 'string' },
      retries: { type: 'string', default: '1' },
      // Recompute analyses and the summary from the saved captures, without visiting any site.
      reanalyze: { type: 'boolean', default: false },
      'axe-reference': { type: 'string' },
    },
  });
  const referenceSites = new Set((values['axe-reference'] ?? '').split(',').map((n) => n.trim()).filter((n) => n !== '').map((n) => n.padStart(2, '0')));
  const references: Record<string, AxeComparison> = {};
  const sitesPath = resolve(values.sites);
  const outDir = resolve(values.out);
  const retries = Number(values.retries);
  const { sites, errors } = parseSitesFile(await readFile(sitesPath, 'utf8'));
  if (errors.length > 0) {
    console.error(`Problems in ${values.sites}:\n${errors.join('\n')}`);
    process.exitCode = 1;
    return;
  }
  const only = values.only === undefined ? null : new Set(values.only.split(',').map((n) => n.trim().padStart(2, '0')));
  const selected = only === null ? sites : sites.filter((site) => only.has(site.number));
  await mkdir(resolve(outDir, 'captures'), { recursive: true });
  await mkdir(resolve(outDir, 'results'), { recursive: true });

  if (values.reanalyze) {
    const results: SiteRunResult[] = [];
    for (const site of selected) {
      const base = `site-${site.number}`;
      // Decided again, so captures saved before a classification rule (for example check pages) follow it.
      const capture = recheckCapture(JSON.parse(await readFile(resolve(outDir, 'captures', `${base}.json`), 'utf8')) as Capture);
      const analysis = analyzeCapture(capture, DEFAULT_RULES).thirdParty;
      await writeResult(outDir, base, analysis);
      results.push({ label: site.label, kind: site.kind, platform: site.platform, attempts: 1, capture, analysis });
      console.log(`${site.label}: ${capture.ok ? `${analysis?.counts.findings ?? 0} findings, ${analysis?.counts.hints ?? 0} hints` : `FAILED ${capture.failure?.reason}`}`);
    }
    if (only === null) await writeSummary(outDir, results);
    return;
  }

  const browser = await launchLocalBrowser();
  console.log(`Chromium ${browser.version()}, ${selected.length} site(s)`);
  const results: SiteRunResult[] = [];
  try {
    for (const site of selected) {
      let attempts = 0;
      let result: LocalCaptureResult;
      for (;;) {
        attempts += 1;
        const withReference = referenceSites.has(site.number);
        result = await captureWithPlaywright(browser, site.url, {
          artifacts: true,
          ...(withReference
            ? {
                afterChecks: async (page) => {
                  const reference = await runReferenceAxe(page);
                  const again = await runAxeInPlaywright(page, await loadAxeSource(), 20_000);
                  return { reference, again };
                },
              }
            : {}),
        });
        const reason = result.capture.failure?.reason;
        if (reason === undefined || !RETRYABLE.has(reason) || attempts > retries) break;
        console.log(`${site.label}: ${reason}, retrying`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      const { capture, html, screenshot } = result;
      const base = `site-${site.number}`;
      await writeFile(resolve(outDir, 'captures', `${base}.json`), `${JSON.stringify(capture, null, 2)}\n`);
      if (html !== null) await writeFile(resolve(outDir, 'captures', `${base}.html`), html);
      if (screenshot !== null) await writeFile(resolve(outDir, 'captures', `${base}.png`), screenshot);
      const analysis = analyzeCapture(capture, DEFAULT_RULES).thirdParty;
      await writeResult(outDir, base, analysis);
      results.push({ label: site.label, kind: site.kind, platform: site.platform, attempts, capture, analysis });
      if (result.after !== undefined) {
        const after = result.after as { reference?: ReferenceRun; again?: AxeCapture; error?: string };
        const comparison = after.reference === undefined ? null : compareAxeRuns(capture.axe, after.reference, after.again ?? null);
        if (comparison !== null) references[site.label] = comparison;
        await writeFile(resolve(outDir, 'results', `axe-reference-${base}.json`), `${JSON.stringify({ label: site.label, ours: capture.axe, ...after, comparison }, null, 2)}\n`);
        console.log(
          comparison === null
            ? `${site.label}: reference run failed: ${after.error ?? 'unknown'}`
            : `${site.label}: axe ours vs standard ${comparison.allSame ? 'SAME' : 'DIFFERENT'} (${comparison.rules.map((r) => `${r.rule} ${r.ours}/${r.reference}/${r.oursAgain}`).join(', ')}); versions ${comparison.versions.ours}/${comparison.versions.reference}; standard run ${after.reference?.ms} ms`,
        );
      }
      const a11y = capture.axe;
      const security = capture.ok ? analyzeCapture(capture, DEFAULT_RULES).security : null;
      const line = capture.ok
        ? `ok ${(capture.timings.endMs / 1000).toFixed(1)} s (${capture.timings.stopReason}), ${capture.requests.length} requests, ` +
          `${analysis?.counts.findings ?? 0} findings, ${analysis?.counts.hints ?? 0} hints, banner ${capture.consentBanner.detected ? `${capture.consentBanner.toolId} at ${capture.consentBanner.visibleAtMs} ms` : 'not seen'}`
        : `FAILED ${capture.failure?.reason}: ${capture.failure?.message.slice(0, 100)}`;
      const extra = capture.ok
        ? `; axe ${a11y?.status ?? 'none'} ${a11y?.status === 'ok' ? Object.entries(a11y.rules).map(([id, r]) => `${id} ${r.violations}`).join(' ') : (a11y?.error ?? '')} in ${a11y?.timing.totalMs ?? 0} ms; https ${security?.https.result}, redirect ${capture.httpProbe?.outcome ?? 'none'}, headers ${security?.headersPresent}/5`
        : '';
      console.log(`${site.label}: ${line}${extra}`);
    }
  } finally {
    await browser.close();
  }

  if (Object.keys(references).length > 0) {
    await writeFile(resolve(outDir, 'results', 'axe-reference.json'), `${JSON.stringify(references, null, 2)}\n`);
    const same = Object.values(references).filter((c) => c.allSame).length;
    console.log(`\naxe comparison with the standard run: ${same} of ${Object.keys(references).length} sites the same on every rule`);
  }
  if (only === null) await writeSummary(outDir, results);
}

/** Writes the analysis of a site; a site without one (blocked or failed) loses an old file, so results/ never shows it as clean. */
async function writeResult(outDir: string, base: string, analysis: ThirdPartyAnalysis | null): Promise<void> {
  const path = resolve(outDir, 'results', `${base}.json`);
  if (analysis === null) await rm(path, { force: true });
  else await writeFile(path, `${JSON.stringify(analysis, null, 2)}\n`);
}

async function writeSummary(outDir: string, results: SiteRunResult[]): Promise<void> {
  const summary = summarizeRun(results);
  await writeFile(resolve(outDir, 'results', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const markdown = renderSummaryMarkdown(summary);
  await writeFile(resolve(outDir, 'results', 'summary.md'), markdown);
  console.log(`\n${markdown}`);
}

await main();
