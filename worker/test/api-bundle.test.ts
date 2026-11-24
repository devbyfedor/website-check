import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Session A5 part 4: the API Worker and the scan Worker are separate. The API Worker must stay small (10 ms
 * CPU per request on the free plan, including the first requests of a fresh instance), so its import graph
 * must not reach Puppeteer, axe-core, the rules data, the analyzers or the public suffix list. These tests
 * follow the static imports from each entry, as the bundler does, and check the wrangler configs of both
 * Workers (production and lab) against each other.
 */

const WORKER_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(WORKER_ROOT, '..');
const SCANNER_SRC = resolve(REPO_ROOT, 'scanner/src');

interface Graph {
  /** Source files reached, relative to the repository root with forward slashes. */
  files: Set<string>;
  /** Package or runtime specifiers reached (not resolved to a source file of this repository). */
  packages: Set<string>;
}

/** Static imports and re-exports that stay in the bundle (whole-statement `import type` / `export type` are erased). */
function specifiersOf(code: string): string[] {
  const out: string[] = [];
  const statement = /(^|[;\n])\s*(import|export)\s+(type\s+)?([^;'"]*?\bfrom\s+)?['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(statement)) {
    if (m[3] !== undefined && m[4] !== undefined) continue;
    out.push(m[5] ?? '');
  }
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1] ?? '');
  return out;
}

function resolveSpecifier(from: string, spec: string): string | null {
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  if (spec === '@website-check/scanner') return resolve(SCANNER_SRC, 'index.ts');
  if (spec === '@website-check/scanner/api') return resolve(SCANNER_SRC, 'api.ts');
  if (spec === '@website-check/scanner/local') return resolve(SCANNER_SRC, 'local/index.ts');
  return null;
}

function importGraph(entry: string): Graph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const todo = [resolve(WORKER_ROOT, entry)];
  while (todo.length > 0) {
    const file = todo.pop() as string;
    const name = relative(REPO_ROOT, file).replaceAll('\\', '/');
    if (files.has(name)) continue;
    files.add(name);
    if (!file.endsWith('.ts')) continue; // data files (JSON, text modules) are leaves
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(file, spec);
      if (target === null) packages.add(spec);
      else {
        expect(existsSync(target), `${name} imports ${spec}`).toBe(true);
        todo.push(target);
      }
    }
  }
  return { files, packages };
}

/** Removes `//` and block comments outside strings (the wrangler configs are JSONC). */
function parseJsonc(path: string): Record<string, unknown> {
  const text = readFileSync(path, 'utf8');
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
      continue;
    }
    out += c;
  }
  return JSON.parse(out) as Record<string, unknown>;
}

const API_FILES_ALLOWED = [/^worker\/src\/(index|app)\.ts$/, /^worker\/src\/api\/[a-z-]+\.ts$/, /^worker\/src\/db\/store\.ts$/, /^scanner\/src\/api\.ts$/, /^scanner\/src\/security\/(address|ssrf|doh)\.ts$/, /^scanner\/src\/report\/site-address\.ts$/];

