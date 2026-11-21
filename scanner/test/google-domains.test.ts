import { describe, expect, it } from 'vitest';
import { analyzeThirdParty } from '../src/analyzers/third-party.ts';
import { DEFAULT_RULES, GOOGLE_DOMAINS_FILE, RULES_FILE } from '../src/data.ts';
import { googleCanonicalHost, parseGoogleDomainsFile } from '../src/domain/google.ts';
import { compileRules, parseRulesFile } from '../src/rules/match.ts';
import { makeCapture, SITE } from './helpers.ts';

const canonical = googleCanonicalHost(GOOGLE_DOMAINS_FILE);

describe('Google country domains data', () => {
  it('lists the country domains from Google\'s own list, without google.com', () => {
    expect(GOOGLE_DOMAINS_FILE.source).toBe('https://www.google.com/supported_domains');
    expect(GOOGLE_DOMAINS_FILE.domains).toHaveLength(186);
    for (const domain of ['google.de', 'google.it', 'google.nl', 'google.at', 'google.ch', 'google.fr', 'google.co.uk', 'google.com.au']) {
      expect(GOOGLE_DOMAINS_FILE.domains, domain).toContain(domain);
    }
    expect(GOOGLE_DOMAINS_FILE.domains).not.toContain('google.com');
  });

  it('rejects google.com, duplicates, subdomains and foreign domains', () => {
    const file = (domains: unknown[]) => ({ version: 1, updated: '2026-11-21', source: 'https://www.google.com/supported_domains', canonical: 'google.com', domains });
    expect(() => parseGoogleDomainsFile(file(['google.de']))).not.toThrow();
    expect(() => parseGoogleDomainsFile(file(['google.com']))).toThrow(/canonical/);
    expect(() => parseGoogleDomainsFile(file(['google.de', 'google.de']))).toThrow(/duplicate/);
    expect(() => parseGoogleDomainsFile(file(['www.google.de']))).toThrow(/invalid domain/);
    expect(() => parseGoogleDomainsFile(file(['googlex.de']))).toThrow(/invalid domain/);
  });
});

describe('googleCanonicalHost', () => {
  it('maps hosts on Google country domains to the same host on google.com', () => {
    expect(canonical('www.google.it')).toBe('www.google.com');
    expect(canonical('www.google.de')).toBe('www.google.com');
    expect(canonical('WWW.GOOGLE.NL.')).toBe('www.google.com');
    expect(canonical('maps.google.co.uk')).toBe('maps.google.com');
    expect(canonical('google.com.au')).toBe('google.com');
  });

  it('leaves google.com and every other host as it is', () => {
    for (const host of ['www.google.com', 'www.googletagmanager.com', 'fonts.googleapis.com', 'www.google-analytics.com', 'notgoogle.de', 'google.example.de', 'www.example.de']) {
      expect(canonical(host), host).toBe(host);
    }
  });
});

describe('matching Google country domains', () => {
  const id = (url: string) => DEFAULT_RULES.match(url)?.rule.id ?? null;

  it('gives the same service for every country domain', () => {
    for (const host of ['www.google.com', 'www.google.de', 'www.google.it', 'www.google.nl', 'www.google.co.uk']) {
      expect(id(`https://${host}/ads/ga-audiences?v=1&t=sr&tid=G-TEST`), host).toBe('google-analytics-advertising-features');
      expect(id(`https://${host}/pagead/1p-conversion/123/?random=1`), host).toBe('google-ads');
      expect(id(`https://${host}/recaptcha/api.js`), host).toBe('google-recaptcha');
    }
    expect(id('https://maps.google.it/maps?q=x')).toBe('google-maps');
  });

  it('names only google.com in the rules data', () => {
    expect(() => compileRules(RULES_FILE, { canonicalHost: canonical })).not.toThrow();
    const raw = {
      version: 1,
      updated: '2026-11-21',
      services: [{ id: 'g', name: 'G', provider: 'Google', category: 'advertising', riskClass: 'grey-zone', dataLocation: 'unknown', hosts: ['www.google.de/ads/'], sources: [] }],
    };
    expect(() => compileRules(parseRulesFile(raw), { canonicalHost: canonical })).toThrow(/matched through www\.google\.com/);
    expect(() => compileRules(parseRulesFile(raw))).not.toThrow();
  });

  it('puts requests to several country domains into one service', () => {
    const analysis = analyzeThirdParty(
      makeCapture({
        requests: [
          { url: SITE, resourceType: 'document', isNavigation: true },
          { url: 'https://www.google.it/ads/ga-audiences?v=1&tid=G-TEST', resourceType: 'image', status: 200 },
          { url: 'https://www.google.de/ads/ga-audiences?v=1&tid=G-TEST', resourceType: 'image', status: 200 },
          { url: 'https://www.google.it/js/th/abc.js', resourceType: 'script', status: 200 },
          { url: 'https://www.google.com/js/th/abc.js', resourceType: 'script', status: 200 },
        ],
      }),
      DEFAULT_RULES,
    );
    expect(analysis.services.map((s) => [s.key, s.requestCount])).toEqual(
      expect.arrayContaining([
        ['google-analytics-advertising-features', 2],
        ['unknown:google.com', 2],
      ]),
    );
    expect(analysis.services.map((s) => s.key).filter((k) => k.includes('google.it') || k.includes('google.de'))).toEqual([]);
  });
});
