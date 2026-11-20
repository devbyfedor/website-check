import { describe, expect, it } from 'vitest';
import { classifyMainDocument, classifyNavigationError } from '../src/capture/failure.ts';

describe('classifyNavigationError', () => {
  it.each([
    ['page.goto: net::ERR_NAME_NOT_RESOLVED at https://nope.example/', 'invalid-address'],
    ['Cannot navigate to invalid URL', 'invalid-address'],
    ['page.goto: Timeout 15000ms exceeded.', 'timeout'],
    ['page.goto: net::ERR_TIMED_OUT at https://x.de/', 'timeout'],
    ['page.goto: net::ERR_CONNECTION_REFUSED at https://x.de/', 'unreachable'],
    ['page.goto: net::ERR_CONNECTION_RESET at https://x.de/', 'unreachable'],
    ['page.goto: net::ERR_CERT_DATE_INVALID at https://x.de/', 'unreachable'],
    ['page.goto: net::ERR_SSL_PROTOCOL_ERROR at https://x.de/', 'unreachable'],
    ['page.goto: net::ERR_TOO_MANY_REDIRECTS at https://x.de/', 'unreachable'],
    ['page.goto: net::ERR_BLOCKED_BY_RESPONSE at https://x.de/', 'blocked'],
    ['page.goto: Download is starting', 'other'],
  ] as const)('%s -> %s', (message, reason) => {
    expect(classifyNavigationError(message)).toBe(reason);
  });
});

describe('classifyMainDocument', () => {
  it('accepts a normal 200 page', () => {
    expect(classifyMainDocument(200, { 'content-type': 'text/html' }, 'Schreinerei Muster – Startseite')).toBeNull();
  });

  it('treats 401, 403, 429 and 451 as blocked', () => {
    for (const status of [401, 403, 429, 451]) {
      expect(classifyMainDocument(status, {}, '')?.reason).toBe('blocked');
    }
  });

  it('detects a Cloudflare challenge by header or title', () => {
    expect(classifyMainDocument(403, { 'cf-mitigated': 'challenge' }, 'Just a moment...')).toMatchObject({ reason: 'blocked', status: 403 });
    expect(classifyMainDocument(503, {}, 'Just a moment...')?.reason).toBe('blocked');
    expect(classifyMainDocument(200, {}, 'Just a moment...')?.reason).toBe('blocked');
  });

  it('does not mistake a normal title for a challenge', () => {
    expect(classifyMainDocument(200, {}, 'Security Check GmbH – Sicherheitstechnik in München')).toBeNull();
  });

  it('treats other error statuses as http errors', () => {
    expect(classifyMainDocument(404, {}, 'Not found')).toMatchObject({ reason: 'http-error', status: 404 });
    expect(classifyMainDocument(500, {}, '')).toMatchObject({ reason: 'http-error', status: 500 });
    expect(classifyMainDocument(503, {}, 'Wartungsarbeiten')).toMatchObject({ reason: 'http-error', status: 503 });
  });
});
