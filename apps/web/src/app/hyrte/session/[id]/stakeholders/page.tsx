'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteStakeholder } from '@/lib/hyrte-types';

export default function HyrteStakeholders({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { stakeholderVersion } = useHyrteStore();

  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id, stakeholderVersion],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
  });

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Stakeholders"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {stakeholders?.map((s) => (
          <div key={s.id} className="card">
            <div className="font-semibold">{s.name}</div>
            <div className="mb-3 flex items-center gap-2 text-sm text-black/50 dark:text-white/50">
              <span>{s.role}</span>
              {s.department && (
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">{s.department}</span>
              )}
            </div>
            {s.currentTasks.length > 0 && (
              <ul className="space-y-1 text-sm text-black/70 dark:text-white/70">
                {s.currentTasks.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-black/30 dark:text-white/30">•</span>
                    {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
