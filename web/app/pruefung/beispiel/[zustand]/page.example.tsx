import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EXAMPLE_SCAN_STATES } from '../../../../components/scan/example-states';
import { ScanScreen } from '../../../../components/scan/scan-screen';
import { SCAN_TEXTS } from '../../../../lib/scan-texts';
import { liveScreen } from '../../../../lib/scan-view';

// The states of the scan screen that the design does not show (session B2 part 3), one example page each, for
// looking at them at both widths (npm run preview:examples, /pruefung/beispiel/<state>). Built only with
// WC_EXAMPLES=1 (web/next.config.ts), never in production. The screen is the real one (`liveScreen`) for a fixed state.
export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMPLE_SCAN_STATES.map((s) => ({ zustand: s.slug }));
}

export const metadata: Metadata = {
  title: SCAN_TEXTS.title,
  robots: { index: false, follow: false },
};

export default async function ScanStatePage({ params }: { params: Promise<{ zustand: string }> }) {
  const { zustand } = await params;
  const example = EXAMPLE_SCAN_STATES.find((s) => s.slug === zustand);
  if (example === undefined) notFound();
  return <ScanScreen scan={liveScreen(example.state())} />;
}
