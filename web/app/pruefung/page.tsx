import type { Metadata } from 'next';
import { LiveScan } from '../../components/scan/live-scan';
import { SCAN_TEXTS } from '../../lib/scan-texts';

// The scan screen of a real scan (session B2 part 2): `/pruefung?id=…`. The page with the id of a scan is never
// indexed (Fedor, B2 part 2; brief: reports are not indexed). The static HTML has no scan; the script reads the id
// from the address and asks the API.
export const metadata: Metadata = {
  title: SCAN_TEXTS.title,
  robots: { index: false, follow: false },
};

export default function ScanPage() {
  return <LiveScan />;
}
