import { Fragment } from 'react';
import type { Phrase } from './scan-data';

// A text of the scan screen (scan-data.ts, `Phrase`). Our own text is a plain text node; a string of the scanned site
// or the visitor is a text node of its own in <bdi>, so a right-to-left text cannot turn the sentence around it, and
// it breaks anywhere when it is long (docs/report-schema.md, "Strings of the scanned page"). Never markup.
export function PhraseText({ phrase }: { phrase: Phrase }) {
  if (typeof phrase === 'string') return phrase;
  return (
    <>
      {phrase.map((part, i) =>
        typeof part === 'string' ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <bdi key={i} className="wrap-anywhere">
            {part.page}
          </bdi>
        ),
      )}
    </>
  );
}
