'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HyrteActivityFeed, HyrteActivityEntry } from '@/lib/hyrte-types';
import { useHyrteStore } from '@/store/hyrte';

const SOURCE_LABEL: Record<HyrteActivityEntry['source'], string> = {
  INBOX: 'Email',
  SLACK: 'Slack',
  MEETING: 'Meeting',
  REVIEW: 'Needs review',
  TASK: 'Task',
};

const URGENCY_TONE: Record<HyrteActivityEntry['urgency'], string> = {
  HIGH: 'bg-red-500/15 text-red-600 dark:text-red-400',
  MEDIUM: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  LOW: 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(Math.abs(diff) / 60_000);
  const suffix = diff < 0 ? 'from now' : 'ago';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ${suffix}`;
  return `${Math.round(mins / 60)}h ${suffix}`;
}

/**
 * Refinements doc §4 — "Notifications need one unified system. Don't scatter
 * information randomly across the simulation. Every notification has:
 * Source → Person → Context → Urgency → Action."
 *
 * Founder feedback (WhatsApp, 7 Sep): "Notification nhi ari thi na slack na
 * inbox etc, jaha bhi jo update hora tha toh pta kuch nhi chlra tha." There was
 * no notification surface at all before this — websocket events only
 * invalidated react-query caches, so an update to a screen you were not
 * currently on was completely invisible.
 */
export function ActivityCenter({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { inboxVersion, slackVersion, taskVersion, meetingVersion } = useHyrteStore();

  const { data } = useQuery({
    queryKey: ['hyrte', 'activity', sessionId, inboxVersion, slackVersion, taskVersion, meetingVersion],
    queryFn: () => api.get<HyrteActivityFeed>(`/hyrte/sessions/${sessionId}/activity`),
    // Belt and braces alongside the websocket push: a dropped socket must not
    // mean the candidate stops being told things are happening.
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const total = data?.counts.total ?? 0;
  const entries = data?.entries ?? [];

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg px-2 py-1.5 text-sm text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/5"
        aria-label={`Activity — ${total} needing attention`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-[18px] text-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/10">
            <span className="text-sm font-semibold">Needs your attention</span>
            <span className="text-xs text-black/50 dark:text-white/50">{total} open</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {entries.length === 0 && <p className="px-4 py-6 text-sm text-black/50 dark:text-white/50">Nothing waiting on you right now.</p>}
            {entries.map((entry) => (
              <Link
                key={entry.id}
                href={entry.href}
                onClick={() => setOpen(false)}
                className={`block border-b border-black/5 px-4 py-3 last:border-0 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/5 ${
                  entry.unread ? '' : 'opacity-60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${URGENCY_TONE[entry.urgency]}`}>
                    {SOURCE_LABEL[entry.source]}
                  </span>
                  {entry.personName && (
                    <span className="truncate text-xs text-black/60 dark:text-white/60">
                      {entry.personName}
                      {entry.personRole && <span className="text-black/35 dark:text-white/35"> · {entry.personRole}</span>}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-black/35 dark:text-white/35">{relativeTime(entry.at)}</span>
                </div>
                <div className="mt-1.5 text-sm font-medium">{entry.title}</div>
                <p className="mt-0.5 text-xs text-black/55 dark:text-white/55">{entry.context}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
