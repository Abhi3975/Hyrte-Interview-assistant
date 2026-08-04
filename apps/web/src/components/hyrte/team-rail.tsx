'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteInboxMessage, HyrteStakeholder } from '@/lib/hyrte-types';
import { deriveStakeholderStatus, STATUS_DOT, STATUS_LABEL } from '@/lib/hyrte-status';

/**
 * Master Build Prompt Part E2 — the TEAM rail: a persistent, live-status
 * stakeholder list visible from every workspace screen (not a dedicated nav
 * page you have to go find). Status is derived entirely from real data
 * already flowing to the candidate (unread/urgent inbox, currentTasks) —
 * never a fabricated client-side timer, never the trust/emotion internals
 * Hard Rule #5 keeps off the candidate's payloads.
 */
export function TeamRail({ sessionId }: { sessionId: string }) {
  const { stakeholderVersion, inboxVersion } = useHyrteStore();

  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', sessionId, stakeholderVersion],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${sessionId}/stakeholders`),
  });
  // Inbox is the only surface that tracks readAt/urgent — Slack has no
  // read-tracking in this app, so status intentionally isn't derived from it
  // (no fabricated signal where no real one exists).
  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', sessionId, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${sessionId}/inbox`),
  });

  if (!stakeholders?.length) return null;

  return (
    <div className="mb-4">
      <div className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Team</div>
      <div className="space-y-0.5">
        {stakeholders.map((s) => {
          const status = deriveStakeholderStatus(s, inbox);
          return (
            <Link
              key={s.id}
              href={`/hyrte/session/${sessionId}/slack?dm=${s.id}`}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              title={STATUS_LABEL[status]}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/5 text-[10px] font-semibold dark:bg-white/10">
                {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{s.name}</span>
                <span className="block truncate text-[11px] text-black/40 dark:text-white/40">{s.role}</span>
              </span>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
