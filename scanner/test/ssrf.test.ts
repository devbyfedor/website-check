import { describe, expect, it, vi } from 'vitest';
import { formatIPv4, hostNameRejection, parseAddress, parseIPv4, parseIPv6 } from '../src/security/address.ts';
import { createDohResolver } from '../src/security/doh.ts';
import { checkReadDocument, installNavigationGuard, type CdpSessionLike } from '../src/security/navigation-guard.ts';
import { createUrlGuard, precheckUrl, safeFetch, SSRF_LIMITS, type Resolver, type UrlVerdict } from '../src/security/ssrf.ts';

/**
 * Session A5: the SSRF protection without network and without a browser. Name resolution is a
 * fake (`resolverOf`), `fetch` is a fake that records every request it gets.
 */

const PUBLIC_V4 = '93.184.215.14';
const PUBLIC_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c';

function resolverOf(records: Record<string, string[] | Error>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const resolve = (async (hostname: string) => {
    calls.push(hostname);
    const answer = records[hostname];
    if (answer instanceof Error) throw answer;
    return answer ?? [PUBLIC_V4];
  }) as Resolver & { calls: string[] };
  resolve.calls = calls;
  return resolve;
}

const guardOf = (records: Record<string, string[] | Error> = {}) => createUrlGuard({ resolve: resolverOf(records) });

async function refusal(url: string, records: Record<string, string[] | Error> = {}): Promise<Extract<UrlVerdict, { allowed: false }>> {
  const verdict = await guardOf(records).check(url);
  if (verdict.allowed) throw new Error(`expected ${url} to be refused`);
  return verdict;
}

describe('URL rules without DNS', () => {
  it.each(['ftp://example.de/', 'file:///etc/passwd', 'gopher://example.de/', 'javascript:alert(1)', 'data:text/html,hi', 'ws://example.de/', 'chrome://settings'])(
    'refuses the scheme of %s',
    async (url) => {
      expect((await refusal(url)).rejection).toBe('scheme');
    },
  );

  it('refuses user names and passwords in the address', async () => {
    expect((await refusal('http://user:secret@example.de/')).rejection).toBe('credentials');
    expect((await refusal('https://user@example.de/')).rejection).toBe('credentials');
  });

  it('allows only ports 80 and 443', async () => {
    for (const url of ['http://example.de:8080/', 'https://example.de:8443/', 'http://example.de:22/', 'http://example.de:0/', 'http://example.de:65535/']) {
      expect((await refusal(url)).rejection, url).toBe('port');
    }
    const guard = guardOf();
    for (const url of ['http://example.de/', 'https://example.de/', 'http://example.de:443/', 'https://example.de:80/', 'HTTPS://EXAMPLE.DE:443/']) {
      expect((await guard.check(url)).allowed, url).toBe(true);
    }
  });

  it('refuses text that is no absolute URL', async () => {
    expect((await refusal('example.de')).rejection).toBe('invalid-url');
    expect((await refusal('http://')).rejection).toBe('invalid-url');
    expect((await refusal('http://1.2.3.999/')).rejection).toBe('invalid-url');
  });
});

describe('unusual notations of IPv4 addresses', () => {
  it.each([
    ['decimal', 'http://2130706433/'],
    ['octal', 'http://0177.0.0.1/'],
    ['octal with long zeros', 'http://0177.0000.0000.0001/'],
    ['hexadecimal parts', 'http://0x7f.0x0.0x0.0x1/'],
    ['one hexadecimal number', 'http://0x7f000001/'],
    ['shortened, two parts', 'http://127.1/'],
    ['shortened, three parts', 'http://127.0.1/'],
    ['hexadecimal and shortened', 'http://0x7f.1/'],
    ['trailing dot', 'http://127.0.0.1./'],
    ['IDN full-width digits and dot', 'http://１２７．０．０．１/'],
  ])('refuses 127.0.0.1 written %s', async (_name, url) => {
    const verdict = await refusal(url);
    expect(verdict.rejection).toBe('address');
    expect(verdict.addressRejection).toBe('loopback');
    expect(verdict.detail).toContain('127.0.0.1');
  });

  it('parses every notation itself, without relying on the URL parser', () => {
    for (const text of ['2130706433', '0177.0.0.1', '0x7f.0.0.1', '0x7f000001', '127.1', '127.0.1', '0x7F.1', '017700000001', '127.0.0.1.']) {
      expect(formatIPv4(parseIPv4(text) as number), text).toBe('127.0.0.1');
    }
    expect(formatIPv4(parseIPv4('0') as number)).toBe('0.0.0.0');
    expect(formatIPv4(parseIPv4('0xa9fea9fe') as number)).toBe('169.254.169.254');
    for (const text of ['1.2.3.256', '256.1.1.1', '1.2.3.4.5', '08.0.0.1', '0x', 'example.de', '1..2.3', '4294967296']) {
      expect(parseIPv4(text) === null || text === '0x', text).toBe(true);
    }
    expect(parseIPv4('0x')).toBe(0);
  });
});

