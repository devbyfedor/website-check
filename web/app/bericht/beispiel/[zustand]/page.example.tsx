import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { validateReport } from '@website-check/scanner/report';
import { EXAMPLE_REPORT_STATES } from '../../../../components/report/example-report-states';
import { ReportPageStateView } from '../../../../components/report/report-page-state';
import { ReportScreen } from '../../../../components/report/report-screen';
import { REPORT_TEXTS } from '../../../../lib/report-texts';
import { REPORT_TIME_ZONE } from '../../../../lib/report-view';

// The states of the report that the design does not show (session B3 part 2), one example page each, for looking at
// them at both widths (npm run preview:examples, /bericht/beispiel/<state>). Built only with WC_EXAMPLES=1
// (web/next.config.ts), never in production. Like the real page, a report is shown only after `validateReport`
// passed: an invalid example fails the build.
export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMPLE_REPORT_STATES.map((s) => ({ zustand: s.slug }));
}

export const metadata: Metadata = {
  title: REPORT_TEXTS.title,
  robots: { index: false, follow: false },
};

export default async function ReportStatePage({ params }: { params: Promise<{ zustand: string }> }) {
  const { zustand } = await params;
  const example = EXAMPLE_REPORT_STATES.find((s) => s.slug === zustand);
  if (example === undefined) notFound();
  const shown = example.show();
  if ('page' in shown) return <ReportPageStateView state={shown.page} here={`/bericht/beispiel/${zustand}`} />;
  const errors = validateReport(shown.report);
  if (errors.length > 0) throw new Error(`the example report ${zustand} is not valid: ${JSON.stringify(errors.slice(0, 3))}`);
  return <ReportScreen report={shown.report} timeZone={REPORT_TIME_ZONE} />;
}
