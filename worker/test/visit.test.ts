import { describe, expect, it } from 'vitest';
import { parseTrace, traceObjectVisit, visitOf } from '../src/capture/visit.ts';
import { fieldPositionsExpression } from '../src/capture/field-positions.ts';

/** Session A5 part 3: the place of the visit from Cloudflare's trace page, and the lab's "Feld B2" expression. */

describe('the place of the visit', () => {
  it('reads loc and colo from the trace page and keeps only well-formed values', () => {
    const trace = parseTrace('fl=123\nh=www.cloudflare.com\nip=192.0.2.1\nloc=AT\ncolo=VIE\nhttp=http/2\ntls=TLSv1.3\n');
    expect(trace).toEqual({ loc: 'AT', colo: 'VIE', http: 'http/2', tls: 'TLSv1.3' });
    expect(visitOf(trace, 'browser-trace')).toEqual({ country: 'AT', colo: 'VIE', source: 'browser-trace' });
    expect(visitOf({ loc: 'T1', colo: 'vienna' }, 'browser-trace')).toEqual({ country: null, colo: null, source: 'browser-trace' });
    expect(visitOf({ loc: null, colo: null }, 'object-trace')).toEqual({ country: null, colo: null, source: 'object-trace' });
  });

  it('never throws when the trace page does not answer; the report then says the place is unknown', async () => {
    const failing = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await traceObjectVisit(failing)).toEqual({ country: null, colo: null, source: 'object-trace' });
    const ok = (async () => new Response('loc=DE\ncolo=FRA\n')) as unknown as typeof fetch;
    // The object's own request: only the data center counts, its loc is the egress address's country.
    expect(await traceObjectVisit(ok)).toEqual({ country: null, colo: 'FRA', source: 'object-trace' });
  });
});

describe('Feld B2 measurement (lab only)', () => {
  it('is one self-contained expression with the axe targets as data, never as code', () => {
    const expression = fieldPositionsExpression([['main > p.claim'], ['#host', 'button']]);
    expect(expression.startsWith('(() => {')).toBe(true);
    expect(expression).toContain(JSON.stringify([['main > p.claim'], ['#host', 'button']]));
    // A selector cannot break out of the JSON string.
    const hostile = fieldPositionsExpression([['"]); alert(1); (["']]);
    expect(hostile).toContain(JSON.stringify([['"]); alert(1); (["']]));
    expect(() => new Function(`return ${hostile}`)).not.toThrow();
  });
});