describe('API Worker import graph (A5 part 4)', () => {
  for (const entry of ['src/index.ts', 'src/lab/e2e.ts']) {
    it(`${entry} reaches no Puppeteer, axe-core, rules data, analyzers, public suffix list or Node built-ins`, () => {
      const graph = importGraph(entry);
      expect([...graph.packages].sort()).toEqual([]);
      for (const file of graph.files) {
        if (entry === 'src/lab/e2e.ts' && /^worker\/src\/lab\/(e2e|token)\.ts$/.test(file)) continue;
        expect(API_FILES_ALLOWED.some((pattern) => pattern.test(file)), `${file} is not part of the API`).toBe(true);
      }
      expect(graph.files.has('scanner/src/index.ts')).toBe(false);
      expect(graph.files.has('scanner/src/data.ts')).toBe(false);
      expect(graph.files.has('worker/src/queue/object.ts')).toBe(false);
    });
  }

  it('control: the queue object does reach the whole scan core, so neither API Worker may import it', () => {
    const queue = importGraph('src/queue/object.ts');
    expect(queue.files.has('scanner/src/index.ts')).toBe(true);
    expect(queue.files.has('scanner/src/data.ts')).toBe(true);
    for (const entry of ['src/index.ts', 'src/lab/e2e.ts']) expect(importGraph(entry).files.has('worker/src/queue/object.ts'), entry).toBe(false);
  });

  it('control: the scan Worker does reach Puppeteer, axe-core, the rules data and the Durable Object base class', () => {
    const graph = importGraph('src/scan-worker.ts');
    expect(graph.packages).toContain('@cloudflare/puppeteer');
    expect(graph.packages).toContain('cloudflare:workers');
    expect(graph.packages).toContain('axe-core/axe.min.js');
    expect(graph.files.has('scanner/src/data.ts')).toBe(true);
    expect(graph.files.has('worker/src/queue/object.ts')).toBe(true);
    expect(readFileSync(resolve(WORKER_ROOT, 'src/scan-worker.ts'), 'utf8')).toMatch(/export \{ ScanQueueObject \} from '\.\/queue\/object\.ts';/);
  });
});

describe('wrangler configs of the two Workers (A5 part 4)', () => {
  const pairs = [
    { api: 'wrangler.jsonc', scanner: 'wrangler.scanner.jsonc', apiMain: 'src/index.ts' },
    { api: 'wrangler.lab-e2e.jsonc', scanner: 'wrangler.lab-e2e-scanner.jsonc', apiMain: 'src/lab/e2e.ts' },
  ];
  for (const pair of pairs) {
    it(`${pair.api} binds the queue object of ${pair.scanner}`, () => {
      const api = parseJsonc(resolve(WORKER_ROOT, pair.api)) as Record<string, any>;
      const scanner = parseJsonc(resolve(WORKER_ROOT, pair.scanner)) as Record<string, any>;
      expect(api['main']).toBe(pair.apiMain);
      expect(scanner['main']).toBe('src/scan-worker.ts');
      // The API Worker: no browser, no axe text module, no class of its own, no Node compatibility layer.
      expect(api['browser']).toBeUndefined();
      expect(api['rules']).toBeUndefined();
      expect(api['migrations']).toBeUndefined();
      expect(api['compatibility_flags'] ?? []).not.toContain('nodejs_compat');
      expect(api['durable_objects']['bindings']).toEqual([{ name: 'SCAN_QUEUE', class_name: 'ScanQueueObject', script_name: scanner['name'] }]);
      // The scan Worker: the class with its SQLite migration, the browser, no public address.
      expect(scanner['durable_objects']['bindings']).toEqual([{ name: 'SCAN_QUEUE', class_name: 'ScanQueueObject' }]);
      expect(scanner['migrations']).toEqual([{ tag: 'v1', new_sqlite_classes: ['ScanQueueObject'] }]);
      expect(scanner['browser']).toEqual({ binding: 'BROWSER' });
      expect(scanner['workers_dev']).toBe(false);
      expect(scanner['compatibility_flags']).toContain('nodejs_compat');
      // One database for both, the same dates, nothing logged.
      expect(scanner['d1_databases'][0]['database_name']).toBe(api['d1_databases'][0]['database_name']);
      expect(scanner['compatibility_date']).toBe(api['compatibility_date']);
      for (const config of [api, scanner]) {
        expect(config['observability']).toEqual({ enabled: false, logs: { enabled: false, invocation_logs: false }, traces: { enabled: false } });
        expect(config['preview_urls']).toBe(false);
      }
    });
  }

  it('only the production API Worker has the hourly cleanup', () => {
    expect((parseJsonc(resolve(WORKER_ROOT, 'wrangler.jsonc')) as Record<string, any>)['triggers']).toEqual({ crons: ['0 * * * *'] });
    expect((parseJsonc(resolve(WORKER_ROOT, 'wrangler.scanner.jsonc')) as Record<string, any>)['triggers']).toBeUndefined();
  });
});
