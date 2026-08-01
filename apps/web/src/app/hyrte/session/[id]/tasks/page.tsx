'use client';

import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteTask } from '@/lib/hyrte-types';

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-500/15 text-red-600',
  medium: 'bg-amber-500/15 text-amber-600',
  low: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
};

export default function HyrteTasks({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { taskVersion } = useHyrteStore();
  const queryClient = useQueryClient();

  const { data: tasks } = useQuery({
    queryKey: ['hyrte', 'tasks', id, taskVersion],
    queryFn: () => api.get<HyrteTask[]>(`/hyrte/sessions/${id}/tasks`),
  });

  async function toggle(task: HyrteTask) {
    const status = task.status === 'done' ? 'open' : 'done';
    await api.patch(`/hyrte/sessions/${id}/tasks/${task.id}`, { status });
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'tasks', id] });
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
  }

  return (
    <DashboardShell
      area="hyrte"
      title="Tasks"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="space-y-2">
        {tasks?.map((t) => (
          <div key={t.id} className="card flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} className="h-4 w-4" />
              <div>
                <div className={`font-medium ${t.status === 'done' ? 'text-black/40 line-through dark:text-white/40' : ''}`}>{t.title}</div>
                {t.dueAt && <div className="text-xs text-black/50 dark:text-white/50">Due {new Date(t.dueAt).toLocaleString()}</div>}
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.low}`}>{t.priority}</span>
          </div>
        ))}
        {!tasks?.length && <p className="text-sm text-black/50 dark:text-white/50">No tasks yet.</p>}
      </div>
    </DashboardShell>
  );
}