describe('non-public IPv4 ranges', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['0.1.2.3', 'unspecified'],
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.178.1', 'private'],
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.254', 'cgnat'],
    ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['192.0.0.8', 'protocol-assignments'],
    ['192.0.2.10', 'documentation'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['198.18.0.1', 'benchmarking'],
    ['192.88.99.1', 'deprecated-relay'],
    ['224.0.0.251', 'multicast'],
    ['239.255.255.250', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'broadcast'],
  ])('refuses %s (%s)', async (ip, reason) => {
    expect(parseAddress(ip)?.rejection).toBe(reason);
    expect((await refusal(`http://${ip}/`)).addressRejection).toBe(reason);
  });

  it('allows public addresses just outside the ranges', async () => {
    const guard = guardOf();
    for (const ip of ['9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0', '169.253.255.255', '198.17.255.255', '198.20.0.0', '223.255.255.255', '1.1.1.1', PUBLIC_V4]) {
      expect(parseAddress(ip)?.rejection, ip).toBeNull();
      expect((await guard.check(`https://${ip}/`)).allowed, ip).toBe(true);
    }
  });
});

describe('IPv6 addresses', () => {
  it.each([
    ['[::1]', 'loopback'],
    ['[0:0:0:0:0:0:0:1]', 'loopback'],
    ['[::]', 'unspecified'],
    ['[fe80::1]', 'link-local'],
    ['[febf:ffff::1]', 'link-local'],
    ['[fc00::1]', 'unique-local'],
    ['[fd12:3456:789a::1]', 'unique-local'],
    ['[fec0::1]', 'site-local'],
    ['[ff02::1]', 'multicast'],
    ['[2001:db8::1]', 'documentation'],
    ['[3fff::1]', 'documentation'],
    ['[100::1]', 'discard-only'],
    ['[2001:2::1]', 'protocol-assignments'],
    ['[4000::1]', 'not-global-unicast'],
  ])('refuses %s (%s)', async (host, reason) => {
    expect((await refusal(`http://${host}/`)).addressRejection).toBe(reason);
  });

  it.each([
    ['IPv4-mapped, dotted', '[::ffff:127.0.0.1]'],
    ['IPv4-mapped, hex', '[::ffff:7f00:1]'],
    ['IPv4-mapped, full form', '[0:0:0:0:0:ffff:127.0.0.1]'],
    ['IPv4-mapped private', '[::ffff:10.0.0.1]'],
    ['IPv4-mapped metadata address', '[::ffff:169.254.169.254]'],
    ['IPv4-compatible', '[::127.0.0.1]'],
    ['IPv4-translated', '[::ffff:0:7f00:1]'],
    ['NAT64', '[64:ff9b::7f00:1]'],
    ['NAT64 local use', '[64:ff9b:1::a00:1]'],
    ['6to4', '[2002:7f00:1::1]'],
    ['Teredo', '[2001:0:4136:e378:8000:63bf:3fff:fdd2]'],
    ['IPv4-mapped public address too', '[::ffff:93.184.215.14]'],
  ])('refuses IPv4 inside IPv6: %s', async (_name, host) => {
    expect((await refusal(`http://${host}/`)).addressRejection).toBe('ipv4-in-ipv6');
  });

  it('allows public global unicast IPv6 and parses compressed forms', async () => {
    expect((await guardOf().check(`https://[${PUBLIC_V6}]/`)).allowed).toBe(true);
    expect((await guardOf().check('https://[2606:4700:4700::1111]/')).allowed).toBe(true);
    expect(parseIPv6('2606:4700:4700::1111')).toEqual([0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    for (const text of ['fe80::1%eth0', '1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', '::1.2.3', ':::1', '1:2:3:4:5:6:7']) expect(parseIPv6(text), text).toBeNull();
  });
});

describe('host names', () => {
  it.each(['http://localhost/', 'http://LOCALHOST./', 'http://app.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://router.home.arpa/', 'http://intranet/', 'http://shop.test/', 'http://www.example/', 'http://x.invalid/', 'http://abc.onion/', 'http://1.0.0.127.in-addr.arpa/', 'http://ⓛocalhost/'])(
    'refuses the special-use or single-label name %s without asking DNS',
    async (url) => {
      const resolve = resolverOf({});
      const verdict = await createUrlGuard({ resolve }).check(url);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.rejection).toBe('host-name');
      expect(resolve.calls).toEqual([]);
    },
  );

  it('keeps ordinary names', () => {
    for (const name of ['www.example.de', 'shop.example.co.uk', 'xn--mller-kva.de', 'localhost-shop.de', 'my.local-bakery.de', 'test.de', 'internal.example.de']) expect(hostNameRejection(name), name).toBeNull();
  });

  it.each(['http://localhost../', 'http://printer.local../', 'http://intranet../', 'http://shop.example.de../', 'http://shop..example.de/'])(
    'refuses %s with an empty label without asking DNS (review of A5 part 2)',
    async (url) => {
      const resolve = resolverOf({});
      const verdict = await createUrlGuard({ resolve }).check(url);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.rejection).toBe('host-name');
      expect(resolve.calls).toEqual([]);
    },
  );

  it('keeps one trailing dot, the root of DNS', async () => {
    expect((await guardOf().check('https://shop.example.de./')).allowed).toBe(true);
  });
});

