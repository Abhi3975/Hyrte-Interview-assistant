'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Progress {
  attempts: number;
  avgScore: number;
  history: {
    id: string;
    completedAt?: string;
    riskScore?: number;
    interview: { title: string; category: string };
    evaluation?: { overallScore: number; recommendation: string };
    _count?: { proctorEvents: number };
  }[];
}

export default function CandidateReports() {
  const { data } = useQuery({
    queryKey: ['my-progress'],
    queryFn: () => api.get<Progress>('/analytics/me/progress'),
  });

  return (
    <DashboardShell area="candidate" title="Reports & Progress" requiredRoles={['CANDIDATE']}>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="card">
          <div className="text-sm text-black/50 dark:text-white/50">Interviews completed</div>
          <div className="mt-1 text-2xl font-bold">{data?.attempts ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-sm text-black/50 dark:text-white/50">Average score</div>
          <div className="mt-1 text-2xl font-bold">{data?.avgScore ?? '—'}</div>
        </div>
      </div>

      <div className="mt-6 card">
        <h3 className="font-semibold">History</h3>
        <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">Score, hiring signal & proctoring integrity for each recorded interview.</p>
        <div className="mt-3 space-y-2">
          {data?.history?.map((h) => {
            const integrity = typeof h.riskScore === 'number' ? Math.max(0, 100 - Math.round(h.riskScore)) : null;
            const flags = h._count?.proctorEvents ?? 0;
            return (
              <Link
                key={h.id}
                href={h.evaluation ? `/candidate/reports/${h.id}` : '#'}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/5 p-3 text-sm dark:border-white/10 ${h.evaluation ? 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]' : 'pointer-events-none'}`}
              >
                <div>
                  <div className="font-medium">{h.interview.title}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">{h.interview.category}{h.completedAt ? ` · ${new Date(h.completedAt).toLocaleDateString()}` : ''}</div>
                </div>
                <div className="flex items-center gap-3">
                  {integrity !== null && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${integrity >= 80 ? 'bg-emerald-500/15 text-emerald-600' : integrity >= 55 ? 'bg-amber-500/15 text-amber-600' : 'bg-red-500/15 text-red-600'}`}>
                      Integrity {integrity}
                    </span>
                  )}
                  <span className={`text-xs ${flags > 0 ? 'text-amber-600' : 'text-black/40 dark:text-white/40'}`}>
                    {flags} flag{flags === 1 ? '' : 's'}
                  </span>
                  <span className="font-medium text-black/70 dark:text-white/70">
                    {h.evaluation ? `${h.evaluation.overallScore} · ${h.evaluation.recommendation.replace('_', ' ')}` : 'Pending'}
                  </span>
                </div>
              </Link>
            );
          })}
          {!data?.history?.length && <p className="text-sm text-black/60 dark:text-white/60">No completed interviews yet.</p>}
        </div>
      </div>
    </DashboardShell>
  );
}
