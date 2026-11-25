import type { Metadata } from 'next';
import { BfsgScreen } from '../../components/bfsg/bfsg-screen';
import { BFSG_TEXTS } from '../../lib/bfsg-view';

export const metadata: Metadata = {
  title: BFSG_TEXTS.title,
};

// "Gilt das BFSG für Sie?" (design/reference/bfsg.html), the page of the link "BFSG-Check" in the header.
export default function BfsgPage() {
  return <BfsgScreen />;
}
