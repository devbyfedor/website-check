'use client';

import type { FormEvent } from 'react';
import s from './scan-form.module.css';

// The title block ("Schriftfeld") with the address field and the start button. In B1 the form sends nothing;
// B2 connects it to the API. `noValidate`: the address check is B2's (a bare "ihre-website.de"
// is a valid entry, which the browser's own check of type="url" would reject).
export function ScanForm() {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };
  return (
    <form className="flex flex-col" noValidate onSubmit={onSubmit}>
      <div className={s.tb}>
        <div className={s.tbl}>
          <label htmlFor="objekt">Objekt</label>
        </div>
        <div className={s.tbv}>
          <input id="objekt" name="url" className={s.fieldb} type="url" placeholder="ihre-website.de" />
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
    </form>
  );
}
