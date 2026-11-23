/**
 * Network addresses for the SSRF protection (session A5): parsing of IPv4 and IPv6 text and the
 * question whether an address is public. Pure functions, no DNS, no network.
 *
 * IPv4 is parsed in every form a URL parser or a browser accepts (WHATWG URL standard, "IPv4
 * parser"): one to four parts, each decimal, octal (leading 0) or hexadecimal (0x), the last part
 * filling the remaining bytes. So `2130706433`, `0177.0.0.1`, `0x7f.1` and `127.1` are all
 * 127.0.0.1. IPv6 is parsed with `::` compression and a dotted IPv4 tail; zone ids are refused.
 *
 * Non-public ranges follow the IANA special-purpose address registries
 * (https://www.iana.org/assignments/iana-ipv4-special-registry/ and
 * https://www.iana.org/assignments/iana-ipv6-special-registry/). IPv6 is allowed only inside
 * global unicast 2000::/3, and every IPv6 form that carries an IPv4 address (mapped, compatible,
 * translated, NAT64, 6to4, Teredo) is refused as a whole: a real website never needs it, and the
 * embedded address could lead to an internal IPv4 host.
 */

/** Why an address is not public; null means public. */
export type AddressRejection =
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'link-local'
  | 'protocol-assignments'
  | 'documentation'
  | 'benchmarking'
  | 'multicast'
  | 'reserved'
  | 'broadcast'
  | 'deprecated-relay'
  | 'ipv4-in-ipv6'
  | 'unique-local'
  | 'site-local'
  | 'discard-only'
  | 'not-global-unicast';

function parseIPv4Number(part: string): number | null {
  if (part === '') return null;
  let radix = 10;
  let digits = part;
  if (/^0x/i.test(part)) {
    radix = 16;
    digits = part.slice(2);
    if (digits === '') return 0; // "0x" alone is 0 in the WHATWG parser
  } else if (part.length > 1 && part.startsWith('0')) {
    radix = 8;
    digits = part.slice(1);
  }
  const valid = radix === 16 ? /^[0-9a-f]+$/i : radix === 8 ? /^[0-7]+$/ : /^[0-9]+$/;
  if (!valid.test(digits)) return null;
  // Big numbers stay exact enough: anything above 2^32 is refused below.
  const value = parseInt(digits, radix);
  return Number.isFinite(value) ? value : null;
}

/**
 * IPv4 in every form the WHATWG URL parser accepts, as an unsigned 32-bit number; null if the text
 * is not such an address. A trailing dot is allowed, as in the standard.
 */
export function parseIPv4(text: string): number | null {
  let parts = text.split('.');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts = parts.slice(0, -1);
  if (parts.length === 0 || parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    const value = parseIPv4Number(part);
    if (value === null) return null;
    numbers.push(value);
  }
  const last = numbers.pop() as number;
  if (numbers.some((n) => n > 255)) return null;
  if (last >= 256 ** (4 - numbers.length)) return null;
  let address = last;
  numbers.forEach((n, i) => {
    address += n * 256 ** (3 - i);
  });
  return address;
}

export function formatIPv4(address: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join('.');
}

