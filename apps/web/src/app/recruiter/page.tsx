'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Interview {
  id: string;
  title: string;
  jobRole: string;
  category: string;
  status: string;
  _count: { sessions: number; questions: number };
}

const num = (data: Interview[] | undefined, pick: (i: Interview) => number) =>
  (data ?? []).reduce((a, i) => a + pick(i), 0);

interface Overview {
  interviews: number;
  funnel: Record<string, number>;
  recommendations: Record<string, number>;
  avgScore: number;
  flaggedForReview: number;
}

export default function RecruiterDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['interviews'],
    queryFn: () => api.get<Interview[]>('/interviews'),
  });
  const { data: ov } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get<Overview>('/analytics/overview'),
  });

  return (
    <DashboardShell area="recruiter" title="Recruiter Dashboard" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <div className="mb-6 flex items-center justify-between">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Assessments" value={String(data?.length ?? 0)} />
          <Stat label="Live now" value={String((data ?? []).filter((i) => i.status === 'SCHEDULED').length)} />
          <Stat label="Candidates" value={String(num(data, (i) => i._count.sessions))} />
          <Stat label="Questions" value={String(num(data, (i) => i._count.questions))} />
        </div>
        <Link href="/recruiter/interviews/new" className="btn-primary ml-5">+ New assessment</Link>
      </div>

      {/* Analytics */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Avg candidate score" value={ov ? `${ov.avgScore}/100` : '—'} />
        <Stat label="Completed interviews" value={String(ov?.funnel?.COMPLETED ?? 0)} />
        <Stat label="Hire recommendations" value={String((ov?.recommendations?.HIRE ?? 0) + (ov?.recommendations?.STRONG_HIRE ?? 0) + (ov?.recommendations?.LEAN_HIRE ?? 0))} />
        <Stat label="Flagged for review" value={String(ov?.flaggedForReview ?? 0)} />
      </div>
      {ov && Object.keys(ov.recommendations).length > 0 && (
        <div className="card mb-6">
          <h3 className="mb-2 font-semibold">Hiring funnel</h3>
          <div className="space-y-2">
            {[['STRONG_HIRE', 'Strong hire', 'bg-emerald-600'], ['HIRE', 'Hire', 'bg-emerald-500'], ['LEAN_HIRE', 'Lean hire', 'bg-amber-500'], ['NO_HIRE', 'No hire', 'bg-red-500'], ['STRONG_NO_HIRE', 'Strong no hire', 'bg-red-700']].map(([k, label, color]) => {
              const n = ov.recommendations[k] ?? 0;
              const total = Object.values(ov.recommendations).reduce((a, b) => a + b, 0) || 1;
              return (
                <div key={k}>
                  <div className="flex justify-between text-xs"><span>{label}</span><span className="tabular-nums">{n}</span></div>
                  <div className="mt-0.5 h-2 rounded-full bg-black/10 dark:bg-white/10"><div className={`h-full rounded-full ${color}`} style={{ width: `${(n / total) * 100}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="mb-3 font-semibold">Your assessments</h3>
        {isLoading ? (
          <p className="text-sm text-black/50">Loading…</p>
        ) : !data?.length ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No assessments yet. Create one to start interviewing candidates.
          </p>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {data.map((iv) => (
              <Link key={iv.id} href={`/recruiter/interviews/${iv.id}`} className="flex items-center justify-between py-3 transition hover:opacity-80">
                <div>
                  <div className="font-medium">{iv.title}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {iv.jobRole} · {iv.category} · {iv._count.questions} questions · {iv._count.sessions} candidates
                  </div>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${iv.status === 'SCHEDULED' ? 'bg-emerald-500/15 text-emerald-600' : 'border border-black/10 dark:border-white/10'}`}>
                  {iv.status === 'SCHEDULED' ? 'LIVE' : iv.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card">
      <div className="text-sm text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
