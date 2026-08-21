'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { HyrteSession, HyrteStakeholder, PLANNED_DURATION_MINUTES } from '@/lib/hyrte-types';

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

  // Refinements doc §1 — "Introduce the Stakeholders... every simulation
  // begins by introducing the key people." Reuses the existing
  // /stakeholders endpoint rather than a new one — was previously only
  // reachable via a separate nav click, never surfaced up front.
  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
    enabled: !!brief,
  });
  const keyPeople = [...(stakeholders ?? [])].sort((a, b) => b.authorityLevel - a.authorityLevel).slice(0, 4);

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
        {session?.phase === 'GENERATION_FAILED' && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="rounded-full bg-red-500/10 p-3 text-red-500">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="font-semibold">We couldn&apos;t build this workplace</p>
              <p className="mt-1 max-w-sm text-sm text-black/60 dark:text-white/60">
                Something went wrong generating a workplace grounded in this role — rather than show you a
                generic one that wouldn&apos;t reflect it accurately, we stopped. This is on us, not
                something you did.
              </p>
            </div>
            {session.simulationRequest?.code ? (
              <a href={`/hyrte/start/${session.simulationRequest.code}`} className="btn-primary">
                Try again
              </a>
            ) : (
              <p className="text-xs text-black/50 dark:text-white/50">Ask whoever sent you this link for a new one.</p>
            )}
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

            {/* Refinements doc §1 — "multiple priorities to balance rather than one obvious task." */}
            <div className="card space-y-3">
              <h3 className="font-semibold">Priorities to balance</h3>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                  Primary — must accomplish
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-black/80 dark:text-white/80">
                  {brief.objectives.primary.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                  Secondary — should also accomplish
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                  {brief.objectives.secondary.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  Stretch — above and beyond
                </div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                  {brief.objectives.stretch.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="card">
              <h3 className="font-semibold">Known risks</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                {brief.knownRisks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-black/40 dark:text-white/40">
                These are the risks you&apos;re told about upfront. Real workplaces have others you&apos;ll
                only find by asking the right questions.
              </p>
            </div>

            <div className="card">
              <h3 className="font-semibold">You&apos;ll be evaluated on</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-black/70 dark:text-white/70">
                {brief.successMetrics.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>

            {keyPeople.length > 0 && (
              <div className="card">
                <h3 className="font-semibold">Key people you&apos;ll work with</h3>
                <div className="mt-3 flex flex-wrap gap-3">
                  {keyPeople.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-2.5 py-1.5 dark:border-white/10">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold dark:bg-white/10">
                        {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </span>
                      <div>
                        <div className="text-xs font-medium">{s.name}</div>
                        <div className="text-[11px] text-black/50 dark:text-white/50">{s.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
