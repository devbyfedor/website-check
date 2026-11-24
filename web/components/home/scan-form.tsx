'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { cancelScan, startScan } from '../../lib/scan-api';
import { recallScan, rememberScan } from '../../lib/scan-store';
import { SCAN_TEXTS } from '../../lib/scan-texts';
import s from './scan-form.module.css';

// The title block ("Schriftfeld") with the address field and the start button. Session B2 part 2: the form starts a
// scan through the API and leads to the scan screen (`/pruefung?id=…`); the address and the cancel token go along in
// this tab's sessionStorage, never in the address. Every answer with an error gets one temporary message for now (the
// states are part 3). `noValidate`: a bare "ihre-website.de" is a valid entry, which type="url" would reject; the API
// checks the address.
export function ScanForm() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // "Zurück" from the scan screen can bring this page back from the browser's cache with `busy` still set.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    if (url === '') {
      setFailed(true);
      return;
    }
    setBusy(true);
    void startScan(url).then((answer) => {
      if (!answer.ok) {
        setBusy(false);
        setFailed(true);
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
  return (
    <form className="flex flex-col" noValidate onSubmit={onSubmit}>
      <div className={s.tb}>
        <div className={s.tbl}>
          <label htmlFor="objekt">Objekt</label>
        </div>
        <div className={s.tbv}>
          <input
            id="objekt"
            name="url"
            className={s.fieldb}
            type="url"
            placeholder="ihre-website.de"
            {...(failed ? { 'aria-describedby': 'objekt-fehler' } : {})}
            onInput={() => setFailed(false)}
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
      {failed ? (
        <p id="objekt-fehler" role="alert" className="m-0 mt-4 text-[16px] leading-[1.5] text-pencil-light">
          {SCAN_TEXTS.formError}
        </p>
      ) : null}
    </form>
  );
}
