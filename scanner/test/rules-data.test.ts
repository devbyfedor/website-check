import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_TOOLS_FILE, DEFAULT_RULES, RULES_FILE } from '../src/data.ts';
import { REPO_ROOT } from './helpers.ts';

/**
 * Integrity of the shipped rules data (`scanner/data/*.json`) against `docs/rules-sources.md`.
 * Every class assignment needs a source; no source means grey-zone.
 */

const sourcesDoc = readFileSync(resolve(REPO_ROOT, 'docs/rules-sources.md'), 'utf8');
const sourceIds = [...sourcesDoc.matchAll(/^### ([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/gm)].map((m) => m[1] as string);

const FORBIDDEN_WORDING = /Sie verstoßen gegen|illegal|rechtswidrig|Abmahngefahr|abmahnsicher|rechtssicher|garantiert|DSGVO-konform/i;
const TOO_BROAD = new Set([
  '*.google.com',
  '*.google.de',
  '*.googleapis.com',
  '*.gstatic.com',
  '*.googleusercontent.com',
  '*.amazonaws.com',
  '*.cloudfront.net',
  '*.fastly.net',
  '*.akamaihd.net',
  '*.akamaized.net',
  '*.azureedge.net',
  '*.cloudflare.com',
  '*.facebook.com',
  '*.microsoft.com',
]);

describe('rules data', () => {
  it('has at least 40 host patterns', () => {
    expect(DEFAULT_RULES.patternCount).toBeGreaterThanOrEqual(40);
  });

  it('has unique source headings in docs/rules-sources.md', () => {
    expect(sourceIds.length).toBeGreaterThan(0);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
  });

  it('cites only sources that exist in docs/rules-sources.md', () => {
    const missing = RULES_FILE.services.flatMap((s) => s.sources.filter((id) => !sourceIds.includes(id)).map((id) => `${s.id} -> ${id}`));
    expect(missing).toEqual([]);
  });

  it('uses every documented source at least once', () => {
    const used = new Set(RULES_FILE.services.flatMap((s) => s.sources));
    expect(sourceIds.filter((id) => !used.has(id))).toEqual([]);
  });

  it('gives every class except grey-zone at least one source', () => {
    const unsourced = RULES_FILE.services.filter((s) => s.riskClass !== 'grey-zone' && s.sources.length === 0).map((s) => s.id);
    expect(unsourced).toEqual([]);
  });

  it('documents every service in docs/rules-sources.md', () => {
    const undocumented = RULES_FILE.services.filter((s) => !sourcesDoc.includes(`\`${s.id}\``)).map((s) => s.id);
    expect(undocumented).toEqual([]);
  });

  it('uses no wildcard so broad that it catches unrelated traffic', () => {
    const broad = RULES_FILE.services.flatMap((s) => s.hosts.filter((h) => TOO_BROAD.has(h.split('/')[0] ?? '')).map((h) => `${s.id}: ${h}`));
    expect(broad).toEqual([]);
  });

  it('contains no forbidden wording', () => {
    for (const service of RULES_FILE.services) {
      expect(`${service.name} ${service.provider} ${service.note ?? ''}`).not.toMatch(FORBIDDEN_WORDING);
    }
  });

  it.each([
    ['https://fonts.googleapis.com/css2?family=Open+Sans', 'google-fonts', 'precedent'],
    ['https://fonts.gstatic.com/s/opensans/v40/x.woff2', 'google-fonts', 'precedent'],
    ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC', null, 'consent-required'],
    ['https://www.google-analytics.com/g/collect?v=2', null, 'consent-required'],
    ['https://region1.google-analytics.com/g/collect?v=2', null, 'consent-required'],
    ['https://connect.facebook.net/en_US/fbevents.js', null, 'consent-required'],
    ['https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js', null, 'grey-zone'],
    ['https://unpkg.com/aos@2.3.1/dist/aos.js', null, 'grey-zone'],
    ['https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js', null, 'grey-zone'],
  ] as const)('classifies %s', (url, id, riskClass) => {
    const match = DEFAULT_RULES.match(url);
    expect(match, url).not.toBeNull();
    if (id !== null) expect(match?.rule.id).toBe(id);
    expect(match?.rule.riskClass).toBe(riskClass);
  });

  it('leaves the site itself unmatched', () => {
    expect(DEFAULT_RULES.match('https://www.beispiel-handwerk.de/')).toBeNull();
  });
});

describe('consent tools data', () => {
  const ruleIds = new Set(RULES_FILE.services.map((s) => s.id));

  // The brief names these tools. Jimdo's built-in banner has no documented selector, so it is
  // found by the generic text heuristic of the probe (see docs/decisions.md).
  it('names the banner of the consent tools from the brief', () => {
    const ids = CONSENT_TOOLS_FILE.tools.map((t) => t.id);
    for (const id of ['usercentrics', 'cookiebot', 'borlabs-cookie', 'complianz', 'real-cookie-banner', 'ccm19', 'consentmanager', 'onetrust', 'shopify', 'wix']) {
      expect(ids, id).toContain(id);
    }
  });

  it('links only to consent services that exist in the rules data and are not flagged', () => {
    for (const tool of CONSENT_TOOLS_FILE.tools) {
      for (const serviceId of tool.serviceIds) {
        expect(ruleIds.has(serviceId), `${tool.id} -> ${serviceId}`).toBe(true);
        expect(RULES_FILE.services.find((s) => s.id === serviceId)?.riskClass, `${tool.id} -> ${serviceId}`).toBe('not-flagged');
      }
    }
  });

  it('has non-empty selectors and evidence links', () => {
    for (const tool of CONSENT_TOOLS_FILE.tools) {
      expect(tool.selectors.every((s) => s.trim() !== ''), tool.id).toBe(true);
      expect(tool.evidence.every((e) => /^https:\/\//.test(e)), tool.id).toBe(true);
    }
  });
});
