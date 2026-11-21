import { describe, expect, it } from 'vitest';
import { JsonObjectSplitter, toTailRecord } from '../src/local/tail-filter.ts';

const event = {
  outcome: 'ok',
  scriptName: 'website-check-lab',
  cpuTime: 7,
  wallTime: 5123,
  eventTimestamp: 1_790_000_000_000,
  exceptions: [],
  logs: [],
  event: {
    request: {
      url: 'https://website-check-lab.example.workers.dev/lab/capture?label=site-07-b',
      method: 'POST',
      headers: { authorization: 'Bearer secret-token-value' },
    },
  },
};

describe('tail filter', () => {
  it('keeps time, outcome, CPU, wall time, path and label, and drops the headers', () => {
    const record = toTailRecord(event);
    expect(record).toMatchObject({ outcome: 'ok', cpuTime: 7, wallTime: 5123, method: 'POST', path: '/lab/capture', label: 'site-07-b', exceptions: 0 });
    expect(JSON.stringify(record)).not.toContain('secret-token-value');
    expect(record).toMatchObject({ executionModel: null, entrypoint: null, status: null });
  });

  it('tells the Durable Object from the Worker', () => {
    const record = toTailRecord({ ...event, executionModel: 'durableObject', entrypoint: 'LabBrowser', event: { ...event.event, response: { status: 200 } } });
    expect(record).toMatchObject({ executionModel: 'durableObject', entrypoint: 'LabBrowser', status: 200, label: 'site-07-b' });
    expect(toTailRecord({ ...event, executionModel: 'stateless', event: null })).toMatchObject({ executionModel: 'stateless', path: null, label: null });
  });

  it('splits pretty-printed objects across chunks, with braces inside strings', () => {
    const text = `${JSON.stringify(event, null, 4)}\n${JSON.stringify({ ...event, outcome: 'exceededCpu', note: 'a } { b' }, null, 4)}\n`;
    const splitter = new JsonObjectSplitter();
    const out = [...splitter.push(text.slice(0, 101)), ...splitter.push(text.slice(101, 333)), ...splitter.push(text.slice(333))];
    expect(out).toHaveLength(2);
    expect((out[1] as { outcome: string }).outcome).toBe('exceededCpu');
  });
});
