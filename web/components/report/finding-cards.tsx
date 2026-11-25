import { Fragment, type ReactNode } from 'react';
import type { Report } from '@website-check/scanner/report';
import { PhraseText } from '../scan/phrase';
import { DETAIL_TEXTS as T } from '../../lib/report-detail-texts';
import { findingCards, moreFindingCards, type FindingCard } from '../../lib/report-detail-view';
import { REPORT_TEXTS } from '../../lib/report-texts';
import { FixTabs, Steps, type HeadingLevel } from './fix-tabs';
import s from './report.module.css';

/**
 * The heading of a level (session C0): the cards of "Drei Dinge" have their title as h2 and their parts as h3, as in
 * bericht.html; the cards under "Weitere Punkte mit Risiko" one level lower (h3 and h4) with the same look, so that the
 * outline of the page says that they belong to that heading.
 */
function H({ level, className, children }: { level: HeadingLevel; className: string | undefined; children: ReactNode }) {
  return level === 2 ? <h2 className={className}>{children}</h2> : level === 3 ? <h3 className={className}>{children}</h3> : <h4 className={className}>{children}</h4>;
}

// The box of the "Montageanleitung" (bericht.html): with the system tabs when our texts have steps by system, else the
// steps without a system under the same heading (a state the design does not show, from its elements). Session B4
// part 2: a finding without a fix text yet gets the box with the heading and a line that says so.
function Fix({ card, level }: { card: FindingCard; level: HeadingLevel }) {
  const fix = card.fix;
  return (
    <div className={s.fixBox}>
      {fix.kind === 'systems' ? (
        <FixTabs cardId={card.id} fix={fix} level={level} />
      ) : (
        <>
          <div className="px-[18px] pt-4">
            <H level={level} className={`${s.h3s} m-0!`}>
              {T.fixHeading}
            </H>
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
// `level`: the level of its title (session C0); its parts are one level lower.
function Card({ card, level }: { card: FindingCard; level: 2 | 3 }) {
  const part = (level + 1) as HeadingLevel;
  return (
    <section id={card.id} className={`${s.sec} ${s.card}`}>
      <div className="flex flex-wrap items-center gap-4">
        <span className={s.pencil} aria-hidden="true">
          {card.number}
        </span>
        <H level={level} className={s.h2s}>
          <PhraseText phrase={card.title} />
        </H>
        {card.field === null ? null : <span className={s.feld}>{REPORT_TEXTS.field(card.field)}</span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-10">
        <div className="flex min-w-0 flex-col gap-[22px]">
          {card.happens === null ? (
            card.country === null ? null : <Country line={card.country} />
          ) : (
            <div>
              <H level={part} className={s.h3s}>
                {T.happens}
              </H>
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
              <H level={part} className={s.h3s}>
                {T.why}
              </H>
              <p className={s.bodys}>{card.why}</p>
            </div>
          )}
          {card.source.length === 0 ? null : (
            <div>
              <H level={part} className={s.h3s}>
                {T.inSource}
              </H>
              <Source addresses={card.source} />
            </div>
          )}
        </div>
        <Fix card={card} level={part} />
      </div>
    </section>
  );
}

/** The finding details: one card per priority of "Drei Dinge", the target of its link (#fund-1 …). */
export function FindingCards({ report }: { report: Report }) {
  return (
    <>
      {findingCards(report).map((card) => (
        <Card key={card.id} card={card} level={2} />
      ))}
    </>
  );
}

/**
 * Session C0 (Fedor's answer 2 of B5 part 2; a state the design does not show): the other findings with a risk, each a
 * full card like those of "Drei Dinge", numbered on from them, under a heading of their own in the form of the head of
 * the Stückliste ("Stückliste der fremden Dienste", "5 Dienste gefunden"). The cards keep the gap of the sheet between
 * them. Shown only when there is at least one.
 */
export function MoreFindingCards({ report }: { report: Report }) {
  const cards = moreFindingCards(report);
  if (cards.length === 0) return null;
  return (
    <section className="flex flex-col gap-14" data-part="more-findings" aria-labelledby="weitere-funde">
      <div className={s.sech}>
        <h2 id="weitere-funde" className={s.h2s}>
          {T.moreHeading}
        </h2>
        <span className={`${s.mut} text-[15px]`}>{T.moreCount(cards.length)}</span>
      </div>
      {cards.map((card) => (
        <Card key={card.id} card={card} level={3} />
      ))}
    </section>
  );
}
