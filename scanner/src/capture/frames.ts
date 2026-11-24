import type { Capture, CapturedRequest } from './types.ts';

/**
 * True when nobody knows which document made the request, so it may come from an embedded third-party
 * page as well as from the site itself (session fix-a1). Such a request is never evidence against the
 * site on its own: analyzers treat a service seen only in such requests as "bitte manuell prüfen".
 *
 * The adapters say so themselves (`frameKnown`). Captures of the Cloudflare adapter saved before that
 * field existed recorded a CORS preflight, a request of a web worker and a request of an iframe whose
 * address was not known yet all the same way: not the top-level document and no iframe address. There
 * they cannot be told apart from a request of an `about:blank` iframe of the page itself, so all of
 * them count as unknown. Captures of the deleted strategy (b) (`resource-timing`, saved in A2 and A3, see
 * `CaptureStrategy`) never recorded frames and are not marked unknown, as before.
 */
export function frameUnknown(capture: Pick<Capture, 'adapter' | 'strategy'>, request: CapturedRequest): boolean {
  if (request.frameKnown !== undefined) return !request.frameKnown;
  if (capture.adapter !== 'cloudflare-browser-run' || capture.strategy === 'resource-timing') return false;
  return !request.isMainFrame && request.frameUrls.length === 0 && !request.isNavigation && request.resourceType !== 'websocket';
}
