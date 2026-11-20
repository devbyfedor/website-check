import { describe, expect, it } from 'vitest';
import { firstPartySites, hostOf, isIpAddress, siteOfHost, siteOfUrl } from '../src/domain/site.ts';

describe('hostOf', () => {
  it('returns the lower-case host of http(s) and ws(s) URLs', () => {
    expect(hostOf('https://WWW.Example.DE/path?q=1')).toBe('www.example.de');
    expect(hostOf('http://example.de:8080/')).toBe('example.de');
    expect(hostOf('wss://chat.example.com/socket')).toBe('chat.example.com');
  });

  it('drops a trailing dot', () => {
    expect(hostOf('https://www.example.de./')).toBe('www.example.de');
  });

  it('returns null for other schemes and invalid URLs', () => {
    expect(hostOf('data:image/png;base64,AAAA')).toBeNull();
    expect(hostOf('blob:https://example.de/123')).toBeNull();
    expect(hostOf('about:blank')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });

  it('converts international domain names to punycode', () => {
    expect(hostOf('https://www.bäckerei-müller.de/')).toBe('www.xn--bckerei-mller-bfb28a.de');
  });
});

describe('siteOfHost (registrable domain)', () => {
  it('strips subdomains down to the registrable domain', () => {
    expect(siteOfHost('www.example.de')).toBe('example.de');
    expect(siteOfHost('cdn.static.example.de')).toBe('example.de');
    expect(siteOfHost('fonts.gstatic.com')).toBe('gstatic.com');
  });

  it('respects multi-label public suffixes', () => {
    expect(siteOfHost('shop.example.co.uk')).toBe('example.co.uk');
    expect(siteOfHost('www.example.com.au')).toBe('example.com.au');
  });

  it('respects private suffixes of the Public Suffix List, as browsers do', () => {
    expect(siteOfHost('roesterei.myshopify.com')).toBe('roesterei.myshopify.com');
    expect(siteOfHost('beispiel.github.io')).toBe('beispiel.github.io');
    expect(siteOfHost('cdn.shopify.com')).toBe('shopify.com');
    // googleapis.com is a private suffix, so each Google API host is its own site
    expect(siteOfHost('fonts.googleapis.com')).toBe('fonts.googleapis.com');
    // jimdosite.com and jimdofree.com are not in the list: all Jimdo free sites share one site
    expect(siteOfHost('www.maler-muster.jimdosite.com')).toBe('jimdosite.com');
  });

  it('keeps IP addresses and hosts without a public suffix as they are', () => {
    expect(siteOfHost('192.0.2.10')).toBe('192.0.2.10');
    expect(isIpAddress('[2001:db8::1]')).toBe(true);
    expect(siteOfHost('localhost')).toBe('localhost');
  });

  it('works on URLs', () => {
    expect(siteOfUrl('https://www.example.de/impressum')).toBe('example.de');
    expect(siteOfUrl('data:text/plain,hi')).toBeNull();
  });
});

describe('firstPartySites', () => {
  it('contains the site of the final URL', () => {
    const sites = firstPartySites({ requestedUrl: 'https://www.example.de/', finalUrl: 'https://www.example.de/', mainDocument: null });
    expect([...sites]).toEqual(['example.de']);
  });

  it('includes every hop of the redirect chain', () => {
    const sites = firstPartySites({
      requestedUrl: 'http://example-alt.de/',
      finalUrl: 'https://www.example.de/',
      mainDocument: {
        status: 200,
        headers: {},
        redirectChain: [
          { url: 'http://example-alt.de/', status: 301 },
          { url: 'https://example-alt.de/', status: 302 },
        ],
      },
    });
    expect([...sites].sort()).toEqual(['example-alt.de', 'example.de']);
  });

  it('still knows the requested site when navigation failed', () => {
    const sites = firstPartySites({ requestedUrl: 'https://www.example.de/', finalUrl: null, mainDocument: null });
    expect([...sites]).toEqual(['example.de']);
  });
});
