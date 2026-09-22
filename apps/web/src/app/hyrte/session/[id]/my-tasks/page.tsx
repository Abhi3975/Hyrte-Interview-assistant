'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { PacingBanner } from '@/components/hyrte/pacing-banner';
import { SessionClock } from '@/components/hyrte/session-clock';
import { useHyrteNav } from '@/lib/hyrte-nav';
import { ActivityCenter } from '@/components/hyrte/activity-center';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HeroTaskList, HeroTaskState, HyrteSession } from '@/lib/hyrte-types';

const STATE_TONE: Record<HeroTaskState, string> = {
  ASSIGNED: 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50',
  INVESTIGATING: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  WORKING: 'bg-brand-500/15 text-brand-600 dark:text-brand-400',
  REVIEW: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  REVISION: 'bg-red-500/15 text-red-600 dark:text-red-400',
  COMPLETED: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
};

const WORKSPACE_CTA: Record<string, string> = {
  DELIVERABLE: 'Open workspace',
  DECISION: 'Open decision room',
  PRIORITIZATION: 'Open the board',
};

/**
 * Refinements doc §11 — "Every simulation should have 1–3 Hero Tasks. Don't
 * give them 25 fake tasks. Give them: your objectives, your 3 critical tasks.
 * Everything else becomes the environment around those objectives."
 *
 * Founder feedback (WhatsApp, 7 Sep) — "task added nhi h as per the job role
 * while working in the simulation" and "simulation kaafi review and approve
 * type hori thi instead of working on real tasks". This screen is the answer to
 * "what am I responsible for", and every card here opens somewhere the
 * candidate does real work rather than approving someone else's.
 */
export default function HyrteMyTasks({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const nav = useHyrteNav(id);
  const { taskVersion } = useHyrteStore();

  const { data: session } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
  });
  const { data } = useQuery({
    queryKey: ['hyrte', 'my-tasks', id, taskVersion],
    queryFn: () => api.get<HeroTaskList>(`/hyrte/sessions/${id}/my-tasks`),
  });

  const progressPct = data && data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="My Tasks"
      requiredRoles={['CANDIDATE']}
      navOverride={nav}
      headerExtra={<ActivityCenter sessionId={id} />}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      {session && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="min-w-[260px] flex-1">
            <PacingBanner session={session} />
          </div>
          <SessionClock session={session} />
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Primary objective</div>
            <h2 className="mt-1 text-xl font-semibold">{data?.primaryObjective || 'Loading your objective…'}</h2>
            <p className="mt-1 text-sm text-black/55 dark:text-white/55">Do the work. Make decisions. Drive outcomes.</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm text-black/50 dark:text-white/50">Overall progress</div>
            <div className="mt-1 text-2xl font-semibold">
              {data?.completed ?? 0}
              <span className="text-base text-black/40 dark:text-white/40"> / {data?.total ?? 0}</span>
            </div>
            <div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        {!!data?.objectives?.secondary?.length && (
          <div className="mt-4 grid gap-3 border-t border-black/5 pt-4 text-sm dark:border-white/10 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Should also accomplish</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-black/65 dark:text-white/65">
                {data.objectives.secondary.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
            {!!data.objectives.stretch?.length && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-black/40 dark:text-white/40">Above and beyond</div>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-black/65 dark:text-white/65">
                  {data.objectives.stretch.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 space-y-3">
        {data?.tasks.map((task, i) => (
          <div key={task.id} className="card flex flex-wrap items-start gap-4 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-sm font-semibold dark:bg-white/10">{i + 1}</div>
            <div className="min-w-[240px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{task.title}</h3>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_TONE[task.state]}`}>{task.stateLabel}</span>
                {task.submissionCount > 0 && (
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/50 dark:bg-white/10 dark:text-white/50">
                    {task.submissionCount} submission{task.submissionCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-black/60 dark:text-white/60">{task.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {task.tags.map((t) => (
                  <span key={t} className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/55 dark:bg-white/10 dark:text-white/55">
                    {t}
                  </span>
                ))}
              </div>
              {/* A colleague genuinely sent this back — surface it here, not only inside the task. */}
              {task.latestFeedback?.verdict === 'revision_requested' && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.07] p-2.5 text-xs">
                  <span className="font-medium">{task.latestFeedback.stakeholderName} asked for changes:</span>{' '}
                  <span className="text-black/65 dark:text-white/65">{task.latestFeedback.notes}</span>
                </div>
              )}
            </div>
            <Link href={`/hyrte/session/${id}/my-tasks/${task.id}`} className="btn-primary shrink-0 text-sm">
              {task.state === 'COMPLETED' ? 'View' : WORKSPACE_CTA[task.workspaceKind ?? ''] ?? 'Open task'} →
            </Link>
          </div>
        ))}
        {data && data.tasks.length === 0 && (
          <p className="card text-sm text-black/50 dark:text-white/50">No role tasks were generated for this session.</p>
        )}
      </div>
    </DashboardShell>
  );
}
