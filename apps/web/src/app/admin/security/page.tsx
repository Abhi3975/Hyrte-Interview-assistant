'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface SecurityEvent {
  id: string;
  type: string;
  severity: string;
  provider: string;
  occurredAt: string;
  session: { id: string; candidateId: string };
}
interface AuditLog {
  id: string;
  action: string;
  createdAt: string;
  actor?: { email: string };
  targetType?: string;
}

export default function AdminSecurity() {
  const { data: events } = useQuery({
    queryKey: ['admin-security'],
    queryFn: () => api.get<SecurityEvent[]>('/admin/security'),
  });
  const { data: audit } = useQuery({
    queryKey: ['admin-audit'],
    queryFn: () => api.get<AuditLog[]>('/admin/audit'),
  });

  return (
    <DashboardShell area="admin" title="Security & Audit" requiredRoles={['SUPER_ADMIN']}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-semibold">High-severity proctoring signals</h3>
          <div className="mt-3 space-y-2">
            {events?.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className={e.severity === 'CRITICAL' ? 'text-red-500' : 'text-orange-500'}>●</span> {e.type}
                </span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {e.provider} · {new Date(e.occurredAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {!events?.length && <p className="text-sm text-black/60 dark:text-white/60">No high-severity events.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold">Audit log</h3>
          <div className="mt-3 space-y-2">
            {audit?.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {a.actor?.email ?? 'system'} · {new Date(a.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
            {!audit?.length && <p className="text-sm text-black/60 dark:text-white/60">No audit entries.</p>}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
