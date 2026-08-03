'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { Meter } from '@/components/hyrte/meter';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import {
  COMPANY_STATE_LABELS,
  INVERTED_COMPANY_STATE_KEYS,
  HyrteCompanyState,
  HyrteSession,
  getAnalyticsKeysForRole,
} from '@/lib/hyrte-types';

export default function HyrteAnalytics({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { companyStateVersion } = useHyrteStore();

  const { data: companyState } = useQuery({
    queryKey: ['hyrte', 'company-state', id, companyStateVersion],
    queryFn: () => api.get<HyrteCompanyState>(`/hyrte/sessions/${id}/company-state`),
  });
  // Same queryKey as HyrteSessionInfoCard — React Query dedupes the request.
  const { data: session } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
  });

  // §4.1 — role-scoped dashboard: a PM sees product/customer/growth signals,
  // an Engineer sees engineering health, etc., instead of every role seeing
  // the identical full 16-metric panel.
  const keys = session ? getAnalyticsKeysForRole(session.role) : [];

  return (
    <DashboardShell
      area="hyrte"
      title="Company Analytics"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <p className="mb-4 text-sm text-black/60 dark:text-white/60">
        What a {session?.role ?? 'someone in this role'} would actually see — decision-support, not a scoreboard.
      </p>
      <div className="card grid gap-5 sm:grid-cols-2">
        {companyState &&
          keys.map((key) => (
            <Meter key={key} label={COMPANY_STATE_LABELS[key]} value={companyState[key]} invert={INVERTED_COMPANY_STATE_KEYS.has(key)} />
          ))}
      </div>
    </DashboardShell>
  );
}
