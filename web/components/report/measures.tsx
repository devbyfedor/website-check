import type { Report } from '@website-check/scanner/report';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { measureRows, type MeasureRow } from '../../lib/report-view';
import s from './report.module.css';
import { ScrollBox } from './scroll-box';

const TONE = { bad: s.rBad, ok: s.rOk, mid: s.rMid } as const;
// The marks of "Ergebnis" (bericht.html): a cross, a tick, a dash.
const ICON = { bad: 'M4 4l10 10M14 4L4 14', ok: 'M3 9.5l4 4L15 4.5', mid: 'M4 9h10' } as const;

function Result({ result }: { result: MeasureRow['result'] }) {
  return (
    <span className={`${s.res} ${TONE[result.tone]}`}>
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d={ICON[result.tone]} />
      </svg>
      {result.label}
    </span>
  );
}

// "Prüfmaße" (bericht.html): Merkmal, Soll, Ist and Ergebnis of every row of `measures`, in their order. The table
// scrolls sideways inside its box when the window is narrow (WCAG 1.4.10 allows it for a data table).
export function Measures({ report }: { report: Report }) {
  return (
    <section className={s.sec}>
      <div className={s.sech}>
        <h2 id="pruefmasse" className={s.h2s}>
          {T.measuresHeading}
        </h2>
        <span className={`${s.mut} text-[15px]`}>{T.measuresLead}</span>
      </div>
      <ScrollBox labelledBy="pruefmasse">
        <table className={s.mt}>
          <thead>
            <tr>
              {T.columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {measureRows(report).map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td className={s.num}>{row.target}</td>
                <td className={row.bad ? `${s.num} ${s.bad}` : s.num}>{row.actual}</td>
                <td>
                  <Result result={row.result} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <p className={`${s.mut} m-0 text-[15px]`}>
        {T.bfsgBefore}
        <a href="/bfsg">{T.bfsgLink}</a>
        {T.bfsgAfter}
      </p>
    </section>
  );
}
