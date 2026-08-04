'use client';

import { useEffect, useState } from 'react';

/** Animates from 0 to `value` once on mount — the "tween" the design spec calls for. */
export function MetricCounter({ value, durationMs = 250 }: { value: number; durationMs?: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    let raf: number;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplay(Math.round(value * t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className="hos-counter">{display}</span>;
}