describe('names that resolve to internal addresses', () => {
  it.each([
    ['a loopback A record', { 'localtest.example.de': ['127.0.0.1'] }, 'loopback'],
    ['the cloud metadata address', { 'meta.example.de': ['169.254.169.254'] }, 'link-local'],
    ['a private address among public ones', { 'mixed.example.de': [PUBLIC_V4, '10.0.0.5'] }, 'private'],
    ['a CGNAT address', { 'carrier.example.de': ['100.100.100.100'] }, 'cgnat'],
    ['an IPv6 loopback AAAA record', { 'six.example.de': [PUBLIC_V4, '::1'] }, 'loopback'],
    ['an IPv4-mapped AAAA record', { 'mapped.example.de': ['::ffff:192.168.0.1'] }, 'ipv4-in-ipv6'],
    ['a unique local AAAA record', { 'ula.example.de': ['fd00::1'] }, 'unique-local'],
  ])('refuses a name with %s', async (_name, records, reason) => {
    const host = Object.keys(records)[0] as string;
    const verdict = await refusal(`https://${host}/`, records);
    expect(verdict.rejection).toBe('address');
    expect(verdict.addressRejection).toBe(reason);
  });

  it('refuses a name without addresses, a failing resolver and a resolver answer that is no address', async () => {
    expect((await refusal('https://nx.example.de/', { 'nx.example.de': [] })).rejection).toBe('unresolved');
    expect((await refusal('https://flaky.example.de/', { 'flaky.example.de': new Error('SERVFAIL') })).rejection).toBe('dns-error');
    expect((await refusal('https://odd.example.de/', { 'odd.example.de': ['not-an-ip'] })).rejection).toBe('dns-error');
  });

  it('allows a name whose every address is public, and resolves each name once per guard', async () => {
    const resolve = resolverOf({ 'www.example.de': [PUBLIC_V4, PUBLIC_V6] });
    const guard = createUrlGuard({ resolve });
    const first = await guard.check('https://www.example.de/');
    expect(first).toMatchObject({ allowed: true, addresses: [PUBLIC_V4, PUBLIC_V6], exempt: false });
    await guard.check('http://WWW.EXAMPLE.DE./impressum');
    expect(resolve.calls).toEqual(['www.example.de']);
  });

  it('the exemption of the tests skips host, port and address, never scheme and credentials', async () => {
    const guard = createUrlGuard({ resolve: resolverOf({}), exempt: (url) => url.hostname === 'www.shop.test' });
    expect((await guard.check('http://www.shop.test:4123/')).allowed).toBe(true);
    expect((await guard.check('ftp://www.shop.test/')).allowed).toBe(false);
    expect((await guard.check('http://a:b@www.shop.test/')).allowed).toBe(false);
    expect((await guard.check('http://127.0.0.1:4123/')).allowed).toBe(false);
    expect(precheckUrl('http://www.shop.test/', () => false)).toMatchObject({ allowed: false, rejection: 'host-name' });
  });
});

// ---------------------------------------------------------------------------------------------

