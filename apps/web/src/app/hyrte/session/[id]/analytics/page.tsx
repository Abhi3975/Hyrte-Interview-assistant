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

interface WhatChangedCard {
  at: string;
  headline: string;
  cause: string;
}

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
  const { data: whatChanged } = useQuery({
    queryKey: ['hyrte', 'what-changed', id, companyStateVersion],
    queryFn: () => api.get<WhatChangedCard[]>(`/hyrte/sessions/${id}/what-changed`),
  });

  // §4.1 — role-scoped dashboard: a PM sees product/customer/growth signals,
  // an Engineer sees engineering health, etc., instead of every role seeing
  // the identical full 16-metric panel.
  const keys = session ? getAnalyticsKeysForRole(session.role) : [];

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
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

      <div className="mt-6 card">
        <h3 className="font-semibold">What changed</h3>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">Every real state change this session, traced to its cause.</p>
        <div className="mt-3 space-y-2">
          {whatChanged?.map((c, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
              <div>
                <div className="font-medium">{c.headline}</div>
                <div className="text-xs text-black/50 dark:text-white/50">{c.cause}</div>
              </div>
              <span className="shrink-0 text-xs text-black/40 dark:text-white/40">
                {new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {!whatChanged?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing has changed yet.</p>}
        </div>
      </div>
    </DashboardShell>
  );
}
