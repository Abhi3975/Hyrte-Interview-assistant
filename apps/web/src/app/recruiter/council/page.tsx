'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { CheckIcon, AlertIcon, XIcon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';

interface CouncilAgentReport {
  id: string;
  agentKey: string;
  agentName: string;
  stance: 'HIRE' | 'LEAN_HIRE' | 'LEAN_NO_HIRE' | 'NO_HIRE' | null;
  reasoning: string;
  keyPoints: string[];
  citedEvidenceIds: string[];
}

interface CouncilDiscussionEntry {
  agentKey: string;
  statement: string;
  respondingToAgentKey: string | null;
  ordinal: number;
}

interface HyrteSide {
  report: {
    sessionId: string;
    recommendation: string;
    confidencePercent: number | null;
    nextStepRecommendation: string | null;
    summary: string;
    generatedAt: string;
  };
  agentReports: CouncilAgentReport[];
  discussion: CouncilDiscussionEntry[];
}

interface AllySide {
  evaluation: {
    sessionId: string;
    recommendation: string;
    confidencePercent: number | null;
    nextStepRecommendation: string | null;
    summary: string;
    createdAt: string;
    predictions: { dimension: string; likelihood: string; reasoning: string }[];
    session?: { interview?: { jobRole: string } | null } | null;
  };
  agentReports: CouncilAgentReport[];
  discussion: CouncilDiscussionEntry[];
}

interface CandidateCouncilResponse {
  hyrte: HyrteSide | null;
  ally: AllySide | null;
}

