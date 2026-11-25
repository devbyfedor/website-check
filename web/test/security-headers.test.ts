import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCsp, checkHsts, checkPermissionsPolicy, checkReferrerPolicy, checkXcto } from '@website-check/scanner';
import { pageCsp, PERMISSIONS_POLICY, SITE_HEADERS } from '../../worker/src/api/site-headers';
import { inlineHashes, MAX_LINE, routesOf, writeHeaders } from '../scripts/security-headers';
import { headersFor, parseHeaderRules } from '../scripts/static-server';

// Session B5 part 2: the security headers of our own pages (web/scripts/security-headers.ts writes web/out/_headers
// after the build; web/scripts/static-server.ts applies it in every check the way Workers Static Assets does).

const sha = (s: string) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`;

describe('the hashes of a page', () => {
  it('hashes each inline script as written, not one with src or of a data type', () => {
    const html = '<script src="/a.js"></script><script>self.__next_f=1</script><script id="_R_">x()</script><script type="application/json">{"a":1}</script>';
    expect(inlineHashes(html).scripts).toEqual([sha('self.__next_f=1'), sha('x()')].sort());
  });

  it('hashes style elements and the decoded value of every distinct style attribute', () => {
    const html = '<style>body{margin:0}</style><p style="animation-delay:.2s"></p><span style="animation-delay:.2s"></span><div style="font-family:&quot;Segoe UI&quot;,sans-serif"></div>';
    const h = inlineHashes(html);
    expect(h.styles).toEqual([sha('body{margin:0}')]);
    expect(h.attributes).toEqual([sha('animation-delay:.2s'), sha('font-family:"Segoe UI",sans-serif')].sort());
  });

  it('gives a CSP without unsafe-inline and unsafe-eval, with unsafe-hashes only for style attributes', () => {
    const plain = pageCsp({ scripts: ['sha256-a'], styles: [], attributes: [] });
    expect(plain).toContain("script-src 'self' 'sha256-a'");
    expect(plain).toContain("style-src 'self';");
    expect(plain).toContain("frame-ancestors 'none'");
    expect(plain).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/);
    expect(pageCsp({ scripts: [], styles: [], attributes: ['sha256-b'] })).toContain("style-src 'self' 'unsafe-hashes' 'sha256-b'");
  });
});

describe('the paths of a page', () => {
  it('maps the files of the static export to the paths Workers serve them under', () => {
    expect(routesOf('index.html')).toEqual(['/', '/index.html']);
    expect(routesOf('bfsg.html')).toEqual(['/bfsg', '/bfsg.html']);
    expect(routesOf(join('bericht', 'beispiel', 'gekuerzt.html'))).toEqual(['/bericht/beispiel/gekuerzt', '/bericht/beispiel/gekuerzt.html']);
  });
});

describe('the _headers file', () => {
  it('gives every path the site headers and the CSP of 404.html, every page its own CSP, the report no-referrer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wc-headers-'));
    try {
      await writeFile(join(dir, '404.html'), '<script>nf()</script><p style="margin:0">404</p>');
      await writeFile(join(dir, 'index.html'), '<script>home()</script>');
      await writeFile(join(dir, 'bericht.html'), '<script>report()</script>');
      const result = await writeHeaders(dir);
      expect(result.problems).toEqual([]);
      expect(result.longest).toBeLessThanOrEqual(MAX_LINE);
      const rules = parseHeaderRules(await readFile(join(dir, '_headers'), 'utf8'));
      const home = headersFor(rules, '/');
      expect(home.get('content-security-policy')).toBe(pageCsp(inlineHashes('<script>home()</script>')));
      expect(home.get('strict-transport-security')).toBe(SITE_HEADERS['Strict-Transport-Security']);
      expect(home.get('x-frame-options')).toBe('DENY');
      const unknown = headersFor(rules, '/gibt-es-nicht');
      expect(unknown.get('content-security-policy')).toContain(sha('nf()'));
      expect(unknown.get('content-security-policy')).toContain("'unsafe-hashes'");
      const report = headersFor(rules, '/bericht');
      expect(report.get('referrer-policy')).toBe('no-referrer');
      expect(report.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(report.get('content-security-policy')).toBe(pageCsp(inlineHashes('<script>report()</script>')));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('counts with our own scanner: CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, and HSTS over HTTPS', () => {
    const csp = pageCsp({ scripts: ['sha256-a'], styles: [], attributes: [] });
    for (const c of [
      checkCsp(csp, undefined, null),
      checkXcto(SITE_HEADERS['X-Content-Type-Options']),
      checkReferrerPolicy(SITE_HEADERS['Referrer-Policy'], null),
      checkPermissionsPolicy(PERMISSIONS_POLICY, undefined),
      checkHsts(SITE_HEADERS['Strict-Transport-Security'], true),
    ])
      expect(c.counts, c.key).toBe(true);
  });

  it('the rules of the static server behave like the asset worker: later rules append, ! removes', () => {
    const rules = parseHeaderRules('/*\n  A: 1\n  B: 1\n/x\n  B: 2\n  ! A\n  A: 3\n# comment\n/y/*\n  C: 4\n');
    const x = headersFor(rules, '/x');
    expect([x.get('a'), x.get('b'), x.get('c')]).toEqual(['3', '1, 2', null]);
    expect(headersFor(rules, '/y/z').get('c')).toBe('4');
    expect(headersFor(rules, '/xx').get('a')).toBe('1');
  });
});
