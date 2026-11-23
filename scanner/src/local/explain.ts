import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeCapture } from '../analyzers/capture.ts';
import { recheckCapture } from '../capture/failure.ts';
import { frameUnknown } from '../capture/frames.ts';
import type { Capture, CapturedRequest } from '../capture/types.ts';
import { DEFAULT_RULES } from '../data.ts';
import { hostOf } from '../domain/site.ts';

/**
 * Explains one detected service of a saved capture, for manual checks:
 * `npm run explain -- --site 07 --service google-fonts`
 *
 * Prints every request of the service with time, status, frame and the initiator chain up to
 * the page, plus the lines of the saved HTML that mention the service's hosts. Reads only
 * files in `local/`; it never contacts the site.
 */

function chain(request: CapturedRequest, all: CapturedRequest[]): string[] {
  const steps: string[] = [];
  let current: CapturedRequest | undefined = request;
  for (let depth = 0; depth < 10 && current?.initiator?.url; depth += 1) {
    const url: string = current.initiator.url;
    steps.push(`${current.initiator.type} <- ${url.slice(0, 160)}`);
    current = [...all].reverse().find((r) => r.url === url && r.seq < (current?.seq ?? 0));
  }
  return steps;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { site: { type: 'string' }, service: { type: 'string', default: 'google-fonts' }, dir: { type: 'string', default: 'local' } },
  });
  if (values.site === undefined) throw new Error('usage: --site 07 [--service google-fonts]');
  const number = values.site.padStart(2, '0');
  const base = resolve(values.dir, 'captures', `site-${number}`);
  // Decided again like every analysis, so a check page saved as a normal page is not explained as one.
  const capture = recheckCapture(JSON.parse(await readFile(`${base}.json`, 'utf8')) as Capture);
  const result = analyzeCapture(capture, DEFAULT_RULES);
  if (result.thirdParty === null) {
    console.log(`Site ${number}: not analyzed, state ${result.state} (${result.failure?.reason}), ${capture.requests.length} requests. No findings for this capture.`);
    return;
  }
  const analysis = result.thirdParty;
  const key = values.service;
  const service = analysis.services.find((s) => s.key === key);
  console.log(`Site ${number}: capture ok=${capture.ok}, ${capture.requests.length} requests, first party ${analysis.firstPartySites.join(', ')}`);
  console.log(`Banner: ${capture.consentBanner.detected ? `${capture.consentBanner.toolId} visible at ${capture.consentBanner.visibleAtMs} ms` : 'not seen'}; tools in DOM: ${capture.consentBanner.toolsInDom.join(', ') || 'none'}`);
  const rule = DEFAULT_RULES.byId.get(key);
  const hosts = new Set(rule?.hosts.map((h) => h.split('/')[0]?.replace(/^\*\./, '') ?? '') ?? []);
  const own = capture.requests.filter((r) => {
    const raw = hostOf(r.url);
    // Through the same mapping as the analyzer: www.google.it counts as www.google.com.
    const host = raw === null ? null : DEFAULT_RULES.canonicalHost(raw);
    return host !== null && [...hosts].some((h) => host === h || host.endsWith(`.${h}`));
  });
  if (service === undefined) console.log(`Service ${key}: not detected as its own entry.`);
  else console.log(`Service ${key}: severity ${service.severity}, class ${service.riskClass}, ${service.requestCount} requests, first at ${service.firstStartMs} ms, includes ${JSON.stringify(service.includes)}`);
  console.log(`\nRequests to the hosts of ${key} (${own.length}):`);
  for (const request of own) {
    const shown = request.url.length <= 500 ? request.url : `${request.url.slice(0, 499)}…`;
    const owner = analysis.services.find((s) => s.evidence.some((e) => e.url === shown))?.key ?? '(not in the first 20 evidence entries)';
    console.log(`- #${request.seq} ${request.startMs} ms ${request.resourceType} status=${request.status ?? request.failure} owner=${owner}`);
    console.log(`  ${request.url.slice(0, 200)}`);
    console.log(`  frame: ${frameUnknown(capture, request) ? 'unknown (never a finding of the page on its own)' : request.frameUrls.length === 0 ? 'top-level document' : request.frameUrls.join(' <- ')}`);
    for (const step of chain(request, capture.requests)) console.log(`  initiator ${step}`);
  }
  try {
    const html = await readFile(`${base}.html`, 'utf8');
    const lines = html.split(/\r?\n/);
    const hits = lines.flatMap((line, i) => ([...hosts].some((h) => line.includes(h)) ? [`  line ${i + 1}: ${line.trim().slice(0, 220)}`] : []));
    console.log(`\nSaved HTML lines mentioning ${[...hosts].join(', ')} (${hits.length}):`);
    for (const hit of hits.slice(0, 20)) console.log(hit);
  } catch {
    console.log('\n(no saved HTML)');
  }
}

await main();
