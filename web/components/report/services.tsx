import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { DETAIL_TEXTS as T } from '../../lib/report-detail-texts';
import { copyListText, serviceRows } from '../../lib/report-detail-view';
import { CopyListButton } from './copy-actions';
import s from './report.module.css';
import { ScrollBox } from './scroll-box';

const TONE = { bad: s.tBad, ok: s.tOk, mid: s.tMid } as const;

// "Stückliste der fremden Dienste" (bericht.html): one row per service of the report, in its order. The name of a known
// service is ours (the short name of the rules data); the name of an unknown one is a string of the page (<bdi>). The
// table scrolls sideways inside its box when the window is narrow (WCAG 1.4.10 allows it for a data table).
// Session B4 part 2: the copy button puts the list on the clipboard as the reference's script does ("Liste kopiert");
// a service whose finding sent data before consent names the country of the visit under "vor der Einwilligung"; a
// report without services has no Stückliste.
export function Services({ report, timeZone }: { report: Report; timeZone?: string }) {
  const rows = serviceRows(report);
  if (rows.length === 0) return null;
  return (
    <section className={s.sec}>
      <div className={s.sech}>
        <h2 id="stueckliste" className={s.h2s}>
          {T.servicesHeading}
        </h2>
        {/* A cut list (more than 80 services) counts every service found; the note under the head says it is cut. */}
        <span className={`${s.mut} text-[15px]`}>{T.servicesFound(report.truncated.services ? report.counts.services : rows.length)}</span>
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
                <td>
                  {row.starts}
                  {row.country === null ? null : (
                    <>
                      <br />
                      <span className={`${s.mut} text-[14px]`}>{row.country}</span>
                    </>
                  )}
                </td>
                <td>
                  <span className={`${s.tag} ${TONE[row.tag.tone]}`}>{row.tag.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <CopyListButton text={copyListText(report, timeZone)} />
        <span className={`${s.mut} text-[15px]`}>{T.copyNote}</span>
      </div>
    </section>
  );
}
