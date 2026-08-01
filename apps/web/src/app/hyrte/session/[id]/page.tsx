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
  HyrteCalendarEvent,
  HyrteCompanyState,
  HyrteInboxMessage,
  HyrteSession,
} from '@/lib/hyrte-types';

export default function HyrteHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { companyStateVersion, inboxVersion } = useHyrteStore();

  const { data: session } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
  });
  const { data: companyState } = useQuery({
    queryKey: ['hyrte', 'company-state', id, companyStateVersion],
    queryFn: () => api.get<HyrteCompanyState>(`/hyrte/sessions/${id}/company-state`),
  });
  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', id, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${id}/inbox`),
  });
  const { data: calendar } = useQuery({
    queryKey: ['hyrte', 'calendar', id],
    queryFn: () => api.get<HyrteCalendarEvent[]>(`/hyrte/sessions/${id}/calendar`),
  });

  const unread = inbox?.filter((m) => !m.readAt) ?? [];
  const urgent = unread.filter((m) => m.urgent);

  return (
    <DashboardShell
      area="hyrte"
      title={session ? `${session.companyName} — ${session.role}` : 'Workplace'}
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold">Company snapshot</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {companyState &&
              (Object.keys(COMPANY_STATE_LABELS) as (keyof typeof COMPANY_STATE_LABELS)[]).map((key) => (
                <Meter key={key} label={COMPANY_STATE_LABELS[key]} value={companyState[key]} invert={INVERTED_COMPANY_STATE_KEYS.has(key)} />
              ))}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold">Needs your attention</h3>
          {urgent.length === 0 && <p className="mt-2 text-sm text-black/50 dark:text-white/50">Nothing urgent right now.</p>}
          <ul className="mt-3 space-y-2">
            {urgent.map((m) => (
              <li key={m.id} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <div className="font-medium">{m.subject}</div>
                <div className="text-xs text-black/50 dark:text-white/50">from {m.fromStakeholder?.name}</div>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-xs text-black/50 dark:text-white/50">{unread.length} unread in inbox</div>
        </div>
      </div>

      <div className="mt-6 card">
        <h3 className="font-semibold">Today&apos;s schedule</h3>
        <div className="mt-3 space-y-2">
          {calendar?.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
              <span className="font-medium">{c.title}</span>
              <span className="text-xs text-black/50 dark:text-white/50">
                {new Date(c.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
          {!calendar?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing scheduled.</p>}
        </div>
      </div>
    </DashboardShell>
  );
}
