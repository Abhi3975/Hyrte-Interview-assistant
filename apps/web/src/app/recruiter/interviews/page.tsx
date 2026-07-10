'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Interview {
  id: string; title: string; jobRole: string; category: string; status: string;
  _count: { sessions: number; questions: number };
}

export default function AssessmentsList() {
  const { data, isLoading } = useQuery({ queryKey: ['interviews'], queryFn: () => api.get<Interview[]>('/interviews') });

  return (
    <DashboardShell area="recruiter" title="Assessments" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-black/60 dark:text-white/60">Create, publish and invite candidates to AI interviews.</p>
        <Link href="/recruiter/interviews/new" className="btn-primary">+ New assessment</Link>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-black/50">Loading…</p>
        ) : !data?.length ? (
          <div className="py-8 text-center">
            <p className="text-sm text-black/60 dark:text-white/60">No assessments yet.</p>
            <Link href="/recruiter/interviews/new" className="btn-primary mt-3 inline-flex">Create your first assessment</Link>
          </div>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {data.map((iv) => (
              <Link key={iv.id} href={`/recruiter/interviews/${iv.id}`} className="flex items-center justify-between py-3 transition hover:opacity-80">
                <div>
                  <div className="font-medium">{iv.title}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">{iv.jobRole} · {iv.category} · {iv._count.questions} questions · {iv._count.sessions} candidates</div>
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
