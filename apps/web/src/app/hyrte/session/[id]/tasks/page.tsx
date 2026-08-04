'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteWorkItem, WorkItemStage } from '@/lib/hyrte-types';

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-600/15 text-red-700 dark:text-red-400',
  HIGH: 'bg-red-500/15 text-red-600',
  MEDIUM: 'bg-amber-500/15 text-amber-600',
  LOW: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
};

const COLUMNS: { stage: WorkItemStage; label: string }[] = [
  { stage: 'NEW', label: 'New' },
  { stage: 'IN_PROGRESS', label: 'In Progress' },
  { stage: 'WAITING_REVIEW', label: 'Waiting Review' },
  { stage: 'BLOCKED', label: 'Blocked' },
  { stage: 'DONE', label: 'Done' },
];

/** Part E2 — Work Pipeline: stage columns, count chips, one action per card, items move only from real activity. */
export default function HyrteWorkPipeline({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { taskVersion } = useHyrteStore();
  const queryClient = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ['hyrte', 'tasks', id, taskVersion],
    queryFn: () => api.get<HyrteWorkItem[]>(`/hyrte/sessions/${id}/tasks`),
  });

  async function completeOwn(item: HyrteWorkItem) {
    const stage = item.stage === 'DONE' ? 'NEW' : 'DONE';
    await api.patch(`/hyrte/sessions/${id}/tasks/${item.id}`, { stage });
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'tasks', id] });
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Work Pipeline"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="grid gap-4 overflow-x-auto pb-2" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(240px, 1fr))` }}>
        {COLUMNS.map((col) => {
          const colItems = items?.filter((i) => i.stage === col.stage) ?? [];
          return (
            <div key={col.stage} className="min-w-[240px]">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{col.label}</span>
                <span className="rounded-full bg-black/5 px-1.5 text-[11px] font-medium dark:bg-white/10">{colItems.length}</span>
              </div>
              <div className="space-y-2">
                {colItems.map((item) => (
                  <div key={item.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${PRIORITY_COLOR[item.priority] ?? PRIORITY_COLOR.LOW}`}>
                        {item.priority}
                      </span>
                      {item.origin === 'CANDIDATE_DELEGATION' && (
                        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] text-black/50 dark:bg-white/10 dark:text-white/50">
                          delegated
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-sm font-medium">{item.title}</div>
                    <div className="mt-1 text-xs text-black/50 dark:text-white/50">
                      {item.ownerIsCandidate ? 'You' : item.ownerStakeholder?.name ?? 'Unassigned'}
                    </div>
                    {item.dueAt && (
                      <div className="mt-1 text-[11px] text-black/40 dark:text-white/40">Due {new Date(item.dueAt).toLocaleDateString()}</div>
                    )}
                    <div className="mt-2">
                      {item.stage === 'WAITING_REVIEW' && !item.ownerIsCandidate ? (
                        <Link href={`/hyrte/session/${id}/needs-review`} className="text-xs font-medium text-brand-600 dark:text-brand-400">
                          Review →
                        </Link>
                      ) : item.ownerIsCandidate && item.stage !== 'BLOCKED' ? (
                        <button className="text-xs font-medium text-brand-600 dark:text-brand-400" onClick={() => completeOwn(item)}>
                          {item.stage === 'DONE' ? 'Reopen' : 'Mark done'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {colItems.length === 0 && <p className="px-1 text-xs text-black/30 dark:text-white/30">—</p>}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardShell>
  );
}
