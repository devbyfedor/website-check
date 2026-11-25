import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { shortDate } from '../../lib/report-detail-view';
import { REVISION_TEXTS as R, WORK_ORDER_TEXTS as W } from '../../lib/report-stage-d-texts';
import { priorityItems, REPORT_TIME_ZONE } from '../../lib/report-view';
import s from './report.module.css';
import { ScrollBox } from './scroll-box';

// The parts of bericht.html that are stage D (brief: rendered only for the example JSON, behind a flag that is off in
// production): the "Revisionen" and the "Arbeitsauftrag" of the help block. The flag is the example build: only the
// example page of the report (app/bericht/beispiel/page.example.tsx, built with WC_EXAMPLES=1 only) imports this file,
// and web/scripts/next.ts fails a production build that contains its texts.

/** The triangle of a revision (bericht.html): closed for a revision there is, dashed for the next one. */
function Triangle({ letter, open }: { letter: string; open: boolean }) {
  return (
    <svg width="30" height="26" viewBox="0 0 30 26" role="img" aria-label={open ? R.labelOpen(letter) : R.label(letter)}>
      <path className={open ? `${s.revp} ${s.revpOpen}` : s.revp} d="M15 2L28 24H2Z" />
      <text className={s.revt} x="15" y="19">
        {letter}
      </text>
    </svg>
  );
}

// "Revisionen": revision A of the report (its date, "Erstprüfung", the findings with the manual checks and the
// priorities, as docs/report-schema.md names them), the open revision B and the note how a fixed finding will look.
export function Revisions({ report, timeZone = REPORT_TIME_ZONE }: { report: Report; timeZone?: string }) {
  const first = priorityItems(report)[0];
  const date = report.scan.scannedAt ?? report.createdAt;
  return (
    <section className={s.sec}>
      <div className={s.sech}>
        <h2 id="revisionen" className={s.h2s}>
          {R.heading}
        </h2>
        <span className={`${s.mut} text-[15px]`}>{R.lead}</span>
      </div>
      <ScrollBox labelledBy="revisionen">
        <table className={s.mt}>
          <thead>
            <tr>
              {R.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Triangle letter={report.revision.letter} open={false} />
              </td>
              <td className={s.num}>{shortDate(date, timeZone)}</td>
              <td>{R.initial}</td>
              <td>
                <b>{R.findings(report.counts.findings + report.counts.manual)}</b>
                {R.ofWhich(report.priorities.length)}
              </td>
            </tr>
            <tr>
              <td>
                <Triangle letter="B" open />
              </td>
              <td className={`${s.num} ${s.mut}`}>{R.open}</td>
              <td>{R.afterFix}</td>
              <td>
                <button type="button" className={s.gb}>
                  {R.again}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </ScrollBox>
      {first === undefined ? null : (
        <div className={s.note}>
          <span className={`${s.mut} text-[14px]`}>{R.doneNote}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[17px]">
            <span className={s.strike}>
              <PhraseText phrase={first.title} />
            </span>
            <span className={s.feld}>{R.fixedIn('B')}</span>
          </span>
        </div>
      )}
    </section>
  );
}

/** The line and the button of the "Arbeitsauftrag" in the help block. */
export const WORK_ORDER = {
  line: <p className={`${s.mut} m-0 text-[15px]`}>{W.developer}</p>,
  link: (
    <a className={s.gl} href={W.href}>
      {W.link}
    </a>
  ),
};
