import { domainToUnicode } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePunycodeLabel, displayHostOf, hostToUnicode, normalizeSiteAddress } from '../src/report/site-address.ts';

describe('normalizeSiteAddress', () => {
  it.each([
    ['beispiel.de', 'https://beispiel.de/'],
    ['  HTTPS://WWW.Beispiel.DE/pfad/seite?x=1#oben  ', 'https://www.beispiel.de/'],
    ['http://beispiel.de', 'http://beispiel.de/'],
    ['beispiel.de.', 'https://beispiel.de/'],
    ['https://beispiel.de:443/', 'https://beispiel.de/'],
    ['http://beispiel.de:443', 'http://beispiel.de:443/'],
    ['müller-bäckerei.de', 'https://xn--mller-bckerei-hfb76a.de/'],
    ['93.184.215.14', 'https://93.184.215.14/'],
  ])('%s → %s', (input, expected) => {
    const result = normalizeSiteAddress(input);
    expect(result).toMatchObject({ ok: true, url: expected });
  });

  it.each([
    ['', 'invalid-input', null],
    ['beispiel .de', 'invalid-input', null],
    [`https://beispiel.de/${'x'.repeat(2100)}`, 'invalid-input', null],
    ['localhost', 'not-allowed', 'host-name'],
    ['localhost:3000', 'not-allowed', 'host-name'],
    ['intranet', 'not-allowed', 'host-name'],
    ['drucker.local', 'not-allowed', 'host-name'],
    ['127.0.0.1', 'not-allowed', 'address'],
    ['0x7f.1', 'not-allowed', 'address'],
    ['http://10.0.0.1/admin', 'not-allowed', 'address'],
    ['http://[::1]/', 'not-allowed', 'address'],
    ['beispiel.de:8080', 'not-allowed', 'port'],
    ['ftp://beispiel.de', 'not-allowed', 'scheme'],
    ['javascript:alert(1)', 'not-allowed', 'scheme'],
    ['https://nutzer:geheim@beispiel.de/', 'not-allowed', 'credentials'],
    ['https://', 'invalid-url', 'invalid-url'],
  ])('refuses %j', (input, error, rejection) => {
    const result = normalizeSiteAddress(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
      expect(result.rejection).toBe(rejection);
    }
  });
});

describe('punycode for the display host', () => {
  it.each(['xn--mller-kva.de', 'xn--bcher-kva.example', 'xn--mller-bckerei-hfb76a.de', 'www.xn--strae-oqa.de', 'xn--egbpdaj6bu4bxfgehfvwxn.test', 'xn--fiqs8s.example', 'plain.example', 'xn--ls8h.la'])('%s decodes as Node does', (host) => {
    expect(hostToUnicode(host)).toBe(domainToUnicode(host));
  });

  it('keeps a label that is not valid punycode', () => {
    expect(decodePunycodeLabel('a-b-9999999999999')).toBeNull();
    expect(hostToUnicode('xn--a-9999999999999.de')).toBe('xn--a-9999999999999.de');
  });

  it('shows the host without www. and in Unicode', () => {
    expect(displayHostOf('www.xn--mller-kva.de')).toBe('müller.de');
    expect(displayHostOf('shop.beispiel.de')).toBe('shop.beispiel.de');
    expect(displayHostOf('www.de')).toBe('www.de');
  });
});
