import { describe, expect, it } from 'vitest';
import type { CapturedRequest } from '@website-check/scanner';
import { frameChain, resolveFrames, type FrameLike, type FrameSource } from '../src/capture/frames.ts';

/**
 * Session fix-a1, review findings 1 and 17: which document made a request is decided at the end of the
 * capture. The frames are plain objects that behave as Puppeteer's did in the review's reproduction: the
 * address of an iframe is empty until Puppeteer has learned it, a CORS preflight and a request of a web
 * worker have no frame.
 */

class FakeFrame implements FrameLike {
  address: string;
  readonly parent: FakeFrame | null;
  constructor(address: string, parent: FakeFrame | null) {
    this.address = address;
    this.parent = parent;
  }
  url(): string {
    return this.address;
  }
  parentFrame(): FakeFrame | null {
    return this.parent;
  }
}

const SITE = 'https://www.shop.example/';
const WIDGET = 'https://forms.widget-anbieter.example/embed';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter';

/** Records the request as the adapter's `request` handler does. */
function recorder(main: FakeFrame) {
  const sources: FrameSource[] = [];
  let id = 0;
  const add = (url: string, frame: FakeFrame | null, extra: { isNavigation?: boolean; preflightOf?: string; workerUrl?: string; requestId?: string } = {}): CapturedRequest => {
    const isNavigation = extra.isNavigation ?? false;
    const chain = frame === null ? { urls: [], complete: false } : frameChain(frame, main, isNavigation);
    const record: CapturedRequest = {
      seq: sources.length,
      url,
      method: 'GET',
      resourceType: isNavigation ? 'document' : 'other',
      startMs: sources.length * 10,
      endMs: null,
      status: 200,
      failure: null,
      isMainFrame: frame === main,
      frameUrls: chain.urls,
      isNavigation,
      initiator: null,
      redirectedFrom: null,
    };
    id += 1;
    sources.push({ record, frame, requestId: extra.requestId ?? `r${id}`, preflightOf: extra.preflightOf ?? null, workerUrl: extra.workerUrl ?? null, placed: chain.complete });
    return record;
  };
  return { sources, add };
}

describe('finding 1: an iframe whose address Puppeteer learns after its first requests', () => {
  it('the requests get the address the frame has at the end of the capture', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    add(SITE, main, { isNavigation: true });
    const widget = new FakeFrame('', main);
    const widgetDoc = add(WIDGET, widget, { isNavigation: true });
    // The race: the iframe's first requests arrive while its address is still empty.
    const fonts = add(FONTS, widget);
    const script = add('https://forms.widget-anbieter.example/app.js', widget);
    expect(fonts).toMatchObject({ isMainFrame: false, frameUrls: [] });
    widget.address = WIDGET;
    const late = add('https://forms.widget-anbieter.example/logo.png', widget);
    resolveFrames(sources, main);
    for (const record of [fonts, script, late]) expect(record).toMatchObject({ isMainFrame: false, frameUrls: [WIDGET], frameKnown: true });
    // The iframe's own document request is made in the page: the address it loads is not its frame.
    expect(widgetDoc).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: true });
  });

  it('a frame that never gets an address leaves its requests unknown, never requests of the page', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    const lost = new FakeFrame('', main);
    const fonts = add(FONTS, lost);
    resolveFrames(sources, main);
    expect(fonts).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: false });
  });

  it('a nested frame waits for every frame on the way, and about:blank and srcdoc frames are known', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    const outer = new FakeFrame('', main);
    const inner = new FakeFrame('https://inner.example/x', outer);
    const nested = add(FONTS, inner);
    const blank = add(FONTS, new FakeFrame('about:blank', main));
    const srcdoc = add(FONTS, new FakeFrame('about:srcdoc', main));
    const detached = add(FONTS, new FakeFrame('https://gone.example/', null));
    outer.address = WIDGET;
    resolveFrames(sources, main);
    expect(nested).toMatchObject({ frameUrls: ['https://inner.example/x', WIDGET], frameKnown: true });
    expect(blank).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: true });
    expect(srcdoc).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: true });
    expect(detached).toMatchObject({ frameKnown: false, frameUrls: [] });
  });

  it('an address known when the request started is kept, although the frame moved on', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    const frame = new FakeFrame(WIDGET, main);
    const first = add(FONTS, frame);
    frame.address = 'https://other.example/next';
    resolveFrames(sources, main);
    expect(first).toMatchObject({ frameUrls: [WIDGET], frameKnown: true });
  });
});

describe('finding 17: requests without a frame', () => {
  it('a CORS preflight gets the document of the request it belongs to, in either order', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    const widget = new FakeFrame(WIDGET, main);
    const early = add('https://px.trackco.example/collect', null, { preflightOf: 'post-1' });
    const post = add('https://px.trackco.example/collect', widget, { requestId: 'post-1' });
    const lateOne = add('https://px.trackco.example/collect', null, { preflightOf: 'post-1' });
    const ownPost = add('https://px.trackco.example/own', main, { requestId: 'post-2' });
    const ownPreflight = add('https://px.trackco.example/own', null, { preflightOf: 'post-2' });
    const orphan = add('https://px.trackco.example/refused', null, { preflightOf: 'never-sent' });
    resolveFrames(sources, main);
    expect(post).toMatchObject({ frameUrls: [WIDGET], frameKnown: true });
    for (const preflight of [early, lateOne]) expect(preflight).toMatchObject({ isMainFrame: false, frameUrls: [WIDGET], frameKnown: true });
    expect(ownPost).toMatchObject({ isMainFrame: true, frameKnown: true });
    expect(ownPreflight).toMatchObject({ isMainFrame: true, frameUrls: [], frameKnown: true });
    expect(orphan).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: false });
  });

  it('a request of a web worker gets the document that loaded the worker script', () => {
    const main = new FakeFrame(SITE, null);
    const { sources, add } = recorder(main);
    const widget = new FakeFrame(WIDGET, main);
    const workerUrl = 'https://forms.widget-anbieter.example/worker.js';
    add(workerUrl, widget);
    const fromWidgetWorker = add(FONTS, null, { workerUrl });
    add(`${SITE}top-worker.js`, main);
    const fromTopWorker = add(FONTS, null, { workerUrl: `${SITE}top-worker.js` });
    // A worker started by a worker: its script is a worker request itself.
    const nestedScript = add('https://forms.widget-anbieter.example/nested.js', null, { workerUrl });
    const fromNested = add(FONTS, null, { workerUrl: 'https://forms.widget-anbieter.example/nested.js' });
    // The preflight of a worker's request.
    const workerPost = add('https://px.trackco.example/collect', null, { workerUrl, requestId: 'wp' });
    const workerPreflight = add('https://px.trackco.example/collect', null, { preflightOf: 'wp' });
    const blobWorker = add(FONTS, null, { workerUrl: 'blob:https://www.shop.example/0000' });
    const noWorker = add(FONTS, null);
    resolveFrames(sources, main);
    expect(fromWidgetWorker).toMatchObject({ isMainFrame: false, frameUrls: [WIDGET], frameKnown: true });
    expect(fromTopWorker).toMatchObject({ isMainFrame: true, frameUrls: [], frameKnown: true });
    for (const record of [nestedScript, fromNested, workerPost, workerPreflight]) expect(record).toMatchObject({ isMainFrame: false, frameUrls: [WIDGET], frameKnown: true });
    for (const record of [blobWorker, noWorker]) expect(record).toMatchObject({ isMainFrame: false, frameUrls: [], frameKnown: false });
  });
});
