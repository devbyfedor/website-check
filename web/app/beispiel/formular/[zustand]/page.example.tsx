import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeScreen } from '../../../../components/home/home-screen';
import { EXAMPLE_FORM_STATES, EXAMPLE_TIME_ZONE } from '../../../../components/scan/example-states';

// The home page with a refused start (session B2 part 3), one example page per answer of the API, for looking at
// the message under the form at both widths (npm run preview:examples, /beispiel/formular/<state>). Built only with
// WC_EXAMPLES=1 (web/next.config.ts), never in production.
export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMPLE_FORM_STATES.map((s) => ({ zustand: s.slug }));
}

export const metadata: Metadata = {
  title: 'Website-Check DE',
  robots: { index: false, follow: false },
};

export default async function FormStatePage({ params }: { params: Promise<{ zustand: string }> }) {
  const { zustand } = await params;
  const example = EXAMPLE_FORM_STATES.find((s) => s.slug === zustand);
  if (example === undefined) notFound();
  return <HomeScreen form={{ initialValue: example.value, initialProblem: example.problem, timeZone: EXAMPLE_TIME_ZONE }} />;
}
