'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HyrteSession } from '@/lib/hyrte-types';
import { TeamRail } from './team-rail';

/**
 * Session-context sidebar block, shown on every `/hyrte/session/:id/*`
 * screen (Part E2's "global shell"): the company card plus the live TEAM
 * rail — not a page you have to navigate to separately.
 */
export function HyrteSessionInfoCard({ sessionId }: { sessionId: string }) {
  const { data } = useQuery({
    queryKey: ['hyrte', 'session', sessionId],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${sessionId}`),
  });

  if (!data) return null;

  return (
    <>
      <div className="mb-4 rounded-lg border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="truncate text-sm font-semibold">{data.companyName}</div>
        <div className="truncate text-xs text-black/50 dark:text-white/50">{data.role}</div>
      </div>
      <TeamRail sessionId={sessionId} />
    </>
  );
}
