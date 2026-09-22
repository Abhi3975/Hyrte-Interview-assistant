'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { Meter } from '@/components/hyrte/meter';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { SessionClock } from '@/components/hyrte/session-clock';
import { PacingBanner } from '@/components/hyrte/pacing-banner';
import { GuidedOnboarding } from '@/components/hyrte/guided-onboarding';
import { useHyrteNav } from '@/lib/hyrte-nav';
import { ActivityCenter } from '@/components/hyrte/activity-center';
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
  HyrteActivityEntry,
  HyrteActivityFeed,
  HeroTaskList,
} from '@/lib/hyrte-types';

const ATTENTION_SOURCE_LABEL: Record<HyrteActivityEntry['source'], string> = {
  INBOX: 'Email',
  SLACK: 'Slack',
  MEETING: 'Meeting',
  REVIEW: 'Review',
  TASK: 'Task',
};

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
  unreadCount: number;
  activeWorkCount: number;
  needsReviewCount: number;
  metrics: { key: string; value: number }[];
  stakeholders: { id: string; name: string; role: string }[];
  activeWork: { id: string; title: string; stage: string; priority: string }[];
}

/** §2 — real causal edges only: one department's decision that actually caused a follow-on decision in another. */
interface SystemMapEdge {
  from: string;
  to: string;
  count: number;
  latest: string | null;
}

interface SystemMapResponse {
  nodes: SystemMapDept[];
  impactEdges: SystemMapEdge[];
}

