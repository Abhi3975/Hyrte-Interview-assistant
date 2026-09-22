'use client';

import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { LiveCompetencyState, LiveDeliberation } from '@/lib/hyrte-types';

/**
 * "Live multi agent Interviewer panel" doc — "the panel should observe
 * silently, occasionally requesting the lead interviewer to probe deeper. Then,
 * after the interview, the recruiter gets access to the full deliberation."
 *
 * This is that access. Distinct from the post-interview Decision Council
 * (which debates a finished transcript): this is the per-competency evidence
 * state the committee maintained WHILE the candidate was talking, and the
 * background exchange that actually redirected each question.
 *
 * Shared by the HYRTE session view and the Ally session view — both record the
 * same shape, from the same engine, at different endpoints.
 *
 * Design note: no new chart vocabulary here. Confidence reuses the same
 * bar+value+threshold-colour treatment as the HYRTE company-state Meter, and
 * the strength chips use this page's existing status palette — so it reads as
 * one system rather than importing a second one. Every strength ships with its
 * text label, never colour alone: "conflicting" is semantically a contradiction
 * to resolve, not merely a low score, and colour cannot carry that difference.
 */

const STRENGTH_META: Record<LiveCompetencyState['strength'], { label: string; chip: string; bar: string }> = {
  strong: { label: 'Strong', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  medium: { label: 'Medium', chip: 'bg-brand-500/15 text-brand-700 dark:text-brand-400', bar: 'bg-brand-500' },
  weak: { label: 'Weak', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  conflicting: { label: 'Contradiction', chip: 'bg-red-500/15 text-red-700 dark:text-red-400', bar: 'bg-red-500' },
  none: { label: 'No evidence', chip: 'bg-black/5 text-black/50 dark:bg-white/10 dark:text-white/50', bar: 'bg-black/20 dark:bg-white/20' },
};

const PRIORITY_LABEL: Record<LiveCompetencyState['priority'], string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
};

/** Whose line it is in the background exchange — the committee's own voices. */
const SPEAKER_TONE: Record<string, string> = {
  'Decision Cortex': 'text-brand-600 dark:text-brand-400',
  'Evidence Auditor': 'text-red-600 dark:text-red-400',
  "Devil's Advocate": 'text-amber-600 dark:text-amber-400',
  'Hiring Manager': 'text-emerald-600 dark:text-emerald-400',
  'Interview Lead': 'text-black/60 dark:text-white/60',
};

function CompetencyRow({ c }: { c: LiveCompetencyState }) {
  const meta = STRENGTH_META[c.strength];
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{c.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/50 dark:bg-white/10 dark:text-white/50">
          {PRIORITY_LABEL[c.priority]}
        </span>
        {!c.probe && (
          <span
            className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/45 dark:bg-white/10 dark:text-white/45"
            title="Assessed from how the candidate answers, never by a dedicated question"
          >
            implicit
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-black/50 dark:text-white/50">
          {c.confidence}%
          {c.turnsSpent > 0 && <span className="ml-2 text-black/35 dark:text-white/35">{c.turnsSpent} probe{c.turnsSpent === 1 ? '' : 's'}</span>}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.min(100, Math.max(0, c.confidence))}%` }} />
      </div>
      {c.notes.length > 0 && <p className="mt-2 text-xs leading-relaxed text-black/55 dark:text-white/55">{c.notes[c.notes.length - 1]}</p>}
    </div>
  );
}

export function LiveDeliberationPanel({ endpoint, queryKey }: { endpoint: string; queryKey: unknown[] }) {
  const { data, error, isLoading } = useQuery({
    queryKey,
    queryFn: () => api.get<LiveDeliberation>(endpoint),
    retry: false,
  });

  if (isLoading) return <div className="card text-sm text-black/50 dark:text-white/50">Loading the committee&apos;s reasoning…</div>;

  // A 404 means the session exists but the interview never started; an empty
  // competency list means the same thing for a session that did.
  const notStarted = (error instanceof ApiError && error.status === 404) || (data && data.competencies.length === 0);
  if (notStarted) {
    return (
      <div className="card text-sm text-black/60 dark:text-white/60">
        The committee has nothing recorded for this session yet — it starts tracking evidence from the first interview
        question.
      </div>
    );
  }
  if (error || !data) return <div className="card text-sm text-black/60 dark:text-white/60">Could not load the committee&apos;s reasoning for this session.</div>;

  const evidenced = data.competencies.filter((c) => c.confidence > 0 || c.turnsSpent > 0);
  // Two genuinely different reasons a competency has nothing against it, and
  // lumping them together misreads the interview: a PROBED one the committee
  // never got to is a coverage gap, whereas an IMPLICIT one simply was not
  // evidenced by how the candidate happened to answer — it was never going to
  // be asked about in the first place.
  const untouched = data.competencies.filter((c) => c.confidence === 0 && c.turnsSpent === 0);
  const unreached = untouched.filter((c) => c.probe);
  const unevidenced = untouched.filter((c) => !c.probe);
  const latest = data.directives[data.directives.length - 1];
  const turns = [...new Set(data.deliberation.map((d) => d.atTurn))].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Live committee</h3>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-black/50 dark:text-white/50">
              What the panel was tracking while the candidate was talking, and why each question changed direction. The
              candidate never saw any of this.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-3xl font-semibold tabular-nums">{data.overallConfidence}%</div>
            <div className="text-xs text-black/50 dark:text-white/50">decision confidence</div>
          </div>
        </div>
        {latest && (
          <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/5 p-3">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">
              {latest.readyToConclude ? 'Committee was ready to conclude' : 'Standing objective'}
            </div>
            <p className="mt-1 text-sm">{latest.objective}</p>
            <p className="mt-1 text-xs text-black/55 dark:text-white/55">{latest.rationale}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Evidence by competency</h3>
        <div className="space-y-2">
          {evidenced.map((c) => (
            <CompetencyRow key={c.key} c={c} />
          ))}
          {evidenced.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">Nothing evidenced yet.</p>}
        </div>
        {unreached.length > 0 && (
          <p className="mt-3 text-xs text-black/45 dark:text-white/45">
            <span className="font-medium">Coverage gap</span> — the interview never reached:{' '}
            {unreached.map((c) => c.label).join(', ')}.
          </p>
        )}
        {unevidenced.length > 0 && (
          <p className="mt-1.5 text-xs text-black/45 dark:text-white/45">
            Not evidenced by how they answered (never probed directly): {unevidenced.map((c) => c.label).join(', ')}.
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Background exchange</h3>
        <div className="space-y-4">
          {turns.map((turn) => (
            <div key={turn}>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-black/35 dark:text-white/35">
                After answer {turn}
              </div>
              <div className="space-y-1.5 border-l border-black/10 pl-3 dark:border-white/10">
                {data.deliberation
                  .filter((d) => d.atTurn === turn)
                  .map((d, i) => (
                    <div key={i} className="text-sm">
                      <span className={`font-medium ${SPEAKER_TONE[d.speaker] ?? ''}`}>{d.speaker}: </span>
                      <span className="text-black/70 dark:text-white/70">{d.message}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
          {turns.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No exchange recorded yet.</p>}
        </div>
      </div>
    </div>
  );
}
