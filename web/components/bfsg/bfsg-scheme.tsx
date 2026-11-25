'use client';

import { useState } from 'react';
import { answerBfsg, BFSG_EXITS, BFSG_QUESTIONS, BFSG_START, BFSG_TEXTS as T, bfsgView, resetBfsg, type BfsgState, type QuestionNumber } from '../../lib/bfsg-view';
import s from './bfsg.module.css';

const cx = (...names: (string | false | undefined)[]): string => names.filter(Boolean).join(' ');

// One exit box. The one the answers lead to is filled.
function Exit({ n, hit }: { n: 0 | 1 | 2 | 3; hit: boolean }) {
  const exit = BFSG_EXITS[n];
  return (
    <div className={cx(s.ex, hit && s.hit)}>
      <h3 className={s.et}>{exit.title}</h3>
      <p className={s.ed}>{exit.text}</p>
    </div>
  );
}

// The arrow down between two rows, with its answer.
function Down({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={s.vlink} aria-hidden="true">
      <div className={cx(s.vline, on && s.on)}>
        <span className={s.vlab}>{label}</span>
      </div>
    </div>
  );
}

/**
 * The "Prüfschema" section of design/reference/bfsg.html: three yes/no questions, the highlighted path, the exits and
 * the verdict, by the logic of the reference's script (lib/bfsg-view.ts). `initial` only for the unit tests, which draw
 * every state without a browser.
 */
export function BfsgScheme({ initial = BFSG_START }: { initial?: BfsgState }) {
  const [state, setState] = useState<BfsgState>(initial);
  const view = bfsgView(state);
  const answers = [state.q1, state.q2, state.q3] as const;

  const question = (i: 0 | 1 | 2) => {
    const q = BFSG_QUESTIONS[i];
    const n = (i + 1) as QuestionNumber;
    const answer = answers[i];
    const disabled = !view.reachable[i];
    return (
      <div className={cx(s.qc, s[view.cards[i]])}>
        <span className={s.qn}>{`${T.question} ${q.n}`}</span>
        <h3 className={s.qt}>{q.title}</h3>
        <p className={s.qs}>{q.text}</p>
        <div className="flex flex-wrap gap-[10px]">
          <button type="button" className={cx(s.yn, answer === 'ja' && s.sel)} aria-pressed={answer === 'ja'} disabled={disabled} onClick={() => setState((x) => answerBfsg(x, n, 'ja'))}>
            {T.yes}
          </button>
          <button type="button" className={cx(s.yn, answer === 'nein' && s.sel)} aria-pressed={answer === 'nein'} disabled={disabled} onClick={() => setState((x) => answerBfsg(x, n, 'nein'))}>
            {T.no}
          </button>
        </div>
      </div>
    );
  };

  const across = (i: 0 | 1 | 2) => (
    <div className={cx(s.hline, view.across[i] && s.on)} aria-hidden="true">
      <span className={s.hlab}>{BFSG_QUESTIONS[i].across}</span>
    </div>
  );

  return (
    <section aria-labelledby="schema-titel" className="flex max-w-[1120px] flex-col gap-[22px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-2">
        <h2 id="schema-titel" className="m-0 font-head text-[32px] font-semibold">
          {T.schemeHeading}
        </h2>
        <span className="text-[15px] text-chalk-muted">{T.schemeHint}</span>
      </div>
      <div className="flex flex-col">
        <div className={s.srow}>
          {question(0)}
          {across(0)}
          <Exit n={0} hit={view.exits[0]} />
        </div>
        <Down on={view.down[0]} label={BFSG_QUESTIONS[0].down} />
        <div className={s.srow}>
          {question(1)}
          {across(1)}
          <Exit n={1} hit={view.exits[1]} />
        </div>
        <Down on={view.down[1]} label={BFSG_QUESTIONS[1].down} />
        <div className={s.srow}>
          {question(2)}
          {across(2)}
          <Exit n={2} hit={view.exits[2]} />
        </div>
        <Down on={view.down[2]} label={BFSG_QUESTIONS[2].down} />
        <div className={s.srow}>
          <Exit n={3} hit={view.exits[3]} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-[14px] border-t border-[rgba(242,246,255,0.25)] pt-[18px]">
        <p aria-live="polite" className="m-0 font-head text-[21px] font-semibold">
          {view.verdict}
        </p>
        <button type="button" className={s.reset} onClick={() => setState(resetBfsg())}>
          {T.reset}
        </button>
      </div>
    </section>
  );
}
