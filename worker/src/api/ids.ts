/**
 * Scan ids (brief: "Report ids are random and unguessable"): 128 random bits from the runtime's
 * cryptographic generator, written as 26 characters of lower-case base32 (RFC 4648 alphabet, no padding),
 * so an id survives a link that is lowercased and contains no characters that need escaping.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const SCAN_ID_PATTERN = /^[a-z2-7]{26}$/;

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function cryptoRandomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function newScanId(randomBytes: (n: number) => Uint8Array = cryptoRandomBytes): string {
  return base32(randomBytes(16));
}

export function isScanId(text: string): boolean {
  return SCAN_ID_PATTERN.test(text);
}
