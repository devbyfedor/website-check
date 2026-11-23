import type { CapturedRequest } from '@website-check/scanner';

/**
 * Session fix-a1: which document made a request, decided at the end of the capture.
 *
 * Puppeteer does not always know it when the request event arrives:
 * - an iframe in a process of its own can report its first requests before Puppeteer has learned the
 *   frame's address (seen with two third-party iframes that answer at almost the same time): the frame
 *   exists, its address is still empty and becomes known a moment later;
 * - a CORS preflight has no frame, but names the request it belongs to;
 * - a request of a web worker has no frame, but the worker's script was loaded by a document.
 * A request that still has no document at the end gets `frameKnown: false`, and the analyzers never
 * take it for a request of the page itself.
 *
 * Pure: it only reads the frames' addresses, so the tests run it with plain objects.
 */

export interface FrameLike {
  /** Empty until the frame's first document is known; `about:blank` and `about:srcdoc` are known addresses. */
  url(): string;
  parentFrame(): FrameLike | null;
}

export interface FrameSource {
  record: CapturedRequest;
  /** The frame of the request, or null (CORS preflight, web worker). */
  frame: FrameLike | null;
  /** The browser protocol's id of the request (redirect hops share it). */
  requestId: string;
  /** For a CORS preflight: the id of the request it belongs to. */
  preflightOf: string | null;
  /** For a request of a web worker: the address of the worker's script. */
  workerUrl: string | null;
  /** False if a frame on the way to the top-level document had no address when the request started. */
  placed: boolean;
}

/**
 * The addresses of the iframes a request was made in, innermost first, up to (not including) the
 * top-level document; frames without an http(s) address are skipped. `complete` is false when a frame on
 * the way has no address yet, or the way does not end at the top-level document. A navigation request
 * loads the frame's next document: the frame's own address, the document it replaces, may be empty then.
 */
export function frameChain(frame: FrameLike, main: FrameLike, isNavigation: boolean): { urls: string[]; complete: boolean } {
  const urls: string[] = [];
  let complete = true;
  let current: FrameLike | null = frame;
  while (current !== null && current !== main) {
    const url = current.url();
    if (/^https?:/i.test(url)) urls.push(url);
    else if (url === '' && !(isNavigation && current === frame)) complete = false;
    current = current.parentFrame();
  }
  if (current === null) complete = false;
  return { urls, complete };
}

function place(target: CapturedRequest, from: CapturedRequest): void {
  target.isMainFrame = from.isMainFrame;
  target.frameUrls = [...from.frameUrls];
  target.frameKnown = true;
}

function unknown(target: CapturedRequest): void {
  target.isMainFrame = false;
  target.frameUrls = [];
  target.frameKnown = false;
}

/**
 * Sets `isMainFrame`, `frameUrls` and `frameKnown` of every record from what is known at the end of the
 * capture. Returns how many requests of a frame got their document only now (`late`: the frame's address
 * was not known when they started) and how many requests stay without one (`unknown`).
 */
export function resolveFrames(sources: readonly FrameSource[], main: FrameLike): { late: number; unknown: number } {
  let lateCount = 0;
  const byId = new Map<string, FrameSource>();
  const late: FrameSource[] = [];
  for (const source of sources) {
    const { record, frame } = source;
    if (frame === null) {
      late.push(source);
      continue;
    }
    byId.set(source.requestId, source);
    if (frame === main) {
      record.frameKnown = true;
    } else if (source.placed) {
      // Known when the request started: kept, the frame may have moved on to another document since.
      record.frameKnown = true;
    } else {
      const chain = frameChain(frame, main, record.isNavigation);
      if (chain.complete) {
        record.frameUrls = chain.urls;
        record.frameKnown = true;
        lateCount += 1;
      } else {
        unknown(record);
      }
    }
  }
  // Web workers first, in the order of the requests (a worker can start a worker), then the preflights
  // (the request a preflight belongs to can be a worker's).
  const placedByUrl = new Map<string, CapturedRequest>();
  for (const source of [...sources].sort((a, b) => a.record.seq - b.record.seq)) {
    const { record } = source;
    if (source.frame === null && source.preflightOf === null) {
      // The worker belongs to the document that loaded its script: the latest earlier request of that address.
      const script = source.workerUrl === null ? undefined : placedByUrl.get(source.workerUrl);
      if (script === undefined) unknown(record);
      else place(record, script);
      byId.set(source.requestId, source);
    }
    if (record.frameKnown === true) placedByUrl.set(record.url, record);
  }
  for (const source of late) {
    if (source.preflightOf === null) continue;
    const pair = byId.get(source.preflightOf)?.record;
    if (pair === undefined || pair.frameKnown !== true) unknown(source.record);
    else place(source.record, pair);
  }
  return { late: lateCount, unknown: sources.filter((source) => source.record.frameKnown === false).length };
}
