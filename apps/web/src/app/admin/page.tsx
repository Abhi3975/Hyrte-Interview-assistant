'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Stats {
  orgs: number;
  users: number;
  interviews: number;
  sessions: number;
  terminated: number;
}

export default function AdminOverview() {
  const { data } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<Stats>('/admin/stats'),
  });

  return (
    <DashboardShell area="admin" title="Platform Overview" requiredRoles={['SUPER_ADMIN']}>
      <div className="grid gap-5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Companies" value={data?.orgs} />
        <Stat label="Users" value={data?.users} />
        <Stat label="Assessments" value={data?.interviews} />
        <Stat label="Sessions" value={data?.sessions} />
        <Stat label="Auto-terminated" value={data?.terminated} />
      </div>
      <div className="mt-6 card">
        <h3 className="font-semibold">System health</h3>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          API, database, and AI providers report healthy via <code>/ready</code>. Metrics and SLO
          alerts are served by Prometheus/Grafana (see <code>infra/monitoring</code>).
        </p>
      </div>
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="card">
      <div className="text-sm text-black/50 dark:text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value ?? '—'}</div>
    </div>
  );
}
