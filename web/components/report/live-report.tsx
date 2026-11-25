'use client';

import { useEffect, useState } from 'react';
import { loadReportPage, type ReportPageState } from '../../lib/report-page';
import { fetchReport, fetchStatus, isScanId } from '../../lib/scan-api';
import { ReportPageStateView } from './report-page-state';
import { ReportScreen } from './report-screen';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The report of a real scan (session B3 part 2): the id comes from the address (`/bericht?id=…`), the report from the
// API, shown only after its version is known and it passed the validator of the schema (`fetchReport`). The page asks
// once (a few tries when there is no usable answer); a report that is not ready yet leads to the scan screen.
export function LiveReport() {
  const [state, setState] = useState<ReportPageState>({ kind: 'loading' });
  const [here, setHere] = useState('/bericht');
  useEffect(() => {
    let stopped = false;
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    setHere(`${window.location.pathname}${window.location.search}`);
    void loadReportPage(id, { report: fetchReport, status: fetchStatus, sleep }, isScanId)
      .catch((): ReportPageState => ({ kind: 'error' }))
      .then((next) => {
        if (!stopped) setState(next);
      });
    return () => {
      stopped = true;
    };
  }, []);
  if (state.kind === 'report') return <ReportScreen report={state.report} />;
  return <ReportPageStateView state={state} here={here} />;
}
