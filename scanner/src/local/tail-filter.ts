import { appendFileSync } from 'node:fs';

/**
 * Filter for `wrangler tail --format json` of a lab Worker (written for session A2, used since A5 for the lab API Worker
 * of `worker/wrangler.lab-e2e.jsonc`):
 *
 *   npx wrangler tail -c worker/wrangler.lab-e2e.local.jsonc --format json | node scanner/src/local/tail-filter.ts local/a5/<run>/tail.jsonl
 *
 * Wrangler prints every tail event as indented JSON, one object after the other. This keeps only
 * what the measurement needs (time, outcome, CPU and wall time, path and `label` query, and since
 * A2 part 2 whether the event is the Worker or the Durable Object) and drops everything else, in
 * particular the request headers, so the lab token never reaches a file.
 */

export interface TailRecord {
  eventTimestamp: number | null;
  outcome: string | null;
  cpuTime: number | null;
  wallTime: number | null;
  method: string | null;
  path: string | null;
  label: string | null;
  exceptions: number;
  /** `stateless` for the Worker, `durableObject` for the Durable Object (A2 part 2). */
  executionModel: string | null;
  /** Class name for a Durable Object event, null for the Worker's default entry point. */
  entrypoint: string | null;
  /** HTTP status of the response, when the event has one. */
  status: number | null;
  /** Top-level keys of the event, to see which fields the tail stream offers. */
  keys: string[];
}

export function toTailRecord(event: Record<string, unknown>): TailRecord {
  const info = event['event'] as { request?: { url?: string; method?: string }; response?: { status?: unknown } } | null | undefined;
  const request = info?.request;
  let path: string | null = null;
  let label: string | null = null;
  if (typeof request?.url === 'string') {
    try {
      const url = new URL(request.url);
      path = url.pathname;
      label = url.searchParams.get('label');
    } catch {
      path = null;
    }
  }
  const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  return {
    eventTimestamp: number(event['eventTimestamp']),
    outcome: typeof event['outcome'] === 'string' ? event['outcome'] : null,
    cpuTime: number(event['cpuTime']),
    wallTime: number(event['wallTime']),
    method: typeof request?.method === 'string' ? request.method : null,
    path,
    label,
    exceptions: Array.isArray(event['exceptions']) ? event['exceptions'].length : 0,
    executionModel: typeof event['executionModel'] === 'string' ? event['executionModel'] : null,
    entrypoint: typeof event['entrypoint'] === 'string' ? event['entrypoint'] : null,
    status: number(info?.response?.status),
    keys: Object.keys(event).sort(),
  };
}

/** Splits a stream of concatenated JSON objects (pretty-printed or not) into objects. */
export class JsonObjectSplitter {
  #buffer = '';
  #depth = 0;
  #inString = false;
  #escaped = false;
  #start = -1;

  push(chunk: string): unknown[] {
    const out: unknown[] = [];
    const base = this.#buffer.length;
    this.#buffer += chunk;
    for (let i = base; i < this.#buffer.length; i += 1) {
      const c = this.#buffer[i];
      if (this.#inString) {
        if (this.#escaped) this.#escaped = false;
        else if (c === '\\') this.#escaped = true;
        else if (c === '"') this.#inString = false;
        continue;
      }
      if (c === '"' && this.#depth > 0) this.#inString = true;
      else if (c === '{') {
        if (this.#depth === 0) this.#start = i;
        this.#depth += 1;
      } else if (c === '}' && this.#depth > 0) {
        this.#depth -= 1;
        if (this.#depth === 0 && this.#start >= 0) {
          try {
            out.push(JSON.parse(this.#buffer.slice(this.#start, i + 1)));
          } catch {
            // not an event
          }
          this.#start = -1;
        }
      }
    }
    if (this.#depth === 0) this.#buffer = '';
    else if (this.#start > 0) {
      this.#buffer = this.#buffer.slice(this.#start);
      this.#start = 0;
    }
    return out;
  }
}

if (import.meta.main) {
  const target = process.argv[2];
  if (target === undefined) throw new Error('usage: tail-filter.ts <output.jsonl>');
  const splitter = new JsonObjectSplitter();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const value of splitter.push(chunk)) {
      if (typeof value !== 'object' || value === null) continue;
      const record = toTailRecord(value as Record<string, unknown>);
      appendFileSync(target, `${JSON.stringify(record)}\n`);
      const who = record.executionModel === 'durableObject' ? 'DO' : 'Worker';
      process.stdout.write(`${who} ${record.label ?? record.path} outcome=${record.outcome} cpu=${record.cpuTime} wall=${record.wallTime}\n`);
    }
  });
}
