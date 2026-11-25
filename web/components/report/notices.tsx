import type { Report } from '@website-check/scanner/report';
import { STATE_DRAFTS as D } from '../../lib/report-texts';
import { noticeLines } from '../../lib/report-view';
import s from './report.module.css';

// The note under the head of a report that is not a plain complete check (session B3 part 2): the quick check, a
// blocked, refused or failed check, an almost empty page, a page still loading, lists and texts read only in part.
// Not designed: built from the dashed box of the "Revisionen" in bericht.html ("So erscheint ein erledigter Fund …"),
// its small grey label and its larger line. Nothing for a plain complete check.
export function Notices({ report }: { report: Report }) {
  const lines = noticeLines(report);
  if (lines.length === 0) return null;
  return (
    <div className={s.note}>
      <span className={`${s.mut} text-[14px]`}>{D.noteLabel}</span>
      {lines.map((line) => (
        <p key={line} className="m-0 text-[17px]">
          {line}
        </p>
      ))}
    </div>
  );
}
