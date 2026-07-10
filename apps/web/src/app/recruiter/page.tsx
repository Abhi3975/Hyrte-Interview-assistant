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

export default function RecruiterDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['interviews'],
    queryFn: () => api.get<Interview[]>('/interviews'),
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
