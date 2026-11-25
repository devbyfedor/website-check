'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from './report.module.css';

// The box of a data table that scrolls sideways when the window is narrow (`.tw` of bericht.html; WCAG 1.4.10 allows it
// for a data table). While its content is wider than the box, the box takes focus by keyboard, so the table can be
// scrolled with the arrow keys, and is a region named by the heading of its section. Chrome does the same for the
// reference by itself (a scroll box with nothing focusable in it); axe asks for it in the markup
// (`scrollable-region-focusable`). When nothing overflows (1440 px) the box is no Tab stop, as in the reference.
// Session B4: like Chrome, a box with a control in it (the "Erneut prüfen" of the Revisionen) is no Tab stop itself;
// the control takes focus and the browser scrolls it into view (axe passes such a box).
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';
export function ScrollBox({ labelledBy, children }: { labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const check = () => setScrolls(box.scrollWidth > box.clientWidth + 1 && box.querySelector(FOCUSABLE) === null);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={s.tw} {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-labelledby': labelledBy } : {})}>
      {children}
    </div>
  );
}
