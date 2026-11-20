import { describe, expect, it } from 'vitest';
import { parseSitesFile } from '../src/local/sites-file.ts';

describe('parseSitesFile', () => {
  it('reads url, group and platform and numbers the sites anonymously', () => {
    const { sites, errors } = parseSitesFile(
      [
        '# test sites',
        '',
        'https://www.shop-beispiel.de/   shop  shopify   # Landshut',
        'https://praxis-beispiel.de/\tservice\twordpress',
        'https://maler-beispiel.jimdosite.com/',
      ].join('\r\n'),
    );
    expect(errors).toEqual([]);
    expect(sites).toEqual([
      { label: 'Site 01', number: '01', url: 'https://www.shop-beispiel.de/', kind: 'shop', platform: 'shopify', line: 3 },
      { label: 'Site 02', number: '02', url: 'https://praxis-beispiel.de/', kind: 'service', platform: 'wordpress', line: 4 },
      { label: 'Site 03', number: '03', url: 'https://maler-beispiel.jimdosite.com/', kind: null, platform: null, line: 5 },
    ]);
  });

  it('keeps # inside URLs that are not comments', () => {
    const { sites } = parseSitesFile('https://www.beispiel.de/#start shop');
    expect(sites[0]?.url).toBe('https://www.beispiel.de/#start');
  });

  it('reports invalid lines, other schemes, extra columns and duplicates', () => {
    const { sites, errors } = parseSitesFile(
      ['not-a-url shop', 'ftp://files.beispiel.de/ shop', 'https://a.beispiel.de/ shop x y', 'https://b.beispiel.de/', 'https://b.beispiel.de/'].join('\n'),
    );
    expect(sites.map((s) => s.url)).toEqual(['https://a.beispiel.de/', 'https://b.beispiel.de/']);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatch(/line 1: not a URL/);
    expect(errors[1]).toMatch(/line 2: only http and https/);
    expect(errors[2]).toMatch(/line 3: unexpected extra columns/);
    expect(errors[3]).toMatch(/line 5: duplicate site/);
  });
});
