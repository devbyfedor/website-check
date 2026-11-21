import { describe, expect, it } from 'vitest';
import { analyzeThirdParty } from '../src/analyzers/third-party.ts';
import { renderSummaryMarkdown, summarizeRun, type SiteRunResult } from '../src/local/summary.ts';
import { loadTestRules, makeCapture, type RequestInput } from './helpers.ts';

const rules = loadTestRules();

function site(label: string, kind: string, url: string, requests: RequestInput[], bannerAt: number | null = null): SiteRunResult {
  const capture = makeCapture({
    requestedUrl: url,
    finalUrl: url,
    requests: [{ url, resourceType: 'document' }, ...requests],
    consentBanner: {
      detected: bannerAt !== null,
      toolId: bannerAt !== null ? 'cookiebot' : null,
      method: bannerAt !== null ? 'selector' : null,
      selector: null,
      visibleAtMs: bannerAt,
      toolsInDom: [],
    },
  });
  return { label, kind, platform: null, attempts: 1, capture, analysis: analyzeThirdParty(capture, rules) };
}

function failed(label: string, kind: string): SiteRunResult {
  const capture = makeCapture({ requests: [], ok: false, failure: { reason: 'timeout', message: 'page.goto: Timeout 15000ms exceeded.' }, finalUrl: null });
  return { label, kind, platform: null, attempts: 2, capture, analysis: null };
}

const results: SiteRunResult[] = [
  site('Site 01', 'shop', 'https://www.shop-eins.de/', [{ url: 'https://fonts.googleapis.com/css?family=A', startMs: 100 }, { url: 'https://consent.cookiebot.com/uc.js', startMs: 50 }], 900),
  site('Site 02', 'shop', 'https://www.shop-zwei.de/', [{ url: 'https://cdn.jsdelivr.net/npm/x.js' }]),
  site('Site 03', 'service', 'https://www.praxis-drei.de/', [{ url: 'https://www.google-analytics.com/analytics.js', startMs: 2000 }], 1000),
  site('Site 04', 'service', 'https://www.maler-vier.de/', []),
  failed('Site 05', 'builder'),
];

describe('redactText', () => {
  it('removes addresses and host names from free text, keeps the rest', async () => {
    const { redactText } = await import('../src/local/summary.ts');
    expect(redactText('page.goto: net::ERR_NAME_NOT_RESOLVED at https://www.shop-eins.de/start')).toBe('page.goto: net::ERR_NAME_NOT_RESOLVED at <url>');
    expect(redactText('error: www.shop-eins.de refused, see cdn.example.com')).toBe('error: <host> refused, see <host>');
    expect(redactText('page.goto: Timeout 15000ms exceeded.')).toBe('page.goto: Timeout 15000ms exceeded.');
  });
});

describe('summarizeRun', () => {
  const summary = summarizeRun(results);

  it('counts captures and failures with their reasons', () => {
    expect(summary).toMatchObject({ sites: 5, captured: 4, retried: 1 });
    expect(summary.failures).toEqual([{ label: 'Site 05', reason: 'timeout', message: 'page.goto: Timeout 15000ms exceeded.' }]);
    expect(summary.byKind).toEqual({ shop: { sites: 2, captured: 2 }, service: { sites: 2, captured: 2 }, builder: { sites: 1, captured: 0 } });
  });

  it('aggregates findings per site', () => {
    expect(summary.sitesWithFinding).toBe(2);
    expect(summary.sitesWithHintOnly).toBe(1);
    expect(summary.sitesWithFindingBeforeBanner).toBe(1);
    expect(summary.sitesByRiskClass).toEqual({ precedent: 1, 'consent-required': 1, 'usually-consent': 0, 'grey-zone': 1, 'not-flagged': 1 });
    expect(summary.googleFontsSites).toEqual(['Site 01']);
    expect(summary.banner).toEqual({ detected: 2, byTool: { cookiebot: 2 }, medianVisibleAtMs: 950 });
    expect(summary.serviceSites).toEqual([
      { serviceId: 'cookiebot', sites: 1 },
      { serviceId: 'google-analytics', sites: 1 },
      { serviceId: 'google-fonts', sites: 1 },
      { serviceId: 'jsdelivr', sites: 1 },
    ]);
  });

  it('renders Markdown without any site address', () => {
    const markdown = renderSummaryMarkdown(summary);
    expect(markdown).toContain('Sites: 5. Captured: 4. Failed: 1.');
    expect(markdown).toContain('Site 05: timeout');
    expect(markdown).toContain('Google Fonts as a finding: 1 sites (Site 01)');
    expect(markdown).not.toMatch(/https?:\/\/|shop-eins|praxis-drei|\.de\b/);
  });
});
