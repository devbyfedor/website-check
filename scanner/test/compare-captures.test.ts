import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/data.ts';
import { compareCaptures } from '../src/local/compare-captures.ts';
import { loadTestRules, makeCapture } from './helpers.ts';

const banner = (detected: boolean) => ({
  detected,
  toolId: detected ? 'cookiebot' : null,
  method: detected ? ('selector' as const) : null,
  selector: null,
  visibleAtMs: detected ? 900 : null,
  toolsInDom: [],
});

describe('compare captures', () => {
  const rules = loadTestRules();
  const local = makeCapture({
    requests: [
      { url: 'https://www.example.de/', status: 200, isNavigation: true, resourceType: 'document' },
      { url: 'https://fonts.googleapis.com/css2?family=A', status: 200 },
      { url: 'https://www.example.de/app.js?v=1', status: 200 },
    ],
    consentBanner: banner(true),
  });

  it('finds nothing to review for the same requests with other query strings', () => {
    const cloud = makeCapture({
      requests: [
        { url: 'https://www.example.de/', status: 200, isNavigation: true, resourceType: 'document' },
        { url: 'https://fonts.googleapis.com/css2?family=A', status: 200 },
        { url: 'https://www.example.de/app.js?v=2', status: 200 },
      ],
      consentBanner: banner(true),
    });
    const result = compareCaptures(local, cloud, rules);
    expect(result.completenessPct).toBe(100);
    expect(result.thirdPartyHosts).toEqual({ both: ['fonts.googleapis.com'], onlyLocal: [], onlyCloud: [] });
    expect(result.needsReview).toBe(false);
  });

  it('flags extra third parties and a missing banner on the cloud side', () => {
    const cloud = makeCapture({
      requests: [
        { url: 'https://www.example.de/', status: 200, isNavigation: true, resourceType: 'document' },
        { url: 'https://tracker.example-ads.com/p.gif', status: 200 },
      ],
      consentBanner: banner(false),
    });
    const result = compareCaptures(local, cloud, rules);
    expect(result.thirdPartyHosts.onlyCloud).toEqual(['tracker.example-ads.com']);
    expect(result.thirdPartyHosts.onlyLocal).toEqual(['fonts.googleapis.com']);
    expect(result.completenessPct).toBe(33.3);
    expect(result.local.banner.detected).toBe(true);
    expect(result.cloud.banner.detected).toBe(false);
    expect(result.needsReview).toBe(true);
  });

  it('leaves CORS preflights out of counts, hosts and completeness and counts them apart', () => {
    const cloud = makeCapture({
      requests: [
        { url: 'https://www.example.de/', status: 200, isNavigation: true, resourceType: 'document' },
        { url: 'https://fonts.googleapis.com/css2?family=A', status: 200 },
        { url: 'https://www.example.de/app.js?v=1', status: 200 },
        { url: 'https://fonts.googleapis.com/css2?family=A', method: 'OPTIONS', resourceType: 'other', status: 204, initiator: { type: 'preflight', url: null } },
      ],
      consentBanner: banner(true),
    });
    const result = compareCaptures(local, cloud, rules);
    expect(result.cloud).toMatchObject({ requests: 3, thirdPartyRequests: 1, preflights: 1 });
    expect(result.local.preflights).toBe(0);
    expect(result.thirdPartyHosts.onlyCloud).toEqual([]);
    expect(result.onlyCloudRequests).toBe(0);
    expect(result.needsReview).toBe(false);
  });

  it('counts a Google country domain as google.com', () => {
    const withGoogle = (host: string) =>
      makeCapture({
        requests: [
          { url: 'https://www.example.de/', status: 200, isNavigation: true, resourceType: 'document' },
          { url: `https://${host}/ads/ga-audiences?v=1&tid=G-TEST`, status: 200, resourceType: 'image' },
        ],
        consentBanner: banner(true),
      });
    const result = compareCaptures(withGoogle('www.google.de'), withGoogle('www.google.it'), DEFAULT_RULES);
    expect(result.thirdPartyHosts).toEqual({ both: ['www.google.com'], onlyLocal: [], onlyCloud: [] });
    expect(result.completenessPct).toBe(100);
    expect(result.findings.onlyCloud).toEqual([]);
    expect(result.needsReview).toBe(false);
  });
});
