import type { RequestInitiator } from './types.ts';

/**
 * Helpers for data that comes from the Chrome DevTools Protocol (CDP), shared by the local
 * adapter (initiators) and the Cloudflare adapter (request events). Pure functions.
 */

export interface CdpStack {
  callFrames: { url: string }[];
  parent?: CdpStack;
}

/** `Network.Initiator` as sent with `Network.requestWillBeSent`. */
export interface CdpInitiator {
  type: string;
  url?: string;
  stack?: CdpStack;
}

/** Who triggered a request: the initiator URL, or else the first script URL on the stack. */
export function toInitiator(initiator: CdpInitiator): RequestInitiator {
  let url: string | null = initiator.url !== undefined && initiator.url !== '' ? initiator.url : null;
  let stack = initiator.stack;
  while (url === null && stack !== undefined) {
    url = stack.callFrames.find((frame) => frame.url !== '')?.url ?? null;
    stack = stack.parent;
  }
  return { type: initiator.type, url };
}

/** CDP sends headers as an object (Network domain) or as a list of name/value pairs (Fetch domain). */
export function lowerCaseHeaders(headers: Record<string, string> | readonly { name: string; value: string }[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers === undefined) return result;
  const entries: [string, string][] = Array.isArray(headers)
    ? (headers as readonly { name: string; value: string }[]).map((h) => [h.name, h.value])
    : Object.entries(headers as Record<string, string>);
  for (const [name, value] of entries) {
    const key = name.toLowerCase();
    // Repeated headers (set-cookie, link, …) are joined the way browsers present them.
    result[key] = result[key] === undefined ? value : `${result[key]}\n${value}`;
  }
  return result;
}
