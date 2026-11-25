import type { Metadata } from 'next';
import { validateReport, type Report } from '@website-check/scanner/report';
import exampleJson from '../../../components/report/example-report.json';
import { ReportScreen } from '../../../components/report/report-screen';
import { HAND_OVER, Revisions, WORK_ORDER } from '../../../components/report/stage-d';
import { REPORT_TEXTS } from '../../../lib/report-texts';
import { REPORT_TIME_ZONE } from '../../../lib/report-view';

// The report with the example of the reference (design/reference/bericht.html), for the visual, motion and
// accessibility checks and for looking at it (npm run preview:examples). A page file named page.example.tsx is built
// only with WC_EXAMPLES=1 (web/next.config.ts), never in production. The example is a report JSON
// (components/report/example-report.json, written by web/scripts/make-example-report.ts); like the real page, this
// one shows it only after `validateReport` passed: an invalid example fails the build.
//
// Session B4 part 1: the whole report, the lower part too, and the parts of stage D (the "Revisionen" and the
// "Arbeitsauftrag"; since B4 part 2 also "An Entwickler weitergeben"), which only this page passes: the example build
// is their flag, off in production (brief, B4).
export const metadata: Metadata = {
  title: REPORT_TEXTS.title,
  robots: { index: false },
};

const errors = validateReport(exampleJson);
if (errors.length > 0) throw new Error(`the example report is not valid: ${JSON.stringify(errors.slice(0, 3))}`);
const EXAMPLE = exampleJson as unknown as Report;

export default function ReportExamplePage() {
  return <ReportScreen report={EXAMPLE} timeZone={REPORT_TIME_ZONE} stageD={{ revisions: <Revisions report={EXAMPLE} timeZone={REPORT_TIME_ZONE} />, workOrder: WORK_ORDER, developer: HAND_OVER }} />;
}
