'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HyrteCalendarEvent, HyrteStakeholder } from '@/lib/hyrte-types';
import { useHyrteStore } from '@/store/hyrte';

/**
 * Refinements doc §5 — "When the meeting starts it should come like a call."
 *
 * This could not exist before: generated meetings were persisted as
 * `now + startInHours`, putting every one of them hours past the end of a
 * 30-60 minute session, so no meeting ever actually began while a candidate
 * was in the workspace. They are now re-timed into the real session at
 * workspace unlock (see pacing/session-pacing.ts meetingStartDelayMs), which
 * is what makes a meeting something that HAPPENS to you rather than a page you
 * remember to visit.
 *
 * Mounted once for the whole session subtree, so — like a real call — it
 * reaches the candidate wherever they are rather than only on the Meetings
 * page.
 *
 * Declining is a real choice with a real consequence, not a dismiss button:
 * the people in that room notice, and it is recorded. That is deliberate —
 * the doc's whole premise is that no candidate action is free.
 */

/** A meeting counts as "ringing" from its start time until this long after — after that it has simply been missed. */
const RING_WINDOW_MS = 3 * 60_000;

export function IncomingMeeting({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { meetingVersion } = useHyrteStore();
  const [now, setNow] = useState(() => Date.now());
  // Per-meeting, so a second call later in the session still rings.
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [acting, setActing] = useState(false);

  const { data: events } = useQuery({
    queryKey: ['hyrte', 'calendar', sessionId, meetingVersion],
    queryFn: () => api.get<HyrteCalendarEvent[]>(`/hyrte/sessions/${sessionId}/calendar`),
    refetchInterval: 30_000,
  });
  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', sessionId],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${sessionId}/stakeholders`),
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  const ringing = useMemo(() => {
    return (events ?? []).find((e) => {
      if (e.startedAt || e.notesGeneratedAt || dismissed[e.id]) return false;
      const start = new Date(e.startAt).getTime();
      return now >= start && now - start < RING_WINDOW_MS;
    });
  }, [events, now, dismissed]);

  if (!ringing) return null;

  const attendees = (stakeholders ?? []).filter((s) => ringing.attendeeStakeholderIds.includes(s.id));
  // Whoever in the room outranks the others is the one calling you.
  const host = attendees.reduce<HyrteStakeholder | null>((a, b) => (!a || (b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a), null);

  async function act(kind: 'join' | 'silent' | 'decline') {
    setActing(true);
    try {
      if (kind === 'decline') {
        await api.post(`/hyrte/sessions/${sessionId}/calendar/${ringing!.id}/decline`, {});
        queryClient.invalidateQueries({ queryKey: ['hyrte', 'calendar', sessionId] });
        queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', sessionId] });
        setDismissed((d) => ({ ...d, [ringing!.id]: true }));
        return;
      }
      setDismissed((d) => ({ ...d, [ringing!.id]: true }));
      // "Join silent" still enters the room — it just does not announce you,
      // which is a genuinely different choice a candidate can be read on.
      router.push(`/hyrte/session/${sessionId}/meetings?join=${ringing!.id}${kind === 'silent' ? '&silent=1' : ''}`);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="fixed right-4 top-4 z-[60] w-[340px] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900">
      <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Incoming meeting</span>
      </div>

      <div className="px-4 py-3">
        <div className="text-base font-semibold">{ringing.title}</div>
        <div className="mt-0.5 text-xs text-black/55 dark:text-white/55">
          {new Date(ringing.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
          {new Date(ringing.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {host && <> · hosted by {host.name}</>}
        </div>
        {ringing.agenda && <p className="mt-2 text-xs text-black/60 dark:text-white/60">{ringing.agenda}</p>}
        {attendees.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {attendees.map((a) => (
              <span key={a.id} className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/60 dark:bg-white/10 dark:text-white/60">
                {a.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-black/5 px-4 py-3 dark:border-white/10">
        <button className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={acting} onClick={() => act('join')}>
          Join
        </button>
        <button
          className="rounded-lg border border-black/10 px-3 py-2 text-sm text-black/70 disabled:opacity-50 dark:border-white/15 dark:text-white/70"
          disabled={acting}
          onClick={() => act('silent')}
          title="Enter without announcing yourself"
        >
          Join silent
        </button>
        <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={acting} onClick={() => act('decline')}>
          Decline
        </button>
      </div>
    </div>
  );
}
