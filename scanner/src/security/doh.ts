import type { Resolver } from './ssrf.ts';

/**
 * Name resolution for the SSRF guard in a Worker or Durable Object, which has no resolver of its
 * own: DNS over HTTPS with the JSON API of Cloudflare's public resolver
 * (https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/).
 * A and AAAA are asked in parallel; both must answer (status 0, or 3 for a name that does not
 * exist), otherwise the resolver throws and the guard refuses the address (unsure means refused).
 * Only the host name is sent, never the path. Each lookup is two subrequests.
 */

export const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

const TYPE_CODE = { A: 1, AAAA: 28 } as const;

interface DnsJson {
  Status?: number;
  Answer?: { type?: number; data?: string }[];
}

export function createDohResolver(fetchFn: typeof fetch = globalThis.fetch, options: { endpoint?: string; timeoutMs?: number } = {}): Resolver {
  const endpoint = options.endpoint ?? DOH_ENDPOINT;
  const timeoutMs = options.timeoutMs ?? 4_000;
  const query = async (hostname: string, type: keyof typeof TYPE_CODE): Promise<string[]> => {
    const url = `${endpoint}?name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await fetchFn(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`DNS over HTTPS answered HTTP ${response.status}`);
    const body = (await response.json()) as DnsJson;
    if (body.Status === 3) return [];
    if (body.Status !== 0) throw new Error(`DNS status ${String(body.Status)} for ${type}`);
    return (body.Answer ?? []).filter((answer) => answer.type === TYPE_CODE[type] && typeof answer.data === 'string').map((answer) => answer.data as string);
  };
  return async (hostname) => {
    const [a, aaaa] = await Promise.all([query(hostname, 'A'), query(hostname, 'AAAA')]);
    return [...a, ...aaaa];
  };
}
