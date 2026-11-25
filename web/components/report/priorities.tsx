import type { Report } from '@website-check/scanner/report';
import type { MarkPlace } from '../scan/scan-data';
import { PhraseText } from '../scan/phrase';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { measured, planLabel, planMarks, prioritiesHeading, priorityItems } from '../../lib/report-view';
import s from './report.module.css';

// The red marks of the plan by their place (bericht.html): the shape, its draw delay, the number's place and delay.
// The timings belong to the place, as in the reference (heading 0.4 s, source code 0.9 s, subline 1.4 s).
const MARKS: Record<MarkPlace, { d: string; drawDelay: string; x: number; y: number; popDelay: string }> = {
  heading: { d: 'M18 190c0-15 72-21 150-20s152 8 150 21-82 19-160 18S18 205 18 190z', drawDelay: '.4s', x: 342, y: 186, popDelay: '1.2s' },
  source: { d: 'M24 351c0-12 18-17 29-16s30 4 30 16-17 16-30 15-29-3-29-15z', drawDelay: '.9s', x: 104, y: 351, popDelay: '1.6s' },
  subline: { d: 'M30 227c10-5 20 4 30 0s20 4 30 0 20 4 30 0 20 4 30 0 20 4 30 0', drawDelay: '1.4s', x: 200, y: 216, popDelay: '2s' },
};
const ORDER: MarkPlace[] = ['heading', 'source', 'subline'];

// The plan of the homepage with the fields A to D and 1 to 3, and a red mark where a priority lies (the same places
// as on the scan screen; a field without a mark of the design is named only by its caption in the list).
function Plan({ report }: { report: Report }) {
  const marks = new Map(planMarks(report).map((m) => [m.place, m.text]));
  const placed = ORDER.filter((p) => marks.has(p));
  return (
    <svg viewBox="-22 -28 504 412" role="img" aria-label={planLabel(report)} className="block h-auto w-full">
      <text className={s.zone} x="67.5" y="-12">
        A
      </text>
      <text className={s.zone} x="182.5" y="-12">
        B
      </text>
      <text className={s.zone} x="297.5" y="-12">
        C
      </text>
      <text className={s.zone} x="412.5" y="-12">
        D
      </text>
      <text className={s.zone} x="-10" y="70">
        1
      </text>
      <text className={s.zone} x="-10" y="190">
        2
      </text>
      <text className={s.zone} x="-10" y="310">
        3
      </text>
      <path className={s.zt} d="M125 2V10M240 2V10M355 2V10M2 130H10M2 250H10" />
      <path className={s.sk} d="M10 10H470V370H10Z" />
      <path className={s.skt} d="M10 44H470" />
      <path className={s.sk} d="M30 60H450V160H30Z" />
      <path className={s.skt} d="M30 60L450 160M450 60L30 160" />
      <path className={s.skh} d="M30 190H300" />
      <path className={s.skt} d="M30 216H180" />
      <path className={s.sk} d="M30 236H160V300H30Z" />
      <path className={s.sk} d="M175 236H305V300H175Z" />
      <path className={s.sk} d="M320 236H450V300H320Z" />
      <path className={s.skt} d="M10 330H470" />
      <path className={s.sk} d="M44 344l-9 7 9 7M62 344l9 7-9 7M57 340l-8 22" />
      {placed.map((place) => {
        const m = MARKS[place];
        return [
          <path key={`${place}-mark`} className={`${s.rp} ${s.draw}`} pathLength={1} d={m.d} style={{ animationDelay: m.drawDelay }} />,
          <text key={`${place}-number`} className={`${s.rpt} ${s.pop}`} x={m.x} y={m.y} style={{ animationDelay: m.popDelay }}>
            {marks.get(place)}
          </text>,
        ];
      })}
    </svg>
  );
}

// "Drei Dinge sollten Sie zuerst beheben" (bericht.html): the priorities of the report with number, title, area and
// risk, and the "Feld" caption when the report names the field; beside them the plan. Session B3 part 2: the heading
// follows the number of priorities (drafts for two, one and none); a report that measured no homepage (blocked,
// refused, failed, an almost empty page) has no such section.
export function Priorities({ report }: { report: Report }) {
  if (!measured(report)) return null;
  const items = priorityItems(report);
  const { heading, none } = prioritiesHeading(report);
  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-12">
      <div className="flex min-w-0 flex-col gap-[22px]">
        <h2 className={s.h2s}>{heading}</h2>
        {none === null ? null : <p className={s.bodys}>{none}</p>}
        {items.length === 0 ? null : (
        <ol className="m-0 flex list-none flex-col gap-[22px] p-0">
          {items.map((p) => (
            <li key={p.number} className="flex items-start gap-4">
              <span className={s.pencil} aria-hidden="true">
                {p.number}
              </span>
              <div className="flex flex-col gap-1.5">
                <a href={p.href} className="font-head text-[22px] leading-[1.2] font-semibold text-ink! no-underline">
                  <PhraseText phrase={p.title} />
                </a>
                {/* One text node before the caption, as in the reference ("Datenschutz, hohes Risiko "). */}
                <span className={`${s.mut} text-[15.5px]`}>
                  {p.field === null ? p.meta : `${p.meta} `}
                  {p.field === null ? null : <span className={s.feld}>{p.field}</span>}
                </span>
              </div>
            </li>
          ))}
        </ol>
        )}
      </div>
      <Plan report={report} />
    </section>
  );
}
