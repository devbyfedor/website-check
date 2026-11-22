import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeCapture, type CaptureAnalysis } from '../analyzers/capture.ts';
import type { ThirdPartyAnalysis } from '../analyzers/third-party.ts';
import { recheckCapture } from '../capture/failure.ts';
import type { Capture, CaptureFailureReason } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
import type { AxeCapture } from '../a11y/types.ts';
import { compareAxeRuns, oursBefore, runReferenceChain, type AxeComparison, type ReferenceChain } from './axe-reference.ts';
import { captureWithPlaywright, launchLocalBrowser, type LocalCaptureResult } from './playwright-capture.ts';
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
 * load, repeated (at most 3 times) until our runs before and after the standard run see the same
 * page; the comparison goes to local/results/axe-reference-site-07.json.
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
  const references: Record<string, { first: AxeComparison; stable: AxeComparison | null; stableIndex: number | null; steps: number }> = {};
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
      const full = analyzeCapture(capture, DEFAULT_RULES);
      const analysis = full.thirdParty;
      await writeResult(outDir, base, analysis);
      await writeLegal(outDir, base, full);
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
                afterChecks: (page, checks) => runReferenceChain(page, checks.axe),
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
      if (result.impressumHtml) await writeFile(resolve(outDir, 'captures', `${base}.impressum.html`), result.impressumHtml);
      if (result.impressumScreenshot) await writeFile(resolve(outDir, 'captures', `${base}.impressum.png`), result.impressumScreenshot);
      const full = analyzeCapture(capture, DEFAULT_RULES);
      const analysis = full.thirdParty;
      await writeResult(outDir, base, analysis);
      await writeLegal(outDir, base, full);
      results.push({ label: site.label, kind: site.kind, platform: site.platform, attempts, capture, analysis });
      if (result.after !== undefined) {
        const chain = result.after as Partial<ReferenceChain> & { error?: string };
        const firstStep = chain.steps?.[0];
        if (chain.steps === undefined || firstStep === undefined) {
          console.log(`${site.label}: reference run failed: ${chain.error ?? 'unknown'}`);
        } else {
          const full = chain as ReferenceChain;
          // The first step as it is, and the first step whose page did not change around the standard run.
          const first = compareAxeRuns(capture.axe, firstStep.reference, firstStep.after);
          const index = full.stableIndex;
          const stableStep = index === null ? undefined : full.steps[index];
          const stable = index === null || stableStep === undefined ? null : compareAxeRuns(oursBefore(full, capture.axe, index), stableStep.reference, stableStep.after);
          references[site.label] = { first, stable, stableIndex: index, steps: full.steps.length };
          await writeFile(resolve(outDir, 'results', `axe-reference-${base}.json`), `${JSON.stringify({ label: site.label, ours: capture.axe, chain: full, first, stable }, null, 2)}\n`);
          const show = (c: AxeComparison): string => `${c.allSame ? 'SAME' : 'DIFFERENT'} (${c.rules.map((r) => `${r.rule} ${r.ours}/${r.reference}/${r.oursAgain}`).join(', ')})`;
          console.log(
            `${site.label}: axe ours/standard/ours again, first step ${show(first)}; ` +
              (stable === null ? `page never stable in ${full.steps.length} steps` : `stable at step ${(index ?? 0) + 1}: ${show(stable)}`) +
              `; versions ${first.versions.ours}/${first.versions.reference}; standard run ${firstStep.reference.ms} ms`,
          );
        }
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
      const legal = full.legal;
      const fieldsLine =
        legal === null
          ? ''
          : `; Impressum ${legal.impressum.state}${capture.impressum ? ` ${capture.impressum.timings.totalMs} ms` : ''}, fields ${(['address', 'email', 'handelsregister', 'ustId'] as const)
              .map((f) => `${f} ${legal.fields[f].status === 'found' ? 'found' : '-'}`)
              .join(' ')}, system ${full.platform?.system}${full.platform?.woocommerce ? '+woocommerce' : ''}`;
      console.log(`${site.label}: ${line}${extra}${fieldsLine}`);
    }
  } finally {
    await browser.close();
  }

  if (Object.keys(references).length > 0) {
    await writeFile(resolve(outDir, 'results', 'axe-reference.json'), `${JSON.stringify(references, null, 2)}\n`);
    const firstSame = Object.values(references).filter((c) => c.first.allSame).length;
    const stableSame = Object.values(references).filter((c) => c.stable?.allSame === true).length;
    const stable = Object.values(references).filter((c) => c.stable !== null).length;
    console.log(
      `\naxe comparison with the standard run: first step the same on every rule on ${firstSame} of ${Object.keys(references).length} sites; ` +
        `with a stable page ${stableSame} of ${stable} (page stable on ${stable} of ${Object.keys(references).length})`,
    );
  }
  if (only === null) await writeSummary(outDir, results);
}

/** Writes the analysis of a site; a site without one (blocked or failed) loses an old file, so results/ never shows it as clean. */
async function writeResult(outDir: string, base: string, analysis: ThirdPartyAnalysis | null): Promise<void> {
  const path = resolve(outDir, 'results', `${base}.json`);
  if (analysis === null) await rm(path, { force: true });
  else await writeFile(path, `${JSON.stringify(analysis, null, 2)}\n`);
}

/** Session A4: legal links, Impressum fields and the system of a site; removed for a site without analysis. */
async function writeLegal(outDir: string, base: string, analysis: CaptureAnalysis): Promise<void> {
  const path = resolve(outDir, 'results', `${base}.legal.json`);
  if (analysis.legal === null) await rm(path, { force: true });
  else await writeFile(path, `${JSON.stringify({ legal: analysis.legal, platform: analysis.platform }, null, 2)}\n`);
}

async function writeSummary(outDir: string, results: SiteRunResult[]): Promise<void> {
  const summary = summarizeRun(results);
  await writeFile(resolve(outDir, 'results', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const markdown = renderSummaryMarkdown(summary);
  await writeFile(resolve(outDir, 'results', 'summary.md'), markdown);
  console.log(`\n${markdown}`);
}

await main();
