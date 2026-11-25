import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { titleBlock } from '../../lib/report-detail-view';
import s from './report.module.css';

// The title block at the foot of the sheet (bericht.html, `.stb`): Benennung, Objekt (the domain of the report, a string
// of the visitor in <bdi>), Datum, Revision, Blatt, Geprüft.
export function TitleBlock({ report, timeZone }: { report: Report; timeZone?: string }) {
  return (
    <div className={s.stb}>
      {titleBlock(report, timeZone).map((cell) => (
        <div key={cell.label}>
          <span>{cell.label}</span>
          <strong className="wrap-anywhere">
            <PhraseText phrase={cell.value} />
          </strong>
        </div>
      ))}
    </div>
  );
}
