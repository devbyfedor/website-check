import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { REPORT_TEXTS as T } from '../../lib/report-texts';
import { timelineView } from '../../lib/report-view';
import s from './report.module.css';
import { ScrollBox } from './scroll-box';

// "Zeitschnitt A–A: die ersten drei Sekunden" (bericht.html): one row per host of the first three seconds with its
// bar, the cut A–A at the moment the banner became visible, the axis and the legend. Hosts and providers are strings
// of the report: text nodes in <bdi>. The chart scrolls sideways inside its box when the window is narrow.
export function Timeline({ report }: { report: Report }) {
  const view = timelineView(report);
  if (view === null) return null;
  const cut = view.cut;
  return (
    <section className={s.sec}>
      <div className={s.sech}>
        <h2 id="zeitschnitt" className={s.h2s}>
          {T.timelineHeading}
        </h2>
      </div>
      <p className={`${s.bodys} max-w-[46em]`}>{T.timelineLead}</p>
      <ScrollBox labelledBy="zeitschnitt">
        <div className="min-w-[720px]">
          <div className={`${s.trow} ${s.trowShort}`}>
            <span className={`${s.tlab} ${s.mut}`}>{T.timelineAxis}</span>
            <div className="relative h-11 text-[12.5px] text-ink-muted">
              {view.ticks.map((t) =>
                t.edge === 'start' ? (
                  <span key={t.text} className="absolute bottom-1 left-0">
                    {t.text}
                  </span>
                ) : t.edge === 'end' ? (
                  <span key={t.text} className="absolute right-0 bottom-1">
                    {t.text}
                  </span>
                ) : (
                  <span key={t.text} className="absolute bottom-1 -translate-x-1/2" style={{ left: t.left ?? undefined }}>
                    {t.text}
                  </span>
                ),
              )}
              {cut === null ? null : (
                <span className={`${s.cutl} top-0`} style={{ left: cut.left }}>
                  {T.cutLetter}
                </span>
              )}
            </div>
          </div>
          {view.rows.map((row, i) => (
            <div key={i} className={s.trow}>
              <span className={s.tlab}>
                <PhraseText phrase={row.label} />
                <small>
                  <PhraseText phrase={row.small} />
                </small>
              </span>
              <div className={s.track}>
                <span className={`${s.bar} ${row.party === 'own' ? s.own : s.ext}`} style={{ left: row.left, width: row.width }} />
                {cut === null ? null : <span className={s.cut} style={{ left: cut.left }} />}
              </div>
            </div>
          ))}
          {cut === null ? null : (
            <div className={`${s.trow} ${s.trowShort}`}>
              <span className={s.tlab} />
              <div className="relative h-11">
                <span className={`${s.cutl} top-[9px]`} style={{ left: cut.left }}>
                  {T.cutLetter}
                </span>
                <span className="absolute top-[13px] text-[13.5px] whitespace-nowrap text-ink" style={{ left: `calc(${cut.left} + 22px)` }}>
                  {cut.text}
                </span>
              </div>
            </div>
          )}
        </div>
      </ScrollBox>
      <div className="flex flex-wrap gap-x-7 gap-y-2.5 text-[14px] text-ink-muted">
        <span className="inline-flex items-center gap-2">
          <span className={`${s.ext} box-border h-3 w-[22px]`} />
          {T.legendThird}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={`${s.own} box-border h-3 w-[22px]`} />
          {T.legendOwn}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className={s.cutKey} />
          {T.legendCut}
        </span>
      </div>
    </section>
  );
}
