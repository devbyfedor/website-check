import { describe, expect, it } from 'vitest';
import { currentDocument, readCheckedDocument, type CdpSessionLike, type NavigationGuardState } from '../src/security/navigation-guard.ts';
import { createUrlGuard } from '../src/security/ssrf.ts';

/**
 * Session fix-a2, review finding 23: something is read from a page only out of a document the guard allows.
 * The browser here is a fake session that answers `Page.getFrameTree`; the adapters themselves run this in
 * Chromium (`test/integration/ssrf.test.ts`, `worker/test/integration/cdp-capture.test.ts`).
 */

const guard = () => createUrlGuard({ resolve: async () => ['93.184.215.14'] });
const newState = (): NavigationGuardState => ({ navigations: 1, blocked: [], errors: 0 });

interface Doc {
  loaderId: string;
  url: string;
}

/** A tab whose main frame shows `docs[0]` first; `move()` puts the next document into the tab. */
function tab(docs: Doc[]): { session: CdpSessionLike; move(): void; asked: number } {
  let index = 0;
  const state = {
    asked: 0,
    move: (): void => {
      index = Math.min(index + 1, docs.length - 1);
    },
    session: {
      send: async (method: string) => {
        if (method !== 'Page.getFrameTree') throw new Error(`unexpected ${method}`);
        state.asked += 1;
        return { frameTree: { frame: { id: 'MAIN', ...docs[index] } } };
      },
      on: () => undefined,
    } satisfies CdpSessionLike,
  };
  return state;
}

const HOME: Doc = { loaderId: 'L1', url: 'https://www.example.de/' };
const INTERNAL: Doc = { loaderId: 'L2', url: 'http://127.0.0.1:8080/private' };
const OTHER: Doc = { loaderId: 'L3', url: 'https://www.example.de/aktion' };

describe('readCheckedDocument', () => {
  it('returns what was read when the same allowed document is in the tab before and after', async () => {
    const t = tab([HOME]);
    const state = newState();
    expect(await readCheckedDocument(t.session, state, guard(), async () => 'axe result')).toEqual({ ok: true, value: 'axe result' });
    expect(state.blocked).toEqual([]);
    expect(t.asked).toBe(2);
  });

  it('does not read at all when the document in the tab is not allowed, and records the block', async () => {
    const t = tab([INTERNAL]);
    const state = newState();
    let read = false;
    const result = await readCheckedDocument(t.session, state, guard(), async () => {
      read = true;
      return 'data of the internal page';
    });
    expect(result).toEqual({ ok: false, reason: 'refused' });
    expect(read).toBe(false);
    expect(state.blocked.map((b) => [b.url, b.rejection])).toEqual([[INTERNAL.url, 'address']]);
  });

  it('drops what was read when another document replaced the page meanwhile; an internal one is recorded as a block', async () => {
    const t = tab([HOME, INTERNAL]);
    const state = newState();
    const result = await readCheckedDocument(t.session, state, guard(), async () => {
      t.move(); // the page moves to a prefetched address while it is read: no request, the guard on requests sees nothing
      return 'data of the internal page';
    });
    expect(result).toEqual({ ok: false, reason: 'changed' });
    expect(state.blocked.map((b) => [b.url, b.rejection])).toEqual([[INTERNAL.url, 'address']]);
  });

  it('drops it too when the new document is an allowed one: it is not the document that was checked', async () => {
    const t = tab([HOME, OTHER]);
    const state = newState();
    const result = await readCheckedDocument(t.session, state, guard(), async () => {
      t.move();
      return 'data of another page';
    });
    expect(result).toEqual({ ok: false, reason: 'changed' });
    expect(state.blocked).toEqual([]);
  });

  it('the same address loaded again is another document', async () => {
    const t = tab([HOME, { ...HOME, loaderId: 'L9' }]);
    const result = await readCheckedDocument(t.session, newState(), guard(), async () => {
      t.move();
      return 'x';
    });
    expect(result).toEqual({ ok: false, reason: 'changed' });
  });

  it('unsure means no: a browser that does not name the document gives nothing', async () => {
    const silent: CdpSessionLike = { send: async () => ({}), on: () => undefined };
    let read = false;
    expect(
      await readCheckedDocument(silent, newState(), guard(), async () => {
        read = true;
        return 'x';
      }),
    ).toEqual({ ok: false, reason: 'unknown-document' });
    expect(read).toBe(false);
    const failing: CdpSessionLike = { send: async () => Promise.reject(new Error('Target closed')), on: () => undefined };
    expect(await currentDocument(failing)).toBeNull();
    // The document is gone after the read (a closed tab): the result is dropped.
    let calls = 0;
    const closing: CdpSessionLike = { send: async () => ((calls += 1) === 1 ? { frameTree: { frame: { id: 'MAIN', ...HOME } } } : Promise.reject(new Error('Target closed'))), on: () => undefined };
    expect(await readCheckedDocument(closing, newState(), guard(), async () => 'x')).toEqual({ ok: false, reason: 'changed' });
  });
});
