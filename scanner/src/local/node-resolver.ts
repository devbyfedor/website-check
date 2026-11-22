import { lookup } from 'node:dns/promises';
import { createUrlGuard, type Resolver, type UrlGuard, type UrlGuardOptions } from '../security/ssrf.ts';

/**
 * Name resolution for the SSRF guard on the laptop: the operating system's resolver (the same
 * one the local Chromium uses, hosts file included), every A and AAAA record. A name that does
 * not exist gives an empty list; any other error throws, so the guard refuses the address.
 */
export const resolveWithNode: Resolver = async (hostname) => {
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOTFOUND' || code === 'ENODATA') return [];
    throw error;
  }
};

/** A guard for one local scan. */
export function createLocalGuard(options: Partial<UrlGuardOptions> = {}): UrlGuard {
  return createUrlGuard({ resolve: options.resolve ?? resolveWithNode, ...(options.exempt !== undefined ? { exempt: options.exempt } : {}) });
}
