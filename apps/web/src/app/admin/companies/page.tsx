'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Org {
  id: string;
  name: string;
  slug: string;
  plan: string;
  _count: { users: number; interviews: number };
  subscriptions: { plan: string; status: string }[];
}

export default function AdminCompanies() {
  const { data } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get<Org[]>('/admin/organizations'),
  });

  return (
    <DashboardShell area="admin" title="Company Management" requiredRoles={['SUPER_ADMIN']}>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.map((o) => (
          <div key={o.id} className="card">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{o.name}</h3>
              <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs dark:border-white/10">{o.plan}</span>
            </div>
            <div className="mt-2 text-sm text-black/60 dark:text-white/60">
              {o._count.users} users · {o._count.interviews} assessments
            </div>
            {o.subscriptions[0] && (
              <div className="mt-1 text-xs text-black/50 dark:text-white/50">
                Subscription: {o.subscriptions[0].plan} ({o.subscriptions[0].status})
              </div>
            )}
          </div>
        ))}
        {!data?.length && <div className="card text-sm text-black/60 dark:text-white/60">No companies yet.</div>}
      </div>
    </DashboardShell>
  );
}
