import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPlatformProxy } from 'wrangler';

/**
 * A local D1 for unit tests (session A5): wrangler's `getPlatformProxy` starts the same local runtime
 * that `wrangler dev` uses, with the D1 binding of `worker/wrangler.jsonc`, kept in memory only
 * (`persist: false`) and without any remote binding. The migrations in `worker/migrations/` are applied
 * statement by statement, in file order, as `wrangler d1 migrations apply` does.
 */

export const WORKER_ROOT = resolve(import.meta.dirname, '..');

export function migrationStatements(): string[] {
  const dir = resolve(WORKER_ROOT, 'migrations');
  return readdirSync(dir)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort()
    .flatMap((name) =>
      readFileSync(resolve(dir, name), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(/;\s*(?:\n|$)/)
        .map((s) => s.trim())
        .filter((s) => s !== ''),
    );
}

export const TABLES = ['network_requests', 'findings', 'leads', 'scans', 'sites', 'rate_state', 'rate_salts'] as const;

/**
 * Session B5 part 1: the wall-clock timeout of every test against the local D1 (each such file sets it with
 * `vi.setConfig`). These tests measure no time: they count answers and rows. Their duration is the round trips of
 * their statements to the local runtime, which grow with the load of the machine: the 82 requests of the test of the
 * day's start budget took 3.2 s on a quiet machine and over 5 s, the default timeout of Vitest, with every core busy, so
 * the default failed tests that were right. This timeout only stops a test whose local D1 never answers. (The speed
 * checks of the scanner measure CPU time instead, `scanner/test/speed.ts`.)
 */
export const D1_TEST_TIMEOUT_MS = 60_000;

export interface LocalD1 {
  db: D1Database;
  /** Deletes every row of every table (children first). */
  clear(): Promise<void>;
  dispose(): Promise<void>;
}

export async function localD1(): Promise<LocalD1> {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: resolve(WORKER_ROOT, 'wrangler.jsonc'), persist: false, remoteBindings: false, envFiles: [] });
  const db = proxy.env.DB;
  for (const statement of migrationStatements()) await db.prepare(statement).run();
  return {
    db,
    async clear() {
      await db.batch(TABLES.map((table) => db.prepare(`DELETE FROM ${table}`)));
    },
    dispose: () => proxy.dispose(),
  };
}

/**
 * Wraps a D1 binding and adds up `meta.rows_written` of every statement that runs through it; since session B2 part 2
 * also `meta.rows_read` and the number of queries (a batch counts as one, as on the free plan).
 */
export function countingD1(db: D1Database): { db: D1Database; written(): number; read(): number; queries(): number; reset(): void } {
  let written = 0;
  let read = 0;
  let queries = 0;
  const add = (result: unknown): void => {
    const meta = (result as { meta?: { rows_written?: number; rows_read?: number } } | undefined)?.meta;
    written += meta?.rows_written ?? 0;
    read += meta?.rows_read ?? 0;
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === 'bind') return (...values: unknown[]) => wrapStatement(target.bind(...values));
        if (prop === 'run' || prop === 'all') {
          return async () => {
            const result = await (target[prop] as () => Promise<unknown>).call(target);
            queries += 1;
            add(result);
            return result;
          };
        }
        if (prop === 'first' || prop === 'raw') throw new Error(`${prop}() returns no meta; the store uses run() or all()`);
        if (prop === '__inner') return target;
        const value: unknown = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const inner = statements.map((s) => (s as unknown as { __inner: D1PreparedStatement }).__inner ?? s);
          const results = await target.batch(inner);
          queries += 1;
          for (const r of results) add(r);
          return results;
        };
      }
      const value: unknown = Reflect.get(target, prop);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    db: wrapped,
    written: () => written,
    read: () => read,
    queries: () => queries,
    reset: () => {
      written = 0;
      read = 0;
      queries = 0;
    },
  };
}
