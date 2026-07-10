'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Timeline {
  events: { id: string; type: string; severity: string; payload: Record<string, unknown>; occurredAt: string; provider: string }[];
  warnings: { id: string; reason?: string; createdAt: string }[];
  risk: { score?: number; probability?: number } | null;
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-600', HIGH: 'text-red-500', MEDIUM: 'text-amber-500', LOW: 'text-black/60 dark:text-white/60', INFO: 'text-black/40 dark:text-white/40',
};

export default function ProctoringTimeline({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['timeline', sessionId],
    queryFn: () => api.get<Timeline>(`/proctoring/sessions/${sessionId}/timeline`),
  });

  return (
    <DashboardShell area="recruiter" title="Proctoring Timeline" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <Link href="/recruiter/proctoring" className="text-sm text-brand-500">← Back to live proctoring</Link>

      {isLoading ? (
        <p className="mt-4 text-sm text-black/50">Loading timeline…</p>
      ) : error ? (
        <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">Could not load this session&apos;s timeline.</p>
      ) : (
        <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px]">
          <div className="card">
            <h3 className="font-semibold">Evidence timeline ({data?.events.length ?? 0})</h3>
            <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">Chronological signals captured during the interview. Evidence, not accusations.</p>
            {!data?.events.length ? (
              <p className="mt-3 text-sm text-black/60 dark:text-white/60">No proctoring events recorded — clean session.</p>
            ) : (
              <ol className="mt-3 space-y-2 border-l border-black/10 pl-4 dark:border-white/10">
                {data.events.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${SEV_COLOR[e.severity] ?? ''}`}>{e.type.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-black/40">{new Date(e.occurredAt).toLocaleTimeString()}</span>
                    </div>
                    {e.payload && Object.keys(e.payload).length > 0 && (
                      <div className="text-xs text-black/50 dark:text-white/50">{Object.entries(e.payload).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>
                    )}
                    <div className="text-[10px] uppercase tracking-wide text-black/30 dark:text-white/30">{e.severity} · {e.provider}</div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="space-y-4">
            <div className="card text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Risk score</div>
              <div className="mt-1 text-3xl font-bold">{data?.risk?.score != null ? Math.round(data.risk.score) : 0}<span className="text-sm font-normal text-black/40">/100</span></div>
              {data?.risk?.probability != null && <div className="text-xs text-black/50">{Math.round(data.risk.probability * 100)}% cheating probability</div>}
            </div>
            <div className="card">
              <div className="text-sm font-semibold">Warnings ({data?.warnings.length ?? 0})</div>
              {!data?.warnings.length ? (
                <p className="mt-1 text-xs text-black/50 dark:text-white/50">No warnings issued.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {data.warnings.map((w) => <li key={w.id} className="text-amber-600">{w.reason ?? 'Warning'} · {new Date(w.createdAt).toLocaleTimeString()}</li>)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
