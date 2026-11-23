/**
 * The part of the scan core that the API Worker needs (session A5 part 4): the address rules, the SSRF
 * guard with DNS over HTTPS, and the normalized site address. Nothing else: no rules data, no analyzers,
 * no page scripts, no axe-core, no public suffix list. The API Worker imports only this entry, so its
 * bundle stays small and a fresh isolate starts with little to compile (10 ms CPU per request on the free
 * plan). Everything here is also exported from the main entry `./index.ts`.
 */
export * from './security/address.ts';
export * from './security/ssrf.ts';
export { createDohResolver, DOH_ENDPOINT } from './security/doh.ts';
export { decodePunycodeLabel, displayHostOf, hostToUnicode, MAX_ADDRESS_INPUT, normalizeSiteAddress, type AddressError, type NormalizedAddress } from './report/site-address.ts';
