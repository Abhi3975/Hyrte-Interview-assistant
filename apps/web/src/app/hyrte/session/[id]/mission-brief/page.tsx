'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { HyrteSession, PLANNED_DURATION_MINUTES } from '@/lib/hyrte-types';

/** UX flow §8 step 1 — shown once, before the workspace unlocks. */
export default function HyrteMissionBrief({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: session, isLoading } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
    // Upgrade §2/§4 — session creation returns immediately in phase
    // GENERATING while the world builds in the background; poll until it
    // flips to MISSION_BRIEF rather than holding one long request open
    // (that used to time out on slow generations — see hyrte-sessions.service.ts).
    refetchInterval: (query) => (query.state.data?.phase === 'GENERATING' ? 1500 : false),
    // Without this, react-query pauses polling whenever the tab isn't the
    // visibly-focused one — the world keeps generating server-side
    // regardless, so the client should keep checking regardless too.
    refetchIntervalInBackground: true,
  });

  const continueMutation = useMutation({
    mutationFn: () => api.post(`/hyrte/sessions/${id}/mission-brief/continue`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'session', id] });
      router.push(`/hyrte/session/${id}/baseline-challenge`);
    },
  });

  const brief = session?.missionBrief;

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Mission Brief"
      requiredRoles={['CANDIDATE']}
      navOverride={[]}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="mx-auto max-w-2xl py-6">
        {isLoading && <p className="text-sm text-black/50 dark:text-white/50">Loading your mission brief…</p>}
        {session?.phase === 'GENERATING' && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            <p className="text-sm text-black/60 dark:text-white/60">
              Building your workplace — company, stakeholders, inbox, and more…
            </p>
          </div>
        )}
        {brief && session && session.phase !== 'GENERATING' && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-black/50 dark:text-white/50">{session.companyName} · {session.role}</p>
              <h2 className="mt-1 text-xl font-semibold">Your objective</h2>
              <p className="mt-2 text-sm">{brief.objective}</p>
              {brief.manager && (
                <p className="mt-2 text-xs text-black/50 dark:text-white/50">
                  Reporting to <span className="font-medium text-black/70 dark:text-white/70">{brief.manager.name}</span> ({brief.manager.role})
                </p>
              )}
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                Planned duration: {PLANNED_DURATION_MINUTES[session.difficulty] ?? 20} minutes
              </p>
            </div>

            <div className="card">
              <h3 className="font-semibold">Why it matters</h3>
              <p className="mt-2 text-sm text-black/70 dark:text-white/70">{brief.whyItMatters}</p>
            </div>

            <div className="card">
              <h3 className="font-semibold">Current state of the business</h3>
              <p className="mt-2 text-sm text-black/70 dark:text-white/70">{brief.currentHealth}</p>
            </div>

            <div className="card">
              <h3 className="font-semibold">You&apos;ll be evaluated on</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                {brief.successMetrics.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3 className="font-semibold">What to expect</h3>
              <p className="mt-2 text-sm text-black/70 dark:text-white/70">
                A real workplace environment — inbox, Slack, tasks, calendar, stakeholders with their own goals and
                emotional state. Every decision has a consequence, and there usually isn&apos;t a single right answer.
                You&apos;ll finish with a short reflection interview and a report.
              </p>
            </div>

            <button
              className="btn-primary w-full"
              disabled={continueMutation.isPending}
              onClick={() => continueMutation.mutate()}
            >
              {continueMutation.isPending ? 'Starting…' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
