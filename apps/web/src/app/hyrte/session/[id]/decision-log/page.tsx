'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { HyrteDecisionLogEntry } from '@/lib/hyrte-types';

const ACTION_LABELS: Record<string, string> = {
  'email.reply': 'Replied to an email',
  'slack.send': 'Sent a Slack message',
  'task.status_change': 'Changed a task status',
  'knowledge_base.view': 'Consulted the knowledge base',
  'baseline_challenge.submit': 'Answered the warm-up challenge',
};

export default function HyrteDecisionLog({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: entries } = useQuery({
    queryKey: ['hyrte', 'decision-log', id],
    queryFn: () => api.get<HyrteDecisionLogEntry[]>(`/hyrte/sessions/${id}/decision-log`),
  });

  return (
    <DashboardShell
      area="hyrte"
      title="Decision Log"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <p className="mb-4 text-sm text-black/60 dark:text-white/60">
        Everything you&apos;ve done in this simulation — this is what the interviewer will ask you about.
      </p>
      <div className="space-y-2">
        {entries?.map((e) => (
          <div key={e.id} className="card flex items-center justify-between">
            <span className="text-sm font-medium">{ACTION_LABELS[e.actionType] ?? e.actionType}</span>
            <span className="text-xs text-black/40 dark:text-white/40">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
        ))}
        {!entries?.length && <p className="text-sm text-black/50 dark:text-white/50">No actions logged yet.</p>}
      </div>
    </DashboardShell>
  );
}
