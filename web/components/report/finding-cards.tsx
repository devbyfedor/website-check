import { Fragment } from 'react';
import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { DETAIL_TEXTS as T } from '../../lib/report-detail-texts';
import { findingCards, type FindingCard } from '../../lib/report-detail-view';
import { REPORT_TEXTS } from '../../lib/report-texts';
import { FixTabs, Steps } from './fix-tabs';
import s from './report.module.css';

// The box of the "Montageanleitung" (bericht.html): with the system tabs when our texts have steps by system, else the
// steps without a system under the same heading (a state the design does not show, from its elements). Session B4
// part 2: a finding without a fix text yet gets the box with the heading and a line that says so.
function Fix({ card }: { card: FindingCard }) {
  const fix = card.fix;
  return (
    <div className={s.fixBox}>
      {fix.kind === 'systems' ? (
        <FixTabs cardId={card.id} fix={fix} />
      ) : (
        <>
          <div className="px-[18px] pt-4">
            <h3 className={`${s.h3s} m-0!`}>{T.fixHeading}</h3>
          </div>
          <div className="px-[22px] pt-[22px] pb-6">{fix.kind === 'general' ? <Steps steps={fix.steps} /> : <p className={s.bodys}>{T.noFix}</p>}</div>
        </>
      )}
    </div>
  );
}

/** "Land des Aufrufs: …", the small grey line of the sheet (B4 part 2). */
function Country({ line }: { line: string }) {
  return <p className={`${s.mut} m-0 mt-1.5 text-[13px]`}>{line}</p>;
}

// "Gefunden im Quelltext": the addresses of the requests that stand in the source of the homepage, each a string of the
// page in <bdi>, one per line; never a link and never markup (docs/report-schema.md: the tag itself is gap 2).
function Source({ addresses }: { addresses: string[] }) {
  return (
    <pre className={s.code}>
      {addresses.map((a, i) => (
        <Fragment key={a}>
          {i > 0 ? '\n' : null}
          <bdi>{a}</bdi>
        </Fragment>
      ))}
    </pre>
  );
}

// One finding detail ("fund-1" of bericht.html): number, title and field, then what happens, Soll and Ist, why it
// matters and the place in the source on the left, the "Montageanleitung" on the right. A part without data or text
// is left out, never filled with a made-up value. Session B4 part 2: the country of the visit under "Was passiert" of
// a finding about data sent before consent; a card is never empty (without any text it says that the scan found it).
function Card({ card }: { card: FindingCard }) {
  return (
    <section id={card.id} className={`${s.sec} ${s.card}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span className={s.pencil} aria-hidden="true">
          {card.number}
        </span>
        <h2 className={s.h2s}>
          <PhraseText phrase={card.title} />
        </h2>
        {card.field === null ? null : <span className={s.feld}>{REPORT_TEXTS.field(card.field)}</span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-10">
        <div className="flex min-w-0 flex-col gap-[22px]">
          {card.happens === null ? (
            card.country === null ? null : <Country line={card.country} />
          ) : (
            <div>
              <h3 className={s.h3s}>{T.happens}</h3>
              <p className={s.bodys}>
                <PhraseText phrase={card.happens} />
              </p>
              {card.country === null ? null : <Country line={card.country} />}
            </div>
          )}
          {card.targetActual === null ? null : (
            <div className={s.ta}>
              <div className={`${s.taCell} ${s.taTarget}`}>
                <span className={`${s.mut} text-[13px]`}>{T.target}</span>
                <div className="font-head text-[22px] font-semibold">{card.targetActual.target}</div>
              </div>
              <div className={s.taCell}>
                <span className={`${s.mut} text-[13px]`}>{T.actual}</span>
                <div className={`font-head text-[22px] font-semibold ${card.targetActual.bad ? 'text-pencil' : ''}`}>{card.targetActual.actual}</div>
              </div>
            </div>
          )}
          {card.why === null ? null : (
            <div>
              <h3 className={s.h3s}>{T.why}</h3>
              <p className={s.bodys}>{card.why}</p>
            </div>
          )}
          {card.source.length === 0 ? null : (
            <div>
              <h3 className={s.h3s}>{T.inSource}</h3>
              <Source addresses={card.source} />
            </div>
          )}
        </div>
        <Fix card={card} />
      </div>
    </section>
  );
}

/** The finding details: one card per priority of "Drei Dinge", the target of its link (#fund-1 …). */
export function FindingCards({ report }: { report: Report }) {
  return (
    <>
      {findingCards(report).map((card) => (
        <Card key={card.id} card={card} />
      ))}
    </>
  );
}