/** Eight 16-bit groups, or null. Brackets are allowed (`[::1]`), zone ids (`%eth0`) are not. */
export function parseIPv6(input: string): number[] | null {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  if (text === '' || text.includes('%') || !/^[0-9a-f:.]+$/i.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (half: string): number[] | null => {
    if (half === '') return [];
    const pieces = half.split(':');
    const groups: number[] = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i] as string;
      if (piece.includes('.')) {
        // A dotted IPv4 tail: only as the last piece, strict decimal form.
        if (i !== pieces.length - 1 || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(piece)) return null;
        const octets = piece.split('.').map(Number);
        if (octets.some((o) => o > 255)) return null;
        groups.push(((octets[0] as number) << 8) | (octets[1] as number), ((octets[2] as number) << 8) | (octets[3] as number));
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };
  const head = groupsOf(halves[0] as string);
  const tail = halves.length === 2 ? groupsOf(halves[1] as string) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

interface Range4 {
  base: number;
  bits: number;
  reason: AddressRejection;
}

const ipv4Range = (cidr: string, reason: AddressRejection): Range4 => {
  const [base, bits] = cidr.split('/');
  return { base: parseIPv4(base as string) as number, bits: Number(bits), reason };
};

/** IANA IPv4 special-purpose registry: every range that is not globally reachable, plus multicast. */
const IPV4_RANGES: readonly Range4[] = [
  ipv4Range('0.0.0.0/8', 'unspecified'),
  ipv4Range('10.0.0.0/8', 'private'),
  ipv4Range('100.64.0.0/10', 'cgnat'),
  ipv4Range('127.0.0.0/8', 'loopback'),
  ipv4Range('169.254.0.0/16', 'link-local'),
  ipv4Range('172.16.0.0/12', 'private'),
  ipv4Range('192.0.0.0/24', 'protocol-assignments'),
  ipv4Range('192.0.2.0/24', 'documentation'),
  ipv4Range('192.88.99.0/24', 'deprecated-relay'),
  ipv4Range('192.168.0.0/16', 'private'),
  ipv4Range('198.18.0.0/15', 'benchmarking'),
  ipv4Range('198.51.100.0/24', 'documentation'),
  ipv4Range('203.0.113.0/24', 'documentation'),
  ipv4Range('224.0.0.0/4', 'multicast'),
  ipv4Range('255.255.255.255/32', 'broadcast'),
  ipv4Range('240.0.0.0/4', 'reserved'),
];

function inRange4(address: number, range: Range4): boolean {
  const size = 2 ** (32 - range.bits);
  return Math.floor(address / size) === Math.floor(range.base / size);
}

/** Null for a public IPv4 address, otherwise the reason. */
export function ipv4Rejection(address: number): AddressRejection | null {
  for (const range of IPV4_RANGES) if (inRange4(address, range)) return range.reason;
  return null;
}

interface Range6 {
  groups: number[];
  bits: number;
  reason: AddressRejection;
}

const ipv6Range = (cidr: string, reason: AddressRejection): Range6 => {
  const [base, bits] = cidr.split('/');
  return { groups: parseIPv6(base as string) as number[], bits: Number(bits), reason };
};

function inRange6(groups: readonly number[], range: Range6): boolean {
  let bits = range.bits;
  for (let i = 0; i < 8 && bits > 0; i += 1) {
    const take = Math.min(16, bits);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if (((groups[i] as number) & mask) !== ((range.groups[i] as number) & mask)) return false;
    bits -= take;
  }
  return true;
}

/** Checked in this order; the first match gives the reason. */
const IPV6_RANGES: readonly Range6[] = [
  ipv6Range('::/128', 'unspecified'),
  ipv6Range('::1/128', 'loopback'),
  ipv6Range('::ffff:0:0/96', 'ipv4-in-ipv6'), // IPv4-mapped
  ipv6Range('::ffff:0:0:0/96', 'ipv4-in-ipv6'), // IPv4-translated (RFC 2765)
  ipv6Range('::/96', 'ipv4-in-ipv6'), // IPv4-compatible (deprecated)
  ipv6Range('64:ff9b::/96', 'ipv4-in-ipv6'), // NAT64 well-known prefix
  ipv6Range('64:ff9b:1::/48', 'ipv4-in-ipv6'), // NAT64 local use
  ipv6Range('2002::/16', 'ipv4-in-ipv6'), // 6to4
  ipv6Range('2001::/32', 'ipv4-in-ipv6'), // Teredo
  ipv6Range('100::/64', 'discard-only'),
  ipv6Range('2001:db8::/32', 'documentation'),
  ipv6Range('3fff::/20', 'documentation'),
  ipv6Range('2001::/23', 'protocol-assignments'),
  ipv6Range('fc00::/7', 'unique-local'),
  ipv6Range('fe80::/10', 'link-local'),
  ipv6Range('fec0::/10', 'site-local'),
  ipv6Range('ff00::/8', 'multicast'),
];

const GLOBAL_UNICAST = ipv6Range('2000::/3', 'not-global-unicast');

/** Null for a public IPv6 address, otherwise the reason. */
export function ipv6Rejection(groups: readonly number[]): AddressRejection | null {
  for (const range of IPV6_RANGES) if (inRange6(groups, range)) return range.reason;
  return inRange6(groups, GLOBAL_UNICAST) ? null : 'not-global-unicast';
}

export interface ParsedAddress {
  version: 4 | 6;
  /** Canonical text: dotted quad, or IPv6 groups in lower-case hex without compression. */
  canonical: string;
  rejection: AddressRejection | null;
}

/**
 * The text as an IP address (any IPv4 form, IPv6 with or without brackets), or null if it is a
 * host name. A text with only digits, dots and hex prefixes that is not a valid IPv4 address is
 * also null; the URL parser refuses such hosts before they get here.
 */
export function parseAddress(text: string): ParsedAddress | null {
  const v4 = parseIPv4(text);
  if (v4 !== null) return { version: 4, canonical: formatIPv4(v4), rejection: ipv4Rejection(v4) };
  const v6 = parseIPv6(text);
  if (v6 !== null) return { version: 6, canonical: v6.map((g) => g.toString(16)).join(':'), rejection: ipv6Rejection(v6) };
  return null;
}

/**
 * Host names that never belong to a public website, whatever DNS says: `localhost` and its
 * subdomains (RFC 6761), the special-use and private-use names `.local` (RFC 6762),
 * `.home.arpa` (RFC 8375), `.internal` (ICANN, 2024), `.test`, `.example`, `.invalid` (RFC 6761),
 * `.onion` (RFC 7686), `.alt` (RFC 9476), the reverse-lookup tree `.arpa`, and names of one label
 * only (they resolve through local search domains).
 */
const SPECIAL_USE_SUFFIXES = ['localhost', 'local', 'home.arpa', 'internal', 'test', 'example', 'invalid', 'onion', 'alt', 'arpa', 'lan', 'intranet', 'corp', 'home', 'localdomain'];

export function hostNameRejection(hostname: string): string | null {
  const name = hostname.toLowerCase().replace(/\.$/, '');
  if (name === '') return 'empty host name';
  if (!name.includes('.')) return `single-label host name "${name}"`;
  for (const suffix of SPECIAL_USE_SUFFIXES) {
    if (name === suffix || name.endsWith(`.${suffix}`)) return `special-use host name (.${suffix})`;
  }
  return null;
}
