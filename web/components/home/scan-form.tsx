'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formMessage, isAddressProblem, type FormProblem, type ShownProblem } from '../../lib/form-view';
import { cancelScan, startScan } from '../../lib/scan-api';
import { recallScan, rememberScan } from '../../lib/scan-store';
import s from './scan-form.module.css';

/** How long the message stays empty before a new one, so the same message again is announced again. */
const REANNOUNCE_MS = 60;

export interface ScanFormProps {
  /** The example pages of the states only (session B2 part 3): the address in the field and the problem shown. */
  initialValue?: string;
  initialProblem?: ShownProblem;
  /** The example pages only: the time zone of the message, so building and running give the same text. */
  timeZone?: string;
}

// The title block ("Schriftfeld") with the address field and the start button. Session B2 part 2: the form starts a
// scan through the API and leads to the scan screen (`/pruefung?id=…`); the address and the cancel token go along in
// this tab's sessionStorage, never in the address. Session B2 part 3: a refused start shows its message under the
// button, in a region with role="alert" that is there from the first paint, tied to the field by aria-describedby
// (aria-invalid when the address is the problem); the focus goes back to the field. `noValidate`: a bare
// "ihre-website.de" is a valid entry, which type="url" would reject; the API checks the address.
export function ScanForm({ initialValue, initialProblem, timeZone }: ScanFormProps = {}) {
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ShownProblem | null>(initialProblem ?? null);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // "Zurück" from the scan screen can bring this page back from the browser's cache with `busy` still set.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pageshow', onShow);
      window.clearTimeout(timer.current);
    };
  }, []);
  const show = (problem: FormProblem) => {
    setShown(null);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setShown({ problem, at: Date.now() });
      if (document.activeElement !== field.current) field.current?.focus();
    }, REANNOUNCE_MS);
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    if (url === '') {
      show({ kind: 'empty' });
      return;
    }
    setBusy(true);
    void startScan(url).then((answer) => {
      if (!answer.ok) {
        setBusy(false);
        show(answer.refusal);
        return;
      }
      const scan = answer.value;
      // The same address again from this tab while its scan still waits: the tab keeps the token it has, and the new
      // one is given back at once, so no token stays with the job that nobody holds (review of B2 part 2).
      const known = recallScan(scan.id)?.cancelToken ?? null;
      if (known !== null && scan.cancelToken !== null && known !== scan.cancelToken) void cancelScan(scan.id, scan.cancelToken);
      rememberScan(scan.id, { displayHost: scan.displayHost, cancelToken: known ?? scan.cancelToken });
      window.location.assign(`/pruefung?id=${scan.id}`);
    });
  };
  const message = shown === null ? '' : formMessage(shown, timeZone);
  return (
    <form className="flex flex-col" noValidate onSubmit={onSubmit}>
      <div className={s.tb}>
        <div className={s.tbl}>
          <label htmlFor="objekt">Objekt</label>
        </div>
        <div className={s.tbv}>
          <input
            ref={field}
            id="objekt"
            name="url"
            className={s.fieldb}
            type="url"
            placeholder="ihre-website.de"
            {...(initialValue !== undefined ? { defaultValue: initialValue } : {})}
            {...(shown !== null ? { 'aria-describedby': 'objekt-fehler' } : {})}
            {...(shown !== null && isAddressProblem(shown.problem) ? { 'aria-invalid': true } : {})}
            onInput={() => setShown(null)}
          />
        </div>
        <div className={s.tbl}>Prüfumfang</div>
        <div className={s.tbv}>Startseite und Impressum</div>
        <div className={s.tbl}>Maßstab</div>
        <div className={s.tbv}>DSGVO, DDG, BFSG und WCAG 2.1</div>
        <div className={s.tbl}>Dauer</div>
        <div className={s.tbv}>etwa 30 Sekunden, kostenlos</div>
      </div>
      <button type="submit" className={s.btnb}>
        Website prüfen
      </button>
      {/* Empty (and without height) until a start is refused; there from the first paint, so its text is announced. */}
      <p id="objekt-fehler" role="alert" className={message === '' ? 'm-0' : 'm-0 mt-4 text-[16px] leading-[1.5] text-pencil-light'}>
        {message}
      </p>
    </form>
  );
}
