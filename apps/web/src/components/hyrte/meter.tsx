export function Meter({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  // `invert`: for metrics where LOW is good and HIGH is bad (risk, debt, pressure,
  // compliance risk) — without this, e.g. Deadline Pressure=75 rendered green,
  // implying high pressure is a good thing.
  const good = invert ? value <= 35 : value >= 65;
  const bad = invert ? value >= 65 : value <= 35;
  const color = good ? 'bg-emerald-500' : bad ? 'bg-red-500' : 'bg-amber-500';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-black/60 dark:text-white/60">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}
