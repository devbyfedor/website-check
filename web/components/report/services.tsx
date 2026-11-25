import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { DETAIL_TEXTS as T } from '../../lib/report-detail-texts';
import { serviceRows } from '../../lib/report-detail-view';
import s from './report.module.css';
import { ScrollBox } from './scroll-box';

const TONE = { bad: s.tBad, ok: s.tOk, mid: s.tMid } as const;

// "Stückliste der fremden Dienste" (bericht.html): one row per service of the report, in its order. The name of a known
// service is ours (the rules data); the name of an unknown one is a string of the page (<bdi>). The table scrolls sideways
// inside its box when the window is narrow (WCAG 1.4.10 allows it for a data table). The copy button has no behaviour yet
// (B4 part 2). Session B4 part 1: shown for the example of the reference; a report without services is part 2.
export function Services({ report }: { report: Report }) {
  const rows = serviceRows(report);
  if (rows.length === 0) return null;
  return (
    <section className={s.sec}>
      <div className={s.sech}>
        <h2 id="stueckliste" className={s.h2s}>
          {T.servicesHeading}
        </h2>
        <span className={`${s.mut} text-[15px]`}>{T.servicesFound(rows.length)}</span>
      </div>
      <ScrollBox labelledBy="stueckliste">
        <table className={s.mt}>
          <thead>
            <tr>
              {T.serviceColumns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.position}>
                <td>
                  <span className={s.pos}>{row.position}</span>
                </td>
                <td>
                  <b>
                    <PhraseText phrase={row.name} />
                  </b>
                  <br />
                  <span className={`${s.mut} text-[14px]`}>{row.small}</span>
                </td>
                <td>{row.provider}</td>
                <td>{row.data}</td>
                <td>{row.starts}</td>
                <td>
                  <span className={`${s.tag} ${TONE[row.tag.tone]}`}>{row.tag.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="button" className={s.gb}>
          {T.copyList}
        </button>
        <span className={`${s.mut} text-[15px]`}>{T.copyNote}</span>
      </div>
    </section>
  );
}
