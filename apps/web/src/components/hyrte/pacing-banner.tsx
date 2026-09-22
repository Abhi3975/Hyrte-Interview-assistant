'use client';

import { useEffect, useState } from 'react';
import { HyrteSession } from '@/lib/hyrte-types';

const PHASE_TONE: Record<string, string> = {
  ORIENTATION: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300',
  INVESTIGATE: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ROLE_TASK: 'border-black/10 bg-black/[0.03] text-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70',
  STAKEHOLDER: 'border-black/10 bg-black/[0.03] text-black/70 dark:border-white/10 dark:bg-white/5 dark:text-white/70',
  UNEXPECTED: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  FINAL: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`;
}

/**
 * Founder feedback (WhatsApp, 7 Sep) — "simulation gradually open up hoga naki
 * sara kuch ek saath... exploration k liye atleast 10 min dene h."
 *
 * The pacing ramp (apps/api/src/hyrte/pacing/session-pacing.ts) is what
 * actually holds inbound work back; this is how the candidate can SEE it. The
 * old behaviour was silently overwhelming — messages piled up with no
 * indication of why, or of whether it was about to get worse. Now the current
 * band is named, and during the opening quiet window there is a live countdown
 * so "nothing is happening" reads as deliberate rather than broken.
 */
export function PacingBanner({ session }: { session: Pick<HyrteSession, 'pacing'> }) {
  const [now, setNow] = useState(() => Date.now());
  const pacing = session.pacing;

  useEffect(() => {
    if (!pacing?.quietUntil) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [pacing?.quietUntil]);

  if (!pacing) return null;
  const quietRemaining = pacing.quietUntil ? new Date(pacing.quietUntil).getTime() - now : 0;
  const inQuietWindow = quietRemaining > 0;

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-sm ${PHASE_TONE[pacing.phase] ?? PHASE_TONE.ROLE_TASK}`}>
      <span className="font-semibold">{pacing.label}</span>
      <span className="opacity-80">{pacing.guidance}</span>
      {inQuietWindow && (
        <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 font-mono text-xs dark:bg-white/10">
          quiet for {formatCountdown(quietRemaining)}
        </span>
      )}
    </div>
  );
}