export default function HyrteHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Live unread badges on the sidebar surfaces (Refinements doc §4).
  const nav = useHyrteNav(id);
  const { companyStateVersion, inboxVersion, slackVersion, taskVersion, stakeholderVersion, meetingVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [command, setCommand] = useState('');
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState(false);
  // §2 — which department node is expanded into its live drill-down.
  const [openDept, setOpenDept] = useState<string | null>(null);

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
    queryKey: ['hyrte', 'system-map', id, stakeholderVersion, taskVersion],
    queryFn: () => api.get<SystemMapResponse>(`/hyrte/sessions/${id}/system-map`),
  });
  // Refinements doc §3 — "Needs My Attention must be actionable". This card
  // used to list urgent INBOX messages only, so a blocked engineer on Slack, a
  // colleague waiting on a review, or a meeting about to start were all
  // invisible here. Same unified feed the bell and the sidebar badges use.
  const { data: heroTasks } = useQuery({
    queryKey: ['hyrte', 'my-tasks', id, taskVersion],
    queryFn: () => api.get<HeroTaskList>(`/hyrte/sessions/${id}/my-tasks`),
  });
  const { data: activity } = useQuery({
    queryKey: ['hyrte', 'activity', id, inboxVersion, slackVersion, taskVersion, meetingVersion],
    queryFn: () => api.get<HyrteActivityFeed>(`/hyrte/sessions/${id}/activity?limit=8`),
  });

  const unread = inbox?.filter((m) => !m.readAt) ?? [];
  const attention = (activity?.entries ?? []).filter((e) => e.unread).slice(0, 5);
  // Part E2 Command Center KPI tiles — the spec's own PM-role example names
  // (Open Escalations, Active Customers, Sprint Progress, Unread Threads)
  // assume a customer-facing stakeholder every world doesn't generate; these
  // four are the closest universally-real substitutes, all backed by data
  // that already exists for any role/seed.
  const openEscalations = unread.filter((m) => m.urgent || m.escalatesMessageId).length;
  const activeWorkItems = workItems?.filter((w) => w.stage === 'NEW' || w.stage === 'DELEGATED' || w.stage === 'IN_PROGRESS' || w.stage === 'WAITING').length ?? 0;

  // Refinements doc §5/§2 — "Team workload" on the dashboard should reflect
  // all 4 real in-flight stakeholder-owned stages, not just IN_PROGRESS/
  // WAITING_REVIEW — DELEGATED (just handed off) and WAITING (paused on the
  // candidate's answer) are just as much "what this person is on right now."
  const workstreams = (stakeholders ?? [])
    .map((s) => ({
      stakeholder: s,
      item: workItems?.find((w) => w.ownerStakeholderId === s.id && (w.stage === 'DELEGATED' || w.stage === 'IN_PROGRESS' || w.stage === 'WAITING' || w.stage === 'WAITING_REVIEW')),
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
      navOverride={nav}
      headerExtra={<ActivityCenter sessionId={id} />}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      {/* §14 — "the first 5-10 minutes should be guided." Steps 5-7 of the
          doc's seven; 1-4 are the Mission Brief they just read. */}
      {session && <GuidedOnboarding session={session} activity={activity} tasks={heroTasks} />}

      {session && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <PacingBanner session={session} />
          </div>
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
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Needs your attention</h3>
            {!!activity?.counts.total && (
              <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">{activity.counts.total}</span>
            )}
          </div>
          {attention.length === 0 && <p className="mt-2 text-sm text-black/50 dark:text-white/50">Nothing waiting on you right now.</p>}
          <ul className="mt-3 space-y-2">
            {attention.map((entry) => (
              <li key={entry.id}>
                {/* §3: "Clicking each should take the user directly to the relevant environment." */}
                <Link
                  href={entry.href}
                  className={`block rounded-lg border p-3 text-sm transition hover:bg-black/[0.03] dark:hover:bg-white/5 ${
                    entry.urgency === 'HIGH'
                      ? 'border-red-500/30 bg-red-500/[0.07]'
                      : 'border-black/10 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-black/50 dark:bg-white/10 dark:text-white/50">
                      {ATTENTION_SOURCE_LABEL[entry.source]}
                    </span>
                    {entry.personName && <span className="truncate text-xs text-black/60 dark:text-white/60">{entry.personName}</span>}
                  </div>
                  <div className="mt-1.5 font-medium">{entry.title}</div>
                  <p className="mt-0.5 text-xs text-black/55 dark:text-white/55">{entry.context}</p>
                </Link>
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

      {/* Refinements doc §2 — "don't make it decorative. Every node should
          represent an actual part of the simulated company." Each department
          now shows the metrics it owns, the work in flight there, and who is
          waiting on you, and opens that part of the company. */}
      <div className="mt-6 card">
        <h3 className="font-semibold">System map</h3>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          Each part of the company, live. Open one to see its people, its work, and what it&apos;s waiting on.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systemMap?.nodes.map((dept) => {
            const isOpen = openDept === dept.name;
            return (
              <div
                key={dept.name}
                className={`rounded-lg border p-3 transition ${
                  isOpen ? 'border-brand-500/40 bg-brand-500/[0.04]' : 'border-black/5 dark:border-white/10'
                }`}
              >
                <button className="w-full text-left" onClick={() => setOpenDept(isOpen ? null : dept.name)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{dept.name}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {dept.unreadCount > 0 && (
                        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{dept.unreadCount}</span>
                      )}
                      {dept.needsReviewCount > 0 && (
                        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          {dept.needsReviewCount} to review
                        </span>
                      )}
                    </span>
                  </div>
                  {/* The metrics this department actually owns. */}
                  {dept.metrics.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                      {dept.metrics.map((m) => (
                        <span key={m.key} className="text-[11px] text-black/55 dark:text-white/55">
                          {COMPANY_STATE_LABELS[m.key as keyof typeof COMPANY_STATE_LABELS] ?? m.key}{' '}
                          <span className="font-semibold tabular-nums text-black/80 dark:text-white/80">{m.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[11px] text-black/40 dark:text-white/40">
                    {dept.stakeholders.length} {dept.stakeholders.length === 1 ? 'person' : 'people'} · {dept.activeWorkCount} in flight
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-3 border-t border-black/5 pt-3 dark:border-white/10">
                    <ul className="space-y-1">
                      {dept.stakeholders.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/hyrte/session/${id}/slack?channel=${encodeURIComponent(`dm:${s.id}`)}`}
                            className="flex items-center justify-between rounded px-1 py-0.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                          >
                            <span className="text-black/70 dark:text-white/70">
                              {s.name}
                              {s.id === dept.headStakeholderId && (
                                <span className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-black/50 dark:bg-white/10 dark:text-white/50">
                                  lead
                                </span>
                              )}
                              <span className="text-black/40 dark:text-white/40"> · {s.role}</span>
                            </span>
                            <span className="shrink-0 text-[11px] text-brand-600 dark:text-brand-400">Message</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {dept.activeWork.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/35 dark:text-white/35">In flight</div>
                        <ul className="space-y-0.5">
                          {dept.activeWork.map((w) => (
                            <li key={w.id} className="truncate text-xs text-black/60 dark:text-white/60">
                              {w.title} <span className="text-black/35 dark:text-white/35">· {w.stage.replace('_', ' ').toLowerCase()}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!systemMap?.nodes.length && <p className="text-sm text-black/50 dark:text-white/50">No department structure yet.</p>}
        </div>

        {/* §2's "relationship effects" — drawn only from decisions that really
            did cause a follow-on decision elsewhere. No edges yet is the
            honest state of a session where nothing has knocked on. */}
        {!!systemMap?.impactEdges.length && (
          <div className="mt-5 border-t border-black/5 pt-4 dark:border-white/10">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
              Knock-on effects so far
            </div>
            <ul className="space-y-1.5">
              {systemMap.impactEdges.map((e) => (
                <li key={`${e.from}-${e.to}`} className="text-xs">
                  <span className="font-medium">{e.from}</span>
                  <span className="mx-1.5 text-black/35 dark:text-white/35">→</span>
                  <span className="font-medium">{e.to}</span>
                  <span className="ml-2 text-black/40 dark:text-white/40">
                    {e.count}×{e.latest ? ` · ${e.latest}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
