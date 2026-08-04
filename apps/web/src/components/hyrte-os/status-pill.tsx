type Status = 'working' | 'waiting' | 'idle' | 'escalating';

const STATUS_LABEL: Record<Status, string> = {
  working: 'Working',
  waiting: 'Waiting',
  idle: 'Idle',
  escalating: 'Escalating',
};

const STATUS_VAR: Record<Status, string> = {
  working: 'var(--hos-working)',
  waiting: 'var(--hos-waiting)',
  idle: 'var(--hos-idle)',
  escalating: 'var(--hos-escalating)',
};

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const color = STATUS_VAR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: 'var(--hos-border)', color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
