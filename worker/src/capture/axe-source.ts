/**
 * The pinned axe-core (`axe-core/axe.min.js`, version in worker/package.json) as a string.
 * Wrangler bundles the file as text through the `Text` rule in `wrangler.scanner.jsonc` (and the lab
 * scan Worker's config); the capture injects it into the page over the browser protocol. Imported only by the Worker
 * entry point, so unit tests in Node never load it.
 */
import source from 'axe-core/axe.min.js';

export const AXE_SOURCE: string = source;
