'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { DETAIL_TEXTS as T, FIX_SYSTEM_NAMES, FIX_SYSTEMS, type FixSystem } from '../../lib/report-detail-texts';
import type { FixView } from '../../lib/report-detail-view';
import s from './report.module.css';

type SystemsFix = Extract<FixView, { kind: 'systems' }>;

/** The steps of the "Montageanleitung" (bericht.html: `ol.steps`). */
export function Steps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className={s.steps}>
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

// "Montageanleitung" with the tabs WordPress, Shopify, Wix, Jimdo and Shopware (bericht.html), by the WAI-ARIA tabs
// pattern (brief, B4): one tab list named "System wählen"; only the selected tab is in the Tab order, the arrow keys move
// to the next or previous tab and select it (Home and End to the first and the last), the panel follows the selected
// tab and is in the Tab order itself, because it holds no control. The detected system is selected on load and carries
// "erkannt" (design/README.md); a tab without steps of its own shows the steps without a system, when there are any.
export function FixTabs({ cardId, fix }: { cardId: string; fix: SystemsFix }) {
  const [selected, setSelected] = useState<FixSystem>(fix.selected);
  const tabs = useRef<Partial<Record<FixSystem, HTMLButtonElement | null>>>({});
  const panelId = `${cardId}-panel`;
  const tabId = (system: FixSystem) => `${cardId}-tab-${system}`;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: FixSystem) => {
    const i = FIX_SYSTEMS.indexOf(current);
    const n = FIX_SYSTEMS.length;
    const next =
      event.key === 'ArrowRight' ? FIX_SYSTEMS[(i + 1) % n]
      : event.key === 'ArrowLeft' ? FIX_SYSTEMS[(i + n - 1) % n]
      : event.key === 'Home' ? FIX_SYSTEMS[0]
      : event.key === 'End' ? FIX_SYSTEMS[n - 1]
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };

  const steps = fix.steps[selected] ?? fix.general;
  return (
    <>
      <div className="flex flex-col gap-3 px-[18px] pt-4">
        <h3 className={`${s.h3s} m-0!`}>{T.fixHeading}</h3>
        <div className={s.tabs} role="tablist" aria-label={T.tablistLabel}>
          {FIX_SYSTEMS.map((system) => {
            const on = system === selected;
            return (
              <button
                key={system}
                ref={(el) => {
                  tabs.current[system] = el;
                }}
                type="button"
                role="tab"
                id={tabId(system)}
                className={on ? `${s.tab} ${s.tabOn}` : s.tab}
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => setSelected(system)}
                onKeyDown={(e) => onKeyDown(e, system)}
              >
                {system === fix.detected ? (
                  <>
                    {`${FIX_SYSTEM_NAMES[system]} `}
                    <small>{T.detected}</small>
                  </>
                ) : (
                  FIX_SYSTEM_NAMES[system]
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabIndex={0} className={`${s.panel} px-[22px] pt-[22px] pb-6`}>
        {steps === null ? <p className={s.bodys}>{T.noSystemFix(FIX_SYSTEM_NAMES[selected])}</p> : <Steps steps={steps} />}
      </div>
    </>
  );
}
