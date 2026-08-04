'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { Meter } from '@/components/hyrte/meter';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { HyrteWsClient, HyrteWsEvent } from '@/lib/hyrte-ws';
import {
  ACTION_LABELS,
  COMPANY_STATE_LABELS,
  INVERTED_COMPANY_STATE_KEYS,
  HyrteCompanyState,
  HyrteDecisionLogEntry,
  HyrteStakeholderInternal,
  HyrteWorkItem,
} from '@/lib/hyrte-types';

interface Overview {
  companyName: string;
  role: string;
  experienceLevel: string;
  industry: string;
  companyType: string;
  difficulty: string;
  culture: string;
  phase: string;
  startedAt: string;
  eventsFired: number;
  eventsPending: number;
  evidenceCount: number;
  actionCount: number;
}

interface EvidenceRow {
  id: string;
  type: string;
  source: string;
  rawText: string;
  behaviorContext: string | null;
  createdAt: string;
}

interface WhatChangedCard {
  at: string;
  headline: string;
  cause: string;
}

interface FocusMapRow {
  id: string;
  subject: string;
  from: string | null;
  urgent: boolean;
  arrivedAt: string;
  firstOpenedAt: string | null;
  ignored: boolean;
}

const POLL_MS = 8_000;

export default function HyrteLiveConsole() {
  const [sessionId, setSessionId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [flashedIds, setFlashedIds] = useState<Set<string>>(new Set());
  const accessToken = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const wsRef = useRef<HyrteWsClient | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['hyrte-live', 'overview', activeId],
    queryFn: () => api.get<Overview>(`/hyrte/sessions/${activeId}/recruiter/overview`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const stakeholdersQuery = useQuery({
    queryKey: ['hyrte-live', 'stakeholders', activeId],
    queryFn: () => api.get<HyrteStakeholderInternal[]>(`/hyrte/sessions/${activeId}/recruiter/stakeholders`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const companyStateQuery = useQuery({
    queryKey: ['hyrte-live', 'company-state', activeId],
    queryFn: () => api.get<HyrteCompanyState>(`/hyrte/sessions/${activeId}/recruiter/company-state`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const whatChangedQuery = useQuery({
    queryKey: ['hyrte-live', 'what-changed', activeId],
    queryFn: () => api.get<WhatChangedCard[]>(`/hyrte/sessions/${activeId}/recruiter/what-changed`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const evidenceQuery = useQuery({
    queryKey: ['hyrte-live', 'evidence', activeId],
    queryFn: () => api.get<EvidenceRow[]>(`/hyrte/sessions/${activeId}/recruiter/evidence`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const workItemsQuery = useQuery({
    queryKey: ['hyrte-live', 'work-items', activeId],
    queryFn: () => api.get<HyrteWorkItem[]>(`/hyrte/sessions/${activeId}/recruiter/work-items`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const focusMapQuery = useQuery({
    queryKey: ['hyrte-live', 'focus-map', activeId],
    queryFn: () => api.get<FocusMapRow[]>(`/hyrte/sessions/${activeId}/recruiter/focus-map`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });
  const decisionLogQuery = useQuery({
    queryKey: ['hyrte-live', 'decision-log', activeId],
    queryFn: () => api.get<HyrteDecisionLogEntry[]>(`/hyrte/sessions/${activeId}/recruiter/decision-log`),
    enabled: Boolean(activeId),
    retry: false,
    refetchInterval: POLL_MS,
  });

  // Part E3 "card flash on Decision Engine touch" — the one event type this
  // console gets a real live push for (see hyrte.gateway.ts's recruiter
  // channel); everything else above polls.
  useEffect(() => {
    if (!activeId || !accessToken) return;
    const client = new HyrteWsClient();
    wsRef.current = client;
    client.connect(accessToken, activeId, (msg: HyrteWsEvent) => {
      if (msg.type === 'stakeholder:update') {
        const s = msg.stakeholder as { id: string };
        setFlashedIds((prev) => new Set(prev).add(s.id));
        setTimeout(() => setFlashedIds((prev) => { const next = new Set(prev); next.delete(s.id); return next; }), 1200);
        qc.invalidateQueries({ queryKey: ['hyrte-live', 'stakeholders', activeId] });
      }
    });
    return () => client.close();
  }, [activeId, accessToken, qc]);

  return (
    <DashboardShell area="recruiter" variant="hyrte-os" title="HYRTE Live Console" requiredRoles={['RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN']}>
      <div className="mb-6 card flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">HYRTE session ID</label>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value.trim())}
            placeholder="Paste a session id…"
            className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
          />
        </div>
        <button
          onClick={() => setActiveId(sessionId)}
          disabled={!sessionId}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Watch
        </button>
      </div>
      <p className="mb-6 text-xs text-black/50 dark:text-white/50">
        Unredacted — trust, emotion, and hidden intentions are visible here and only here. Same no-assignment-model
        caveat as the Decision Council: paste a session id directly.
      </p>

      {!activeId && <div className="card text-sm text-black/60 dark:text-white/60">Watch a session to see it live.</div>}

      {activeId && overviewQuery.data && (
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Session orchestrator card */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-lg font-semibold">{overviewQuery.data.companyName}</div>
                <div className="text-sm text-black/50 dark:text-white/50">
                  {overviewQuery.data.experienceLevel} {overviewQuery.data.role} · {overviewQuery.data.industry} ·{' '}
                  {overviewQuery.data.companyType} · {overviewQuery.data.difficulty} · {overviewQuery.data.culture}
                </div>
              </div>
              <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium dark:bg-white/10">{overviewQuery.data.phase}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Events Fired', overviewQuery.data.eventsFired],
                ['Events Pending', overviewQuery.data.eventsPending],
                ['Evidence Written', overviewQuery.data.evidenceCount],
                ['Candidate Actions', overviewQuery.data.actionCount],
              ].map(([label, val]) => (
                <div key={label as string} className="rounded-lg border border-black/5 p-3 dark:border-white/10">
                  <div className="text-2xl font-semibold">{val}</div>
                  <div className="text-[11px] uppercase tracking-wide text-black/40 dark:text-white/40">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stakeholder grid — internals allowed */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Stakeholders — internals</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {stakeholdersQuery.data?.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    flashedIds.has(s.id) ? 'border-brand-500 bg-brand-500/10' : 'border-black/10 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-xs text-black/40 dark:text-white/40">{s.department}</span>
                  </div>
                  <div className="mb-2 text-xs text-black/50 dark:text-white/50">{s.role}</div>
                  {s.hiddenIntention && (
                    <p className="mb-2 rounded bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      Hidden: {s.hiddenIntention}
                    </p>
                  )}
                  {s.privateKnowledge?.length > 0 && (
                    <div className="mb-2 rounded bg-purple-500/10 p-2 text-xs text-purple-700 dark:text-purple-400">
                      <div className="mb-0.5 font-medium">Only they know:</div>
                      {s.privateKnowledge.map((k, i) => (
                        <p key={i}>{k}</p>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <Meter label="Trust" value={s.trust} />
                    <Meter label="Respect" value={s.respect} />
                    <Meter label="Cooperation" value={s.cooperation} />
                    <Meter label="Influence" value={s.influence} />
                    <Meter label="Stress" value={s.stress} invert />
                    <Meter label="Urgency" value={s.urgency} invert />
                    <Meter label="Patience" value={s.patience} />
                    <Meter label="Motivation" value={s.motivation} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Company state */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Company state — full</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {companyStateQuery.data &&
                (Object.keys(COMPANY_STATE_LABELS) as (keyof typeof COMPANY_STATE_LABELS)[]).map((key) => (
                  <Meter key={key} label={COMPANY_STATE_LABELS[key]} value={companyStateQuery.data![key]} invert={INVERTED_COMPANY_STATE_KEYS.has(key)} />
                ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* What-changed, unredacted (same underlying data as candidate's — never scrubbed) */}
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">What changed</h3>
              <div className="space-y-2">
                {whatChangedQuery.data?.map((c, i) => (
                  <div key={i} className="text-sm">
                    <div className="font-medium">{c.headline}</div>
                    <div className="text-xs text-black/50 dark:text-white/50">{c.cause} · {new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                ))}
                {!whatChangedQuery.data?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing yet.</p>}
              </div>
            </div>

            {/* Live evidence stream */}
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Evidence stream</h3>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {evidenceQuery.data?.slice().reverse().slice(0, 15).map((e) => (
                  <div key={e.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] dark:bg-white/10">{e.type}</span>
                      {e.behaviorContext && <span className="text-[10px] text-black/40 dark:text-white/40">{e.behaviorContext}</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-black/70 dark:text-white/70">{e.rawText}</p>
                  </div>
                ))}
                {!evidenceQuery.data?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing yet.</p>}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Work items */}
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Work items</h3>
              <div className="space-y-2">
                {workItemsQuery.data?.map((w) => (
                  <div key={w.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{w.title}</div>
                      <div className="text-xs text-black/50 dark:text-white/50">{w.ownerIsCandidate ? 'Candidate' : w.ownerStakeholder?.name ?? 'Unassigned'}</div>
                    </div>
                    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] dark:bg-white/10">{w.stage.replace('_', ' ')}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Candidate focus map */}
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Focus map — inbox</h3>
              <div className="space-y-2">
                {focusMapQuery.data?.map((f) => (
                  <div key={f.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{f.subject}</div>
                      <div className="text-xs text-black/50 dark:text-white/50">from {f.from ?? 'unknown'}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${f.ignored ? 'bg-red-500/15 text-red-600' : f.firstOpenedAt ? 'bg-emerald-500/15 text-emerald-600' : 'bg-black/5 dark:bg-white/10'}`}>
                      {f.ignored ? 'ignored' : f.firstOpenedAt ? 'opened' : 'unread'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent candidate actions */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Recent candidate actions</h3>
            <div className="space-y-2">
              {decisionLogQuery.data?.slice(0, 10).map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm">
                  <span>{ACTION_LABELS[e.actionType] ?? e.actionType}</span>
                  <span className="text-xs text-black/40 dark:text-white/40">{new Date(e.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
