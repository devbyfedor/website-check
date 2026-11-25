import type { Metadata } from 'next';
import { LiveReport } from '../../components/report/live-report';
import { REPORT_TEXTS } from '../../lib/report-texts';

// The report of a real scan (session B3 part 2): `/bericht?id=…`. Never indexed (brief: reports are not indexed; the
// static assets also send `X-Robots-Tag`, web/public/_headers). The static HTML has no report; the script reads the id
// from the address and asks the API.
export const metadata: Metadata = {
  title: REPORT_TEXTS.title,
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ReportPage() {
  return <LiveReport />;
}
