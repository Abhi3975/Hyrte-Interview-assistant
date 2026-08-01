'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { HyrteSession } from '@/lib/hyrte-types';

/** UX flow §8 step 1 — shown once, before the workspace unlocks. */
export default function HyrteMissionBrief({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: session, isLoading } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
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
      title="Mission Brief"
      requiredRoles={['CANDIDATE']}
      navOverride={[]}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="mx-auto max-w-2xl py-6">
        {isLoading && <p className="text-sm text-black/50 dark:text-white/50">Loading your mission brief…</p>}
        {brief && session && (
          <div className="space-y-6">
            <div>
              <p className="text-sm text-black/50 dark:text-white/50">{session.companyName} · {session.role}</p>
              <h2 className="mt-1 text-xl font-semibold">Your objective</h2>
              <p className="mt-2 text-sm">{brief.objective}</p>
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