interface FakeAnswer {
  status: number;
  location?: string;
  headers?: Record<string, string>;
  /** Body chunks; each is sent as its own chunk. */
  chunks?: Uint8Array[];
  /** Never answer (until the signal aborts). */
  hang?: boolean;
  /** Send the chunks, then stall the body forever. */
  stallBody?: boolean;
}

function fakeFetch(answers: Record<string, FakeAnswer | Error>) {
  const calls: { url: string; init: RequestInit }[] = [];
  let cancelled = 0;
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected request ${url}`);
    if (answer instanceof Error) throw answer;
    const signal = init?.signal ?? undefined;
    if (answer.hang) {
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    const chunks = answer.chunks ?? [];
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(chunks[index] as Uint8Array);
          index += 1;
          return;
        }
        if (answer.stallBody) return new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
        controller.close();
        return undefined;
      },
      cancel() {
        cancelled += 1;
      },
    });
    const headers: Record<string, string> = { ...(answer.headers ?? {}) };
    if (answer.location !== undefined) headers['location'] = answer.location;
    return new Response(answer.status === 204 || answer.status === 304 ? null : body, { status: answer.status, headers });
  });
  return { fetch: fn as unknown as typeof fetch, calls, cancelledCount: () => cancelled };
}

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(65);

describe('safeFetch', () => {
  it('reads a normal answer and sends only harmless headers', async () => {
    const f = fakeFetch({ 'https://www.example.de/': { status: 200, chunks: [bytes(10), bytes(5)] } });
    const result = await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: f.fetch, userAgent: 'UA', acceptLanguage: 'de-DE' });
    expect(result).toMatchObject({ outcome: 'ok', status: 200, bodyBytes: 15, finalUrl: 'https://www.example.de/' });
    expect(f.calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'manual' });
    const sent = Object.keys(f.calls[0]?.init.headers as Record<string, string>).sort();
    expect(sent).toEqual(['accept', 'accept-language', 'user-agent']);
    expect(f.calls[0]?.init).not.toHaveProperty('credentials');
  });

  it('checks every redirect target before requesting it: a redirect to 127.0.0.1 is never sent', async () => {
    const f = fakeFetch({ 'https://www.example.de/': { status: 302, location: 'http://127.0.0.1/admin' } });
    const result = await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: f.fetch });
    expect(result.outcome).toBe('not-allowed');
    expect(result.rejection?.addressRejection).toBe('loopback');
    expect(result.finalUrl).toBe('http://127.0.0.1/admin');
    expect(f.calls.map((c) => c.url)).toEqual(['https://www.example.de/']);
  });

  it('refuses a redirect to a name that resolves to a private address, after a relative hop', async () => {
    const f = fakeFetch({
      'https://www.example.de/': { status: 301, location: '/de/' },
      'https://www.example.de/de/': { status: 307, location: 'https://intern.example.de/' },
    });
    const result = await safeFetch('https://www.example.de/', { guard: guardOf({ 'intern.example.de': ['192.168.1.10'] }), fetch: f.fetch });
    expect(result.outcome).toBe('not-allowed');
    expect(result.rejection?.addressRejection).toBe('private');
    expect(result.redirects.map((r) => r.status)).toEqual([301, 307]);
    expect(f.calls).toHaveLength(2);
  });

  it('refuses the sixth redirect', async () => {
    const answers: Record<string, FakeAnswer> = {};
    for (let i = 0; i < 10; i += 1) answers[`https://www.example.de/${i}`] = { status: 302, location: `/${i + 1}` };
    const f = fakeFetch(answers);
    const result = await safeFetch('https://www.example.de/0', { guard: guardOf(), fetch: f.fetch });
    expect(SSRF_LIMITS.maxRedirects).toBe(5);
    expect(result.outcome).toBe('too-many-redirects');
    expect(result.redirects).toHaveLength(6);
    expect(f.calls).toHaveLength(6);
  });

  it('refuses a body larger than 2 MB by its announced length without reading it', async () => {
    const f = fakeFetch({ 'https://www.example.de/': { status: 200, headers: { 'content-length': String(SSRF_LIMITS.maxBodyBytes + 1) }, chunks: [bytes(100)] } });
    const result = await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: f.fetch });
    expect(result.outcome).toBe('too-large');
    expect(result.body).toBeNull();
    expect(f.cancelledCount()).toBe(1);
  });

  it('stops reading a body without length as soon as it passes 2 MB', async () => {
    const chunk = bytes(512 * 1024);
    const f = fakeFetch({ 'https://www.example.de/': { status: 200, chunks: [chunk, chunk, chunk, chunk, chunk, chunk, chunk, chunk] } });
    const result = await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: f.fetch });
    expect(result.outcome).toBe('too-large');
    expect(result.body).toBeNull();
    expect(f.cancelledCount()).toBe(1);
    // Exactly 2 MB is still allowed.
    const exact = fakeFetch({ 'https://www.example.de/': { status: 200, chunks: [chunk, chunk, chunk, chunk] } });
    expect((await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: exact.fetch })).bodyBytes).toBe(SSRF_LIMITS.maxBodyBytes);
  });

  it('stops at the time limit: no answer, a stalled body, or a slow name resolution', async () => {
    const hang = fakeFetch({ 'https://www.example.de/': { status: 200, hang: true } });
    const started = Date.now();
    const noAnswer = await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: hang.fetch, timeoutMs: 150 });
    expect(noAnswer.outcome).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
    const stall = fakeFetch({ 'https://www.example.de/': { status: 200, chunks: [bytes(10)], stallBody: true } });
    expect((await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: stall.fetch, timeoutMs: 150 })).outcome).toBe('timeout');
    const slowDns = createUrlGuard({ resolve: () => new Promise<string[]>(() => undefined) });
    const nothing = fakeFetch({});
    expect((await safeFetch('https://www.example.de/', { guard: slowDns, fetch: nothing.fetch, timeoutMs: 150 })).outcome).toBe('timeout');
    expect(nothing.calls).toHaveLength(0);
    expect(SSRF_LIMITS.timeoutMs).toBe(10_000);
  });

  it('reports connection errors and redirects without a usable Location', async () => {
    const refused = fakeFetch({ 'https://www.example.de/': new TypeError('fetch failed') });
    expect((await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: refused.fetch })).outcome).toBe('network-error');
    const noLocation = fakeFetch({ 'https://www.example.de/': { status: 302 } });
    expect((await safeFetch('https://www.example.de/', { guard: guardOf(), fetch: noLocation.fetch })).outcome).toBe('bad-redirect');
    const nothing = fakeFetch({});
    expect((await safeFetch('http://[::1]/', { guard: guardOf(), fetch: nothing.fetch })).outcome).toBe('not-allowed');
    expect(nothing.calls).toHaveLength(0);
  });
});

