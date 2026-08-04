'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteWorkItem } from '@/lib/hyrte-types';

const DECISIONS: { value: 'approve' | 'request_changes' | 'reject' | 'reassign'; label: string; primary?: boolean }[] = [
  { value: 'approve', label: 'Approve', primary: true },
  { value: 'request_changes', label: 'Request changes' },
  { value: 'reject', label: 'Reject' },
  { value: 'reassign', label: 'Reassign' },
];

export default function HyrteNeedsReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { taskVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ['hyrte', 'needs-review', id, taskVersion],
    queryFn: () => api.get<HyrteWorkItem[]>(`/hyrte/sessions/${id}/needs-review`),
  });

  async function decide(workItemId: string, decision: (typeof DECISIONS)[number]['value']) {
    setSubmitting(workItemId);
    try {
      await api.post(`/hyrte/sessions/${id}/work-items/${workItemId}/review`, { decision, note: notes[workItemId] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'needs-review', id] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Needs Review"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="space-y-4">
        {items?.map((item) => {
          const latestArtifact = item.artifacts[item.artifacts.length - 1];
          return (
            <div key={item.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{item.title}</div>
                  <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                    from {item.ownerStakeholder?.name ?? 'Unknown'} · {item.ownerStakeholder?.role}
                  </div>
                </div>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium dark:bg-white/10">{item.priority}</span>
              </div>

              {latestArtifact && (
                <div className="mt-3 rounded-lg border border-black/5 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                    {latestArtifact.type.replace('_', ' ')}
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-black/80 dark:text-white/80">{latestArtifact.content}</p>
                </div>
              )}

              <textarea
                className="mt-3 w-full rounded-lg border border-black/10 bg-transparent p-2 text-sm dark:border-white/10"
                rows={2}
                placeholder="Optional note (used for Request changes)…"
                value={notes[item.id] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                {DECISIONS.map((d) => (
                  <button
                    key={d.value}
                    disabled={submitting === item.id}
                    onClick={() => decide(item.id, d.value)}
                    className={d.primary ? 'btn-primary' : 'btn-ghost'}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!items?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing needs your review right now.</p>}
      </div>
    </DashboardShell>
  );
}
