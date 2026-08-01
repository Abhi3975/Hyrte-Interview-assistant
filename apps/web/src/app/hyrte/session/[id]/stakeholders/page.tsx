'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { Meter } from '@/components/hyrte/meter';
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
            <div className="mb-4 text-sm text-black/50 dark:text-white/50">{s.role}</div>
            <div className="space-y-3">
              <Meter label="Trust" value={s.trust} />
              <Meter label="Respect" value={s.respect} />
              <Meter label="Cooperation" value={s.cooperation} />
              <Meter label="Influence" value={s.influence} />
            </div>
          </div>
        ))}
      </div>
    </DashboardShell>
  );
}
