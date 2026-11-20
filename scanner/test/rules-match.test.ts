import { describe, expect, it } from 'vitest';
import { compileRules, parseHostPattern, parseRulesFile } from '../src/rules/match.ts';
import type { ServiceRule } from '../src/rules/types.ts';
import { loadTestRules } from './helpers.ts';

function rule(partial: Partial<ServiceRule> & { id: string; hosts: string[] }): ServiceRule {
  return {
    name: partial.id,
    provider: 'Test',
    category: 'analytics',
    riskClass: 'consent-required',
    dataLocation: 'unknown',
    sources: ['test-source'],
    ...partial,
  };
}

function file(services: unknown[]): unknown {
  return { version: 1, updated: '2026-11-20', services };
}

describe('parseHostPattern', () => {
  it('parses exact hosts, wildcards and path prefixes', () => {
    expect(parseHostPattern('fonts.gstatic.com')).toEqual({ raw: 'fonts.gstatic.com', host: 'fonts.gstatic.com', wildcard: false, pathPrefix: '' });
    expect(parseHostPattern('*.hotjar.com')).toMatchObject({ host: 'hotjar.com', wildcard: true, pathPrefix: '' });
    expect(parseHostPattern('www.google.com/recaptcha/')).toMatchObject({ host: 'www.google.com', wildcard: false, pathPrefix: '/recaptcha/' });
  });

  it.each(['https://fonts.gstatic.com', 'Fonts.gstatic.com', '*.com', 'fonts gstatic.com', '*hotjar.com', 'www.google.com/', 'www.google.com/a?b', 'localhost'])(
    'rejects %s',
    (raw) => {
      expect(() => parseHostPattern(raw)).toThrow();
    },
  );
});

describe('matching', () => {
  const rules = loadTestRules();
  const id = (url: string): string | null => rules.match(url)?.rule.id ?? null;

  it('matches exact hosts', () => {
    expect(id('https://fonts.googleapis.com/css2?family=Roboto')).toBe('google-fonts');
    expect(id('https://fonts.gstatic.com/s/roboto/v30/x.woff2')).toBe('google-fonts');
  });

  it('matches wildcards for subdomains but not for the apex', () => {
    expect(id('https://region1.google-analytics.com/g/collect')).toBe('google-analytics');
    expect(id('https://stats.g.doubleclick.net/j/collect')).toBe('doubleclick');
    expect(id('https://doubleclick.net/')).toBeNull();
  });

  it('prefers the longest path prefix on a shared host', () => {
    expect(id('https://www.google.com/recaptcha/api.js')).toBe('recaptcha');
    expect(id('https://www.google.com/maps/embed?pb=1')).toBe('google-maps');
    expect(id('https://www.google.com/search?q=x')).toBe('google-other');
  });

  it('ignores case, ports and query strings', () => {
    expect(id('HTTPS://FONTS.GOOGLEAPIS.COM:443/css?family=A')).toBe('google-fonts');
  });

  it('returns null for unknown hosts and non-http URLs', () => {
    expect(id('https://www.example.de/')).toBeNull();
    expect(id('data:font/woff2;base64,AAAA')).toBeNull();
  });

  it('prefers an exact host over a wildcard', () => {
    const compiled = compileRules(
      parseRulesFile(file([rule({ id: 'broad', hosts: ['*.example.com'] }), rule({ id: 'narrow', hosts: ['api.example.com'] })])),
    );
    expect(compiled.match('https://api.example.com/x')?.rule.id).toBe('narrow');
    expect(compiled.match('https://cdn.example.com/x')?.rule.id).toBe('broad');
  });

  it('prefers the most specific wildcard', () => {
    const compiled = compileRules(
      parseRulesFile(file([rule({ id: 'outer', hosts: ['*.example.com'] }), rule({ id: 'inner', hosts: ['*.eu.example.com'] })])),
    );
    expect(compiled.match('https://a.eu.example.com/')?.rule.id).toBe('inner');
    expect(compiled.match('https://eu.example.com/')?.rule.id).toBe('outer');
  });

  it('counts host patterns', () => {
    expect(rules.patternCount).toBe(20);
  });
});

describe('parseRulesFile', () => {
  it('accepts a valid file', () => {
    expect(() => parseRulesFile(file([rule({ id: 'ok', hosts: ['a.example.com'] })]))).not.toThrow();
  });

  it('requires a source for every class except grey-zone', () => {
    expect(() => parseRulesFile(file([rule({ id: 'no-source', hosts: ['a.example.com'], sources: [] })]))).toThrow(/needs at least one source/);
    expect(() =>
      parseRulesFile(file([rule({ id: 'grey', hosts: ['a.example.com'], sources: [], riskClass: 'grey-zone' })])),
    ).not.toThrow();
  });

  it('rejects duplicate ids and duplicate host patterns', () => {
    expect(() => parseRulesFile(file([rule({ id: 'a', hosts: ['a.example.com'] }), rule({ id: 'a', hosts: ['b.example.com'] })]))).toThrow(/duplicate id/);
    expect(() => parseRulesFile(file([rule({ id: 'a', hosts: ['x.example.com'] }), rule({ id: 'b', hosts: ['x.example.com'] })]))).toThrow(
      /already used by a/,
    );
  });

  it('rejects unknown categories, risk classes and bad ids', () => {
    expect(() => parseRulesFile(file([{ ...rule({ id: 'a', hosts: ['a.example.com'] }), category: 'magic' }]))).toThrow(/unknown category/);
    expect(() => parseRulesFile(file([{ ...rule({ id: 'a', hosts: ['a.example.com'] }), riskClass: 'illegal' }]))).toThrow(/unknown riskClass/);
    expect(() => parseRulesFile(file([rule({ id: 'Not_Kebab', hosts: ['a.example.com'] })]))).toThrow(/kebab-case/);
  });

  it('reports every problem at once', () => {
    try {
      parseRulesFile(file([rule({ id: 'Bad Id', hosts: ['https://x'], sources: [] })]));
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/3 problem\(s\)/);
    }
  });
});
