import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeThirdParty } from '../analyzers/third-party.ts';
import type { CaptureFailureReason } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
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
 */

const RETRYABLE = new Set<CaptureFailureReason>(['timeout', 'unreachable', 'other']);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sites: { type: 'string', default: 'local/sites.txt' },
      out: { type: 'string', default: 'local' },
      only: { type: 'string' },
      retries: { type: 'string', default: '1' },
    },
  });
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

  const browser = await launchLocalBrowser();
  console.log(`Chromium ${browser.version()}, ${selected.length} site(s)`);
  const results: SiteRunResult[] = [];
  try {
    for (const site of selected) {
      let attempts = 0;
      let result: LocalCaptureResult;
      for (;;) {
        attempts += 1;
        result = await captureWithPlaywright(browser, site.url, { artifacts: true });
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
      const analysis = capture.ok ? analyzeThirdParty(capture, DEFAULT_RULES) : null;
      if (analysis !== null) await writeFile(resolve(outDir, 'results', `${base}.json`), `${JSON.stringify(analysis, null, 2)}\n`);
      results.push({ label: site.label, kind: site.kind, platform: site.platform, attempts, capture, analysis });
      const line = capture.ok
        ? `ok ${(capture.timings.endMs / 1000).toFixed(1)} s (${capture.timings.stopReason}), ${capture.requests.length} requests, ` +
          `${analysis?.counts.findings ?? 0} findings, ${analysis?.counts.hints ?? 0} hints, banner ${capture.consentBanner.detected ? `${capture.consentBanner.toolId} at ${capture.consentBanner.visibleAtMs} ms` : 'not seen'}`
        : `FAILED ${capture.failure?.reason}: ${capture.failure?.message.slice(0, 100)}`;
      console.log(`${site.label}: ${line}`);
    }
  } finally {
    await browser.close();
  }

  if (only === null) {
    const summary = summarizeRun(results);
    await writeFile(resolve(outDir, 'results', 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    const markdown = renderSummaryMarkdown(summary);
    await writeFile(resolve(outDir, 'results', 'summary.md'), markdown);
    console.log(`\n${markdown}`);
  }
}

await main();
