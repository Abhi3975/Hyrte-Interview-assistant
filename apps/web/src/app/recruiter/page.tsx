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

export default function RecruiterDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['interviews'],
    queryFn: () => api.get<Interview[]>('/interviews'),
  });

  return (
    <DashboardShell area="recruiter" title="Recruiter Dashboard" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <div className="mb-6 flex items-center justify-between">
        <div className="grid flex-1 grid-cols-3 gap-5">
          <Stat label="Assessments" value={String(data?.length ?? 0)} />
          <Stat label="Live now" value="0" />
          <Stat label="Awaiting review" value="0" />
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
              <div key={iv.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="font-medium">{iv.title}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {iv.jobRole} · {iv.category} · {iv._count.questions} questions
                  </div>
                </div>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs dark:border-white/10">
                  {iv.status}
                </span>
              </div>
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
