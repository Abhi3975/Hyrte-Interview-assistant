'use client';

import { useEffect, useState } from 'react';
import { PLANNED_DURATION_MINUTES, HyrteSession } from '@/lib/hyrte-types';

function formatMinutes(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Part E1 Mission Brief "duration" field, made real — live elapsed time
 * against a difficulty-based planned duration. Informational only, no
 * enforcement/auto-submit: computed entirely client-side from the real
 * session.startedAt, no new schema or backend timer subsystem.
 */
export function SessionClock({ session }: { session: Pick<HyrteSession, 'startedAt' | 'difficulty'> }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const plannedMinutes = PLANNED_DURATION_MINUTES[session.difficulty] ?? 20;
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000));
  const overPlanned = elapsedSeconds > plannedMinutes * 60;

  return (
    <span className={`hos-chip ${overPlanned ? 'text-amber-500' : ''}`} title={`Planned duration: ${plannedMinutes} min`}>
      {formatMinutes(elapsedSeconds)} / {plannedMinutes}:00
    </span>
  );
}