describe('DNS over HTTPS resolver', () => {
  const dohFetch = (answers: Record<string, { status?: number; json?: unknown }>) => {
    const urls: string[] = [];
    const fn = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      const type = new URL(url).searchParams.get('type') as string;
      const answer = answers[type] ?? { json: { Status: 0 } };
      return new Response(JSON.stringify(answer.json ?? {}), { status: answer.status ?? 200, headers: { 'content-type': 'application/dns-json' } });
    }) as typeof fetch;
    return { fn, urls };
  };

  it('returns A and AAAA addresses and skips CNAME records', async () => {
    const { fn, urls } = dohFetch({
      A: { json: { Status: 0, Answer: [{ type: 5, data: 'shop.cdn.example.' }, { type: 1, data: PUBLIC_V4 }] } },
      AAAA: { json: { Status: 0, Answer: [{ type: 28, data: PUBLIC_V6 }] } },
    });
    expect(await createDohResolver(fn)('www.example.de')).toEqual([PUBLIC_V4, PUBLIC_V6]);
    expect(urls.every((u) => u.startsWith('https://cloudflare-dns.com/dns-query?name=www.example.de&type='))).toBe(true);
  });

  it('gives an empty list for a name that does not exist and throws when unsure', async () => {
    expect(await createDohResolver(dohFetch({ A: { json: { Status: 3 } }, AAAA: { json: { Status: 3 } } }).fn)('nx.example.de')).toEqual([]);
    await expect(createDohResolver(dohFetch({ A: { json: { Status: 2 } } }).fn)('x.example.de')).rejects.toThrow(/DNS status 2/);
    await expect(createDohResolver(dohFetch({ AAAA: { status: 500 } }).fn)('x.example.de')).rejects.toThrow(/HTTP 500/);
  });

  it('a private answer through DNS over HTTPS is refused by the guard', async () => {
    const { fn } = dohFetch({ A: { json: { Status: 0, Answer: [{ type: 1, data: '10.1.2.3' }] } } });
    const verdict = await createUrlGuard({ resolve: createDohResolver(fn) }).check('https://intern.example.de/');
    expect(verdict).toMatchObject({ allowed: false, rejection: 'address', addressRejection: 'private' });
  });
});

