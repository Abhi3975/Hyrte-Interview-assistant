'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { Meter } from '@/components/hyrte/meter';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { SessionClock } from '@/components/hyrte/session-clock';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import {
  ACTION_LABELS,
  COMPANY_STATE_LABELS,
  INVERTED_COMPANY_STATE_KEYS,
  HyrteCalendarEvent,
  HyrteCompanyState,
  HyrteDecisionLogEntry,
  HyrteInboxMessage,
  HyrteSession,
  HyrteStakeholder,
  HyrteWorkItem,
} from '@/lib/hyrte-types';

function KpiTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <div className="text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-black/40 dark:text-white/40">{label}</div>
    </div>
  );
}

interface SystemMapDept {
  name: string;
  headStakeholderId: string | null;
  messageCount: number;
  stakeholders: { id: string; name: string; role: string }[];
}

export default function HyrteHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { companyStateVersion, inboxVersion, taskVersion, stakeholderVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [command, setCommand] = useState('');
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState(false);

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
  const { data: workItems } = useQuery({
    queryKey: ['hyrte', 'tasks', id, taskVersion],
    queryFn: () => api.get<HyrteWorkItem[]>(`/hyrte/sessions/${id}/tasks`),
  });
  const { data: needsReview } = useQuery({
    queryKey: ['hyrte', 'needs-review', id, taskVersion],
    queryFn: () => api.get<HyrteWorkItem[]>(`/hyrte/sessions/${id}/needs-review`),
  });
  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id, stakeholderVersion],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
  });
  const { data: decisionLog } = useQuery({
    queryKey: ['hyrte', 'decision-log', id],
    queryFn: () => api.get<HyrteDecisionLogEntry[]>(`/hyrte/sessions/${id}/decision-log`),
  });
  const { data: systemMap } = useQuery({
    queryKey: ['hyrte', 'system-map', id, stakeholderVersion],
    queryFn: () => api.get<SystemMapDept[]>(`/hyrte/sessions/${id}/system-map`),
  });

  const unread = inbox?.filter((m) => !m.readAt) ?? [];
  const urgent = unread.filter((m) => m.urgent);
  // Part E2 Command Center KPI tiles — the spec's own PM-role example names
  // (Open Escalations, Active Customers, Sprint Progress, Unread Threads)
  // assume a customer-facing stakeholder every world doesn't generate; these
  // four are the closest universally-real substitutes, all backed by data
  // that already exists for any role/seed.
  const openEscalations = unread.filter((m) => m.urgent || m.escalatesMessageId).length;
  const activeWorkItems = workItems?.filter((w) => w.stage === 'NEW' || w.stage === 'IN_PROGRESS').length ?? 0;

  const workstreams = (stakeholders ?? [])
    .map((s) => ({
      stakeholder: s,
      item: workItems?.find((w) => w.ownerStakeholderId === s.id && (w.stage === 'IN_PROGRESS' || w.stage === 'WAITING_REVIEW')),
    }))
    .filter((w) => w.item);

  async function sendCommand() {
    if (!command.trim()) return;
    setSendingCommand(true);
    setCommandResult(null);
    try {
      const res = await api.post<{ overreach: boolean; message: string }>(`/hyrte/sessions/${id}/command`, { instruction: command });
      setCommandResult(res.message);
      setCommand('');
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    } finally {
      setSendingCommand(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title={session ? `${session.companyName} — ${session.role}` : 'Workplace'}
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      {session && (
        <div className="mb-4 flex justify-end">
          <SessionClock session={session} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Open Escalations" value={openEscalations} />
        <Link href={`/hyrte/session/${id}/needs-review`}>
          <KpiTile label="Needs Review" value={needsReview?.length ?? 0} />
        </Link>
        <KpiTile label="Unread Threads" value={unread.length} />
        <KpiTile label="Active Work Items" value={activeWorkItems} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
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

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="font-semibold">Primary workstreams</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {workstreams.map(({ stakeholder, item }) => (
              <div key={stakeholder.id} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{stakeholder.name}</span>
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] dark:bg-white/10">{item!.stage.replace('_', ' ')}</span>
                </div>
                <div className="mt-1 text-xs text-black/50 dark:text-white/50">{item!.title}</div>
              </div>
            ))}
            {workstreams.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No active delegated work right now.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold">Recent activity</h3>
          <ul className="mt-3 space-y-2">
            {decisionLog?.slice(0, 6).map((e) => (
              <li key={e.id} className="text-sm">
                <div>{ACTION_LABELS[e.actionType] ?? e.actionType}</div>
                <div className="text-xs text-black/40 dark:text-white/40">{new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </li>
            ))}
            {!decisionLog?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing yet.</p>}
          </ul>
        </div>
      </div>

      <div className="mt-6 card">
        <h3 className="font-semibold">System map</h3>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          Real org structure — who&apos;s in each department, who leads it, and how much they&apos;ve reached out.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systemMap?.map((dept) => (
            <div key={dept.name} className="rounded-lg border border-black/5 p-3 dark:border-white/10">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{dept.name}</span>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] dark:bg-white/10">{dept.messageCount} msgs</span>
              </div>
              <ul className="mt-2 space-y-1">
                {dept.stakeholders.map((s) => (
                  <li key={s.id} className="text-xs text-black/70 dark:text-white/70">
                    {s.name}
                    {s.id === dept.headStakeholderId && (
                      <span className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-black/50 dark:bg-white/10 dark:text-white/50">
                        lead
                      </span>
                    )}
                    <span className="text-black/40 dark:text-white/40"> · {s.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!systemMap?.length && <p className="text-sm text-black/50 dark:text-white/50">No department structure yet.</p>}
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

      <div className="mt-6 card">
        <h3 className="font-semibold">Delegate something</h3>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          Tell a colleague what you need — it routes to them as real work and they&apos;ll actually work on it.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
            placeholder="e.g. Ask Lisa to draft a technical debt remediation plan by tomorrow"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
          />
          <button className="btn-primary" disabled={sendingCommand} onClick={sendCommand}>
            {sendingCommand ? 'Sending…' : 'Send'}
          </button>
        </div>
        {commandResult && <p className="mt-3 text-sm text-black/70 dark:text-white/70">{commandResult}</p>}
      </div>
    </DashboardShell>
  );
}
