'use client';

/**
 * Explainable risk meter for the proctoring dashboard. Colour bands are
 * intentionally conservative so a moderate score reads as "review", not
 * "guilty" — we surface evidence, never verdicts.
 */
export function RiskMeter({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const band = clamped >= 90 ? 'critical' : clamped >= 70 ? 'high' : clamped >= 40 ? 'elevated' : 'normal';
  const color = {
    normal: 'bg-emerald-500',
    elevated: 'bg-amber-500',
    high: 'bg-orange-500',
    critical: 'bg-red-500',
  }[band];
  const label = { normal: 'Normal', elevated: 'Elevated', high: 'High', critical: 'Critical' }[band];

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Live risk</span>
        <span className="tabular-nums">{clamped} · {label}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div className={`h-full ${color} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
