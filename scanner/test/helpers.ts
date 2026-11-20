import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Capture, CapturedRequest } from '../src/capture/types.ts';
import { compileRules, parseRulesFile, type CompiledRules } from '../src/rules/match.ts';

export const SCANNER_ROOT = resolve(import.meta.dirname, '..');
export const REPO_ROOT = resolve(SCANNER_ROOT, '..');

/** Rules used by analyzer tests: a small, stable set independent of the production data. */
export function loadTestRules(): CompiledRules {
  const raw: unknown = JSON.parse(readFileSync(resolve(SCANNER_ROOT, 'fixtures/rules/test-rules.json'), 'utf8'));
  return compileRules(parseRulesFile(raw));
}

export type RequestInput = Partial<CapturedRequest> & { url: string };

export const SITE = 'https://www.example.de/';

/** Builds a synthetic capture. Requests get increasing seq and start times unless given. */
export function makeCapture(input: { requests: RequestInput[] } & Partial<Omit<Capture, 'requests'>>): Capture {
  const { requests, ...rest } = input;
  const finalUrl = rest.finalUrl === undefined ? SITE : rest.finalUrl;
  return {
    schemaVersion: 1,
    adapter: 'playwright-local',
    environment: {
      browser: 'chromium test',
      userAgent: 'test',
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      viewport: { width: 1440, height: 900 },
    },
    requestedUrl: rest.requestedUrl ?? SITE,
    startedAt: '2026-11-20T12:00:00.000Z',
    ok: true,
    failure: null,
    finalUrl,
    mainDocument: rest.mainDocument ?? { status: 200, headers: {}, redirectChain: [] },
    page: null,
    consentBanner: rest.consentBanner ?? {
      detected: false,
      toolId: null,
      method: null,
      selector: null,
      visibleAtMs: null,
      toolsInDom: [],
    },
    axe: null,
    timings: { domContentLoadedMs: 300, loadMs: 900, networkQuietMs: 1200, endMs: 2700, stopReason: 'network-quiet' },
    ...rest,
    requests: requests.map((request, index) => ({
      seq: index,
      method: 'GET',
      resourceType: 'other',
      startMs: index * 10,
      endMs: index * 10 + 5,
      status: 200,
      failure: null,
      isMainFrame: true,
      frameUrls: [],
      isNavigation: false,
      initiator: null,
      redirectedFrom: null,
      ...request,
    })),
  };
}
