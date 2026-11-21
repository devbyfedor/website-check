import { describe, expect, it } from 'vitest';
import type { SnapshotResult } from '@website-check/scanner';
import { failureOf } from '../src/capture/common.ts';

/** Both Cloudflare strategies decide the failure through `failureOf` with the page snapshot. */

function snapshot(title: string, text: string, links = 0): SnapshotResult {
  return {
    title,
    lang: 'de',
    text,
    textTruncated: false,
    links: Array.from({ length: links }, (_, i) => ({ href: `https://www.example.de/${i}`, text: `Link ${i}` })),
    linksTruncated: false,
    probe: null,
    signals: null,
  };
}

describe('failureOf in the Cloudflare adapter', () => {
  const main = { status: 200, headers: { 'content-type': 'text/html' } };

  it('marks a check page of a web host with HTTP 200 as blocked', () => {
    const failure = failureOf(null, main, snapshot('Einen Moment bitte …', 'Bitte warten Sie, während Ihre Anfrage geprüft wird …'));
    expect(failure).toMatchObject({ reason: 'blocked', status: 200 });
  });

  it('keeps a normal page captured', () => {
    expect(failureOf(null, main, snapshot('Rösterei Muster – Startseite', 'Frisch gerösteter Kaffee. '.repeat(60), 25))).toBeNull();
  });

  it('works without a snapshot and for navigation errors as before', () => {
    expect(failureOf(null, main, null)).toBeNull();
    expect(failureOf('net::ERR_NAME_NOT_RESOLVED', null, null)).toMatchObject({ reason: 'invalid-address' });
    expect(failureOf(null, null, null)).toMatchObject({ reason: 'other' });
  });
});
