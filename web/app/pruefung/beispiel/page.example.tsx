import type { Metadata } from 'next';
import { EXAMPLE_SCAN } from '../../../components/scan/example-scan';
import { ScanScreen } from '../../../components/scan/scan-screen';

// The scan screen with the example of the reference (design/reference/pruefung.html), for the visual,
// motion and accessibility checks and for looking at it (npm run preview:examples). A page file named
// page.example.tsx is built only with WC_EXAMPLES=1 (web/next.config.ts), never in production.
export const metadata: Metadata = {
  title: 'Prüfung läuft, Website-Check DE',
  robots: { index: false },
};

export default function ScanExamplePage() {
  return <ScanScreen scan={EXAMPLE_SCAN} />;
}
