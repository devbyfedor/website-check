import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { CHECKS_TEXTS as T } from '../../lib/report-checks-texts';
import { checkItems } from '../../lib/report-checks-view';
import { REPORT_TEXTS } from '../../lib/report-texts';
import s from './report.module.css';

// The manual checks and hints under the finding details (session B5 part 2, Fedor's decision; a state the design does not
// show). Built from elements of bericht.html: the head of a section with its count ("Stückliste", "5 Dienste gefunden"),
// a list like the one of "Drei Dinge" (no numbers: these are no priorities), the grey tag of the Stückliste, h3s and
// bodys of the finding details, and the field of the plan. Nothing in it takes focus, so the order of Tab stays the
// reference's. Shown only when there is at least one item.
export function CheckList({ report }: { report: Report }) {
  const items = checkItems(report);
  if (items.length === 0) return null;
  return (
    <section className={s.sec} data-part="checks">
      <div className={s.sech}>
        <h2 className={s.h2s}>{T.heading}</h2>
        <span className={`${s.mut} text-[15px]`}>{T.count(items.length)}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-[22px] p-0">
        {items.map((item) => (
          <li key={item.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
              <span className={`${s.tag} ${s.tMid}`}>{item.tag}</span>
              <h3 className={`${s.h3s} m-0!`}>
                <PhraseText phrase={item.title} />
              </h3>
              {item.field === null ? null : <span className={s.feld}>{REPORT_TEXTS.field(item.field)}</span>}
            </div>
            <p className={s.bodys}>
              <PhraseText phrase={item.text} />
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
