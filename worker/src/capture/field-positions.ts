import type { CDPSession } from '@cloudflare/puppeteer';
import type { AxeCapture } from '@website-check/scanner';
import { withTimeout } from './common.ts';

/**
 * Lab measurement only (Fedor, message of A5 part 3, answer 2): what reading the positions of the elements
 * behind the findings would cost per page, for the "Feld B2" marks of the design (a 4 × 3 grid over the
 * homepage). One evaluation in the page reads the boxes of the axe examples and of every element that loads
 * a file from another host (script, stylesheet, image, frame, media, embed) and maps them to the grid.
 * Nothing of it goes into the capture or the report; Fedor decides from the numbers whether the field stays.
 */

export function fieldPositionsExpression(axeTargets: readonly (readonly string[])[]): string {
  return `(() => {
  const targets = ${JSON.stringify(axeTargets)};
  const width = Math.max(document.documentElement.scrollWidth, window.innerWidth, 1);
  const height = Math.max(document.documentElement.scrollHeight, window.innerHeight, 1);
  const fieldOf = (rect) => {
    const x = rect.left + window.scrollX + rect.width / 2;
    const y = rect.top + window.scrollY + rect.height / 2;
    const col = Math.min(3, Math.max(0, Math.floor((x / width) * 4)));
    const row = Math.min(2, Math.max(0, Math.floor((y / height) * 3)));
    return 'ABCD'[col] + String(row + 1);
  };
  const elements = [];
  for (const target of targets) {
    try {
      let root = document;
      for (let i = 0; i < target.length - 1 && root; i += 1) root = root.querySelector(target[i])?.shadowRoot ?? null;
      const el = root ? root.querySelector(target[target.length - 1]) : null;
      if (el) elements.push(el);
    } catch (e) {}
  }
  const own = location.hostname;
  for (const el of document.querySelectorAll('script[src],link[href],img[src],iframe[src],source[src],video[src],audio[src],embed[src],object[data]')) {
    const value = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('data') || '';
    try {
      const host = new URL(value, location.href).hostname;
      if (host && host !== own) elements.push(el);
    } catch (e) {}
  }
  const fields = {};
  let boxes = 0;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    boxes += 1;
    const field = fieldOf(rect);
    fields[field] = (fields[field] || 0) + 1;
  }
  return { elements: elements.length, boxes, fields };
})()`;
}

/** `leftMs`: time left before the page's hard limit; the measurement never runs into it (review of A5 part 3). */
export async function measureFieldPositions(client: CDPSession, axe: AxeCapture | null, leftMs = 4_000): Promise<{ ms: number; elements: number; boxes: number; failed: boolean }> {
  if (leftMs < 500) return { ms: 0, elements: 0, boxes: 0, failed: true };
  const targets: string[][] = [];
  for (const rule of Object.values(axe?.rules ?? {})) {
    for (const example of rule?.examples ?? []) if (Array.isArray(example.target) && example.target.length > 0) targets.push(example.target.map(String));
  }
  const started = Date.now();
  try {
    const response = (await withTimeout(client.send('Runtime.evaluate', { expression: fieldPositionsExpression(targets), returnByValue: true }), Math.min(4_000, leftMs))) as {
      result?: { value?: { elements?: number; boxes?: number } };
    };
    return { ms: Date.now() - started, elements: response.result?.value?.elements ?? 0, boxes: response.result?.value?.boxes ?? 0, failed: false };
  } catch {
    return { ms: Date.now() - started, elements: 0, boxes: 0, failed: true };
  }
}
