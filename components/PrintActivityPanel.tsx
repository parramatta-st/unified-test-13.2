import { useLayoutEffect, useRef, type ReactNode } from 'react';

type Props = { children: ReactNode; intro: string; expanded: boolean; onDocked: () => void };

/** Animate the actual activity panel, so its contents never swap into a second card. */
export default function PrintActivityPanel({ children, intro, expanded, onDocked }: Props) {
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!intro || !node) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !node.animate) {
      onDocked(); return;
    }
    const rect = node.getBoundingClientRect(), viewport = window.visualViewport;
    const x = (viewport?.offsetLeft || 0) + (viewport?.width || innerWidth) / 2 - rect.left - rect.width / 2;
    const y = (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) / 2 - rect.top - rect.height / 2;
    const start = `translate3d(${x}px, ${y}px, 0)`;
    const duration = 1000;
    const motion = node.animate([
      { transform: start, offset: 0 },
      { transform: start, offset: .25, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      { transform: 'translate3d(0, 0, 0)', offset: 1 },
    ], { duration, fill: 'both' });
    const shade = backdrop.current?.animate([
      { opacity: 1, offset: 0 }, { opacity: 1, offset: .25 }, { opacity: 0, offset: .8 }, { opacity: 0, offset: 1 },
    ], { duration, fill: 'both' });
    motion.onfinish = onDocked;
    // Browser toolbar/keyboard changes invalidate the measured centre. Settle
    // safely into the responsive dock instead of replaying the entrance.
    const settle = () => { motion.finish(); };
    window.addEventListener('resize', settle);
    viewport?.addEventListener('resize', settle);
    return () => {
      motion.onfinish = null; motion.cancel(); shade?.cancel();
      window.removeEventListener('resize', settle);
      viewport?.removeEventListener('resize', settle);
    };
  }, [intro, onDocked]);
  return <>
    {intro && <div ref={backdrop} className="print-intro" aria-hidden="true" />}
    <aside ref={panel} className={`print-activity ${expanded ? '' : 'collapsed'} ${intro ? 'print-activity-arriving' : ''}`} aria-label="Print activity">{children}</aside>
  </>;
}
