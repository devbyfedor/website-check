'use client';

import type { FormEvent } from 'react';

// The title block with the address field and the start button. In B1 the form sends nothing;
// B2 connects it to the API. `noValidate`: the address check is B2's (a bare "ihre-website.de"
// is a valid entry, which the browser's own check of type="url" would reject).
export function ScanForm() {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };
  return (
    <form className="flex flex-col" noValidate onSubmit={onSubmit}>
      <div className="tb">
        <div className="tbl">
          <label htmlFor="objekt">Objekt</label>
        </div>
        <div className="tbv">
          <input id="objekt" name="url" className="fieldb" type="url" placeholder="ihre-website.de" />
        </div>
        <div className="tbl">Prüfumfang</div>
        <div className="tbv">Startseite und Impressum</div>
        <div className="tbl">Maßstab</div>
        <div className="tbv">DSGVO, DDG, BFSG und WCAG 2.1</div>
        <div className="tbl">Dauer</div>
        <div className="tbv">etwa 30 Sekunden, kostenlos</div>
      </div>
      <button type="submit" className="btnb">
        Website prüfen
      </button>
    </form>
  );
}