describe('navigation guard over the browser protocol', () => {
  function fakeSession() {
    const listeners = new Map<string, (params: unknown) => void>();
    const sent: { method: string; params?: Record<string, unknown> }[] = [];
    const session: CdpSessionLike = {
      send: async (method, params) => {
        sent.push({ method, ...(params !== undefined ? { params } : {}) });
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'MAIN' } } };
        return {};
      },
      on: (event, listener) => {
        listeners.set(event, listener as (params: unknown) => void);
      },
    };
    const pause = async (requestId: string, url: string, frameId = 'MAIN', resourceType = 'Document'): Promise<void> => {
      listeners.get('Fetch.requestPaused')?.({ requestId, frameId, resourceType, request: { url } });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const answerFor = (requestId: string) => sent.find((s) => s.params?.['requestId'] === requestId);
    return { session, sent, pause, answerFor };
  }

  it('pauses main-frame documents only, lets public ones go and fails internal ones before they are sent', async () => {
    const s = fakeSession();
    const state = await installNavigationGuard(s.session, guardOf({ 'intern.example.de': ['10.0.0.1'] }));
    expect(s.sent.find((x) => x.method === 'Fetch.enable')?.params).toEqual({ patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Request' }] });
    // Prerendering is switched off before interception starts (A5 review).
    const methods = s.sent.map((x) => x.method);
    expect(s.sent.find((x) => x.method === 'Page.setPrerenderingAllowed')?.params).toEqual({ isAllowed: false });
    expect(methods.indexOf('Page.setPrerenderingAllowed')).toBeLessThan(methods.indexOf('Fetch.enable'));
    await s.pause('1', 'https://www.example.de/');
    await s.pause('2', 'http://127.0.0.1/');
    await s.pause('3', 'http://169.254.169.254/', 'IFRAME');
    await s.pause('4', 'https://intern.example.de/');
    expect(s.answerFor('1')?.method).toBe('Fetch.continueRequest');
    expect(s.answerFor('2')).toEqual({ method: 'Fetch.failRequest', params: { requestId: '2', errorReason: 'BlockedByClient' } });
    expect(s.answerFor('3')?.method).toBe('Fetch.continueRequest'); // iframes are not checked
    expect(s.answerFor('4')?.method).toBe('Fetch.failRequest');
    expect(state.navigations).toBe(3);
    expect(state.blocked.map((b) => [b.url, b.rejection])).toEqual([
      ['http://127.0.0.1/', 'address'],
      ['https://intern.example.de/', 'address'],
    ]);
  });

  it('refuses the sixth redirect or navigation of the main document, and fails closed when the check throws', async () => {
    const s = fakeSession();
    const state = await installNavigationGuard(s.session, guardOf());
    for (let i = 0; i < 7; i += 1) await s.pause(`r${i}`, `https://www.example.de/${i}`);
    expect([0, 1, 2, 3, 4, 5].map((i) => s.answerFor(`r${i}`)?.method)).toEqual(Array(6).fill('Fetch.continueRequest'));
    expect(s.answerFor('r6')?.method).toBe('Fetch.failRequest');
    expect(state.blocked[0]?.rejection).toBe('too-many-redirects');

    const t = fakeSession();
    const broken = { check: async () => Promise.reject(new Error('boom')) };
    const brokenState = await installNavigationGuard(t.session, broken);
    await t.pause('x', 'https://www.example.de/');
    expect(t.answerFor('x')?.method).toBe('Fetch.failRequest');
    expect(brokenState.blocked[0]?.rejection).toBe('dns-error');
  });

  it('the document the data was read from must pass the guard too; a browser without the prerender switch fails the install', async () => {
    const s = fakeSession();
    const state = await installNavigationGuard(s.session, guardOf());
    expect(await checkReadDocument(state, guardOf(), 'https://www.example.de/impressum')).toBe(true);
    expect(await checkReadDocument(state, guardOf(), 'http://192.168.0.1/')).toBe(false);
    expect(await checkReadDocument(state, guardOf(), 'chrome-error://chromewebdata/')).toBe(false);
    expect(state.blocked.map((b) => b.rejection)).toEqual(['address', 'scheme']);
    const old: CdpSessionLike = {
      send: async (method) => {
        if (method === 'Page.setPrerenderingAllowed') throw new Error(`'${method}' wasn't found`);
        return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'MAIN' } } } : {};
      },
      on: () => undefined,
    };
    await expect(installNavigationGuard(old, guardOf())).rejects.toThrow(/wasn't found/);
  });
});
