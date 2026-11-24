'use client';

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { cancelScan, fetchReport, fetchStatus, isScanId } from '../../lib/scan-api';
import { forgetScan, recallScan } from '../../lib/scan-store';
import { liveScreen, type LiveScanState } from '../../lib/scan-view';
import { ScanScreen } from './scan-screen';

// The real scan screen (session B2 part 2): the id comes from the address (`/pruefung?id=…`); the status is polled
// every 2 seconds (Fedor: at most once a second), not while the tab is hidden, until the scan is done or ended with an
// error. The screen itself is `liveScreen` of the state (web/lib/scan-view.ts).

/** Between two status requests (at most one a second by Fedor's rule). */
export const POLL_MS = 2_000;
/** After a request without an answer: the next one later, and the temporary message after a few in a row. */
const RETRY_MS = 6_000;
const FAILURES_SHOWN = 3;
/** "Prüfung abbrechen" waits at most this long for the API before it goes to the home page. */
const CANCEL_WAIT_MS = 1_500;
/** The scale of the time bar: "etwa 30 s"; without the report it stops at 97 % (29.1 s). */
const BAR_SECONDS = 29.1;

const secondsSinceLoad = (): number => performance.now() / 1000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves when the tab is visible (at once when it is). */
function visible(): Promise<void> {
  if (document.visibilityState !== 'hidden') return Promise.resolve();
  return new Promise((resolve) => {
    const on = (): void => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', on);
      resolve();
    };
    document.addEventListener('visibilitychange', on);
  });
}

const initial: LiveScanState = { id: '', phase: 'loading', displayHost: null, queuePosition: null, runningSince: 0, report: null, reportShownAt: 0 };

export function LiveScan() {
  const [state, setState] = useState<LiveScanState>(initial);
  const phase = useRef<LiveScanState['phase']>('loading');

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    if (!isScanId(id)) {
      phase.current = 'error';
      setState({ ...initial, phase: 'error' });
      return;
    }
    const stored = recallScan(id);
    setState({ ...initial, id, displayHost: stored?.displayHost ?? null });
    let stopped = false;

    void (async () => {
      let failures = 0;
      for (;;) {
        await visible();
        if (stopped) return;
        const answer = await fetchStatus(id);
        if (stopped) return;
        if (!answer.ok) {
          // 404: the id is unknown (or the scan was deleted); other answers may pass.
          if (answer.status === 404) {
            phase.current = 'error';
            setState((s) => ({ ...s, phase: 'error' }));
            return;
          }
          failures += 1;
          if (failures >= FAILURES_SHOWN && phase.current !== 'error') {
            phase.current = 'error';
            setState((s) => ({ ...s, phase: 'error' }));
          }
          await sleep(RETRY_MS);
          continue;
        }
        failures = 0;
        const scan = answer.value;
        if (scan.status === 'error') {
          phase.current = 'error';
          forgetScan(id);
          setState((s) => ({ ...s, phase: 'error', displayHost: scan.displayHost ?? s.displayHost }));
          return;
        }
        if (scan.status === 'done') {
          const report = await fetchReport(id);
          if (stopped) return;
          forgetScan(id);
          phase.current = report.ok ? 'done' : 'error';
          setState((s) => ({
            ...s,
            phase: report.ok ? 'done' : 'error',
            displayHost: scan.displayHost ?? s.displayHost,
            report: report.ok ? report.value : null,
            reportShownAt: secondsSinceLoad(),
          }));
          return;
        }
        const next = scan.status;
        setState((s) => {
          // The bar starts once, with the time the scan had already run; later answers do not move it.
          const since = next === 'running' && s.phase !== 'running' ? Math.min(BAR_SECONDS, Math.max(0, scan.startedAt === null ? 0 : (Date.now() - Date.parse(scan.startedAt)) / 1000)) : s.runningSince;
          return { ...s, phase: next, displayHost: scan.displayHost ?? s.displayHost, queuePosition: next === 'queued' ? scan.queuePosition : null, runningSince: since };
        });
        phase.current = next;
        await sleep(POLL_MS);
      }
    })();
    return () => {
      stopped = true;
    };
  }, []);

  // "Prüfung abbrechen" (Fedor's answer 2): with the token of this tab, the scan leaves the queue unless it runs or
  // another visitor waits for it; then the home page. Without a token (a link passed on) only the home page.
  const onCancel = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      const id = state.id;
      const token = id === '' ? null : recallScan(id)?.cancelToken ?? null;
      const href = event.currentTarget.href;
      if (token === null || phase.current === 'done' || phase.current === 'error') {
        if (id !== '') forgetScan(id);
        return;
      }
      event.preventDefault();
      void Promise.race([cancelScan(id, token), sleep(CANCEL_WAIT_MS)]).then(() => {
        forgetScan(id);
        window.location.assign(href);
      });
    },
    [state.id],
  );

  return <ScanScreen scan={liveScreen(state)} onCancel={onCancel} />;
}