const HYRTE_REC_META: Record<string, { icon: typeof CheckIcon; wrap: string; text: string }> = {
  'Strong Fit': { icon: CheckIcon, wrap: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-600' },
  Fit: { icon: CheckIcon, wrap: 'border-brand-500/30 bg-brand-500/5', text: 'text-brand-600' },
  'Weak Fit': { icon: AlertIcon, wrap: 'border-amber-500/30 bg-amber-500/5', text: 'text-amber-600' },
  'Not a Fit': { icon: XIcon, wrap: 'border-red-500/30 bg-red-500/5', text: 'text-red-600' },
};
const ALLY_REC_META: Record<string, { icon: typeof CheckIcon; wrap: string; text: string }> = {
  STRONG_HIRE: { icon: CheckIcon, wrap: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-600' },
  HIRE: { icon: CheckIcon, wrap: 'border-brand-500/30 bg-brand-500/5', text: 'text-brand-600' },
  LEAN_HIRE: { icon: AlertIcon, wrap: 'border-amber-500/30 bg-amber-500/5', text: 'text-amber-600' },
  NO_HIRE: { icon: XIcon, wrap: 'border-red-500/30 bg-red-500/5', text: 'text-red-600' },
  STRONG_NO_HIRE: { icon: XIcon, wrap: 'border-red-500/30 bg-red-500/5', text: 'text-red-600' },
};
const ALLY_REC_LABEL: Record<string, string> = {
  STRONG_HIRE: 'Strong Hire', HIRE: 'Hire', LEAN_HIRE: 'Lean Hire', NO_HIRE: 'No Hire', STRONG_NO_HIRE: 'Strong No Hire',
};
const DEFAULT_META = HYRTE_REC_META.Fit;

const STANCE_META: Record<string, string> = {
  HIRE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  LEAN_HIRE: 'bg-brand-500/15 text-brand-700 dark:text-brand-400',
  LEAN_NO_HIRE: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  NO_HIRE: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

function VerdictCard({
  icon: Icon,
  wrap,
  text,
  label,
  confidencePercent,
  summary,
  nextStepRecommendation,
}: {
  icon: typeof CheckIcon;
  wrap: string;
  text: string;
  label: string;
  confidencePercent: number | null;
  summary: string;
  nextStepRecommendation: string | null;
}) {
  return (
    <div className={`card flex items-start gap-4 border ${wrap}`}>
      <Icon className={`h-6 w-6 shrink-0 ${text}`} />
      <div>
        <div className="flex items-center gap-3">
          <span className={`text-lg font-bold ${text}`}>{label}</span>
          {confidencePercent !== null && (
            <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
              {confidencePercent}% confidence
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-black/70 dark:text-white/70">{summary}</p>
        {nextStepRecommendation && (
          <p className="mt-2 text-xs font-medium text-black/50 dark:text-white/50">Recommended next step: {nextStepRecommendation}</p>
        )}
      </div>
    </div>
  );
}

function AgentReports({ agentReports }: { agentReports: CouncilAgentReport[] }) {
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Committee — 9 individual reports</h3>
      <div className="space-y-3">
        {agentReports.map((a) => (
          <div key={a.agentKey} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{a.agentName}</span>
              {a.stance && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STANCE_META[a.stance] ?? ''}`}>
                  {a.stance.replace('_', ' ')}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-black/70 dark:text-white/70">{a.reasoning}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Discussion({ agentReports, discussion }: { agentReports: CouncilAgentReport[]; discussion: CouncilDiscussionEntry[] }) {
  const byKey = new Map(agentReports.map((a) => [a.agentKey, a]));
  return (
    <div className="card">
      <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Committee discussion</h3>
      <div className="space-y-2">
        {discussion.map((d, i) => (
          <div key={i} className="text-sm">
            <span className="font-medium">{byKey.get(d.agentKey)?.agentName ?? d.agentKey}: </span>
            <span className="text-black/70 dark:text-white/70">{d.statement}</span>
            {d.respondingToAgentKey && (
              <span className="ml-1.5 text-xs text-black/40 dark:text-white/40">
                (re: {byKey.get(d.respondingToAgentKey)?.agentName ?? d.respondingToAgentKey})
              </span>
            )}
          </div>
        ))}
        {discussion.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No discussion recorded.</p>}
      </div>
    </div>
  );
}

export default function UnifiedCouncilPage() {
  const [candidateId, setCandidateId] = useState('');
  const [activeId, setActiveId] = useState('');

  const query = useQuery({
    queryKey: ['unified-council', activeId],
    queryFn: () => api.get<CandidateCouncilResponse>(`/council/candidate/${activeId}`),
    enabled: Boolean(activeId),
    retry: false,
  });

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <DashboardShell
      area="recruiter"
      title="Decision Council"
      requiredRoles={['RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN']}
    >
      <div className="mb-6 card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">Candidate (user) ID</label>
          <input
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value.trim())}
            placeholder="Paste a candidate id…"
            className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
          />
        </div>
        <button
          onClick={() => setActiveId(candidateId)}
          disabled={!candidateId}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Load
        </button>
      </div>
      <p className="mb-6 text-xs text-black/50 dark:text-white/50">
        One candidate can go through both a HYRTE workplace simulation and a direct Ally interview — each runs its own
        9-agent Decision Council. This page shows the candidate&apos;s most recent verdict from each, side by side,
        instead of two separate pages.
      </p>

      {!activeId && <div className="card text-sm text-black/60 dark:text-white/60">Load a candidate to see their council verdicts.</div>}

      {activeId && notFound && (
        <div className="card text-sm text-black/60 dark:text-white/60">Couldn&apos;t load council data for this candidate.</div>
      )}

      {activeId && query.data && !query.data.hyrte && !query.data.ally && (
        <div className="card text-sm text-black/60 dark:text-white/60">
          No Decision Council has convened yet for this candidate on either surface.
        </div>
      )}

      {activeId && query.data && (query.data.hyrte || query.data.ally) && (
        <div className="mx-auto max-w-5xl space-y-8">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                HYRTE workplace simulation
              </h2>
              {query.data.hyrte ? (
                <VerdictCard
                  {...(HYRTE_REC_META[query.data.hyrte.report.recommendation] ?? DEFAULT_META)}
                  label={query.data.hyrte.report.recommendation}
                  confidencePercent={query.data.hyrte.report.confidencePercent}
                  summary={query.data.hyrte.report.summary}
                  nextStepRecommendation={query.data.hyrte.report.nextStepRecommendation}
                />
              ) : (
                <div className="card text-sm text-black/50 dark:text-white/50">No HYRTE simulation report on file for this candidate.</div>
              )}
            </div>
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Ally interview</h2>
              {query.data.ally ? (
                <VerdictCard
                  {...(ALLY_REC_META[query.data.ally.evaluation.recommendation] ?? ALLY_REC_META.HIRE)}
                  label={ALLY_REC_LABEL[query.data.ally.evaluation.recommendation] ?? query.data.ally.evaluation.recommendation}
                  confidencePercent={query.data.ally.evaluation.confidencePercent}
                  summary={query.data.ally.evaluation.summary}
                  nextStepRecommendation={query.data.ally.evaluation.nextStepRecommendation}
                />
              ) : (
                <div className="card text-sm text-black/50 dark:text-white/50">No Ally interview evaluation on file for this candidate.</div>
              )}
            </div>
          </div>

          {query.data.hyrte && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                HYRTE committee detail
              </h2>
              <div className="space-y-4">
                <AgentReports agentReports={query.data.hyrte.agentReports} />
                <Discussion agentReports={query.data.hyrte.agentReports} discussion={query.data.hyrte.discussion} />
              </div>
            </div>
          )}

          {query.data.ally && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                Ally committee detail
              </h2>
              <div className="space-y-4">
                <AgentReports agentReports={query.data.ally.agentReports} />
                <Discussion agentReports={query.data.ally.agentReports} discussion={query.data.ally.discussion} />
              </div>
            </div>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
