'use client';

import { useState, type ReactNode } from 'react';
import { DETAIL_TEXTS as D, HEAD_ACTION_TEXTS as H } from '../../lib/report-detail-texts';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import s from './report.module.css';

type Outcome = 'idle' | 'done' | 'failed';

/**
 * Copies a text and says so (session B4 part 2): the label of the button changes after copying (the reference: "Liste
 * kopiert"), and a status region that is there from the first paint says it to a screen reader, on every click again
 * (a new node in the region). A browser without the clipboard, or one that refuses it, gets a message instead.
 */
function useCopy(): { outcome: Outcome; said: number; copy: (text: string) => Promise<void> } {
  const [outcome, setOutcome] = useState<Outcome>('idle');
  const [said, setSaid] = useState(0);
  const copy = async (text: string) => {
    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setOutcome('done');
    } catch {
      setOutcome('failed');
    }
    setSaid((n) => n + 1);
  };
  return { outcome, said, copy };
}

/** The status region next to a copy button: empty until the first click. */
function Said({ said, text }: { said: number; text: string }) {
  return (
    <span role="status" className="sr-only">
      {said === 0 ? null : <span key={said}>{text}</span>}
    </span>
  );
}

/** "Liste für die Datenschutzerklärung kopieren" of the Stückliste (bericht.html, design/README.md). */
export function CopyListButton({ text }: { text: string }) {
  const { outcome, said, copy } = useCopy();
  return (
    <>
      <button type="button" className={s.gb} onClick={() => void copy(text)}>
        {outcome === 'done' ? D.copiedList : D.copyList}
      </button>
      <Said said={said} text={outcome === 'done' ? D.copiedList : D.copyListFailed} />
      {outcome === 'failed' ? <span className={`${s.mut} text-[15px]`}>{D.copyListFailed}</span> : null}
    </>
  );
}

/**
 * The actions of the head (Fedor, B3 part 2, answer 2): "Als PDF speichern" opens the print dialog of the browser
 * (the print styles of the report leave out the buttons, the navigation and the dark background); "Link kopieren"
 * copies the address of the report and then says "Link kopiert". "An Entwickler weitergeben" is stage D: only the
 * example page passes it (`developer`).
 */
export function HeadActions({ developer }: { developer?: ReactNode }) {
  const { outcome, said, copy } = useCopy();
  const link = () => `${window.location.origin}${window.location.pathname}${window.location.search}`;
  return (
    <div className="flex flex-wrap gap-2.5">
      <button type="button" className={s.gb} onClick={() => window.print()}>
        {T.savePdf}
      </button>
      <button type="button" className={s.gb} onClick={() => void copy(link())}>
        {outcome === 'done' ? H.copiedLink : T.copyLink}
      </button>
      {developer}
      <Said said={said} text={outcome === 'done' ? H.copiedLink : H.copyLinkFailed} />
      {outcome === 'failed' ? <span className={`${s.mut} basis-full text-[15px]`}>{H.copyLinkFailed}</span> : null}
    </div>
  );
}
