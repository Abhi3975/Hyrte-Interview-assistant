'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { Meter } from '@/components/hyrte/meter';
import { CheckIcon, AlertIcon, XIcon } from '@/components/icons';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api, ApiError } from '@/lib/api';
import { HyrteInterviewReport, groupMetrics } from '@/lib/hyrte-types';

const RECOMMENDATION_META: Record<string, { icon: typeof CheckIcon; wrap: string; icon_bg: string; icon_fg: string; text: string }> = {
  'Strong Fit': { icon: CheckIcon, wrap: 'border-emerald-500/30 bg-emerald-500/5', icon_bg: 'bg-emerald-500/15', icon_fg: 'text-emerald-600', text: 'text-emerald-600' },
  Fit: { icon: CheckIcon, wrap: 'border-brand-500/30 bg-brand-500/5', icon_bg: 'bg-brand-500/15', icon_fg: 'text-brand-600', text: 'text-brand-600' },
  'Weak Fit': { icon: AlertIcon, wrap: 'border-amber-500/30 bg-amber-500/5', icon_bg: 'bg-amber-500/15', icon_fg: 'text-amber-600', text: 'text-amber-600' },
  'Not a Fit': { icon: XIcon, wrap: 'border-red-500/30 bg-red-500/5', icon_bg: 'bg-red-500/15', icon_fg: 'text-red-600', text: 'text-red-600' },
};
const DEFAULT_META = RECOMMENDATION_META.Fit;

export default function HyrteReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: report, error } = useQuery({
    queryKey: ['hyrte', 'report', id],
    queryFn: () => api.get<HyrteInterviewReport>(`/hyrte/sessions/${id}/interview/report`),
    retry: false,
  });

  const notGenerated = error instanceof ApiError && error.status === 404;
  const meta = report ? (RECOMMENDATION_META[report.recommendation] ?? DEFAULT_META) : DEFAULT_META;
  const RecIcon = meta.icon;

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Decision Intelligence Report"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      {notGenerated && (
        <div className="card">
          <p className="text-sm text-black/60 dark:text-white/60">
            No report yet — complete the{' '}
            <Link href={`/hyrte/session/${id}/interview`} className="font-medium text-brand-600 underline">
              reflection interview
            </Link>{' '}
            first.
          </p>
        </div>
      )}

      {report && (
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Hero: recommendation + summary */}
          <div className={`card flex items-start gap-4 border ${meta.wrap}`}>
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${meta.icon_bg}`}>
              <RecIcon className={`h-6 w-6 ${meta.icon_fg}`} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <span className={`text-lg font-bold ${meta.text}`}>{report.recommendation}</span>
                {report.confidencePercent !== null && (
                  <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                    {report.confidencePercent}% confidence
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                Hiring Insight — not a score, insights
              </p>
              <p className="mt-1 text-sm leading-relaxed text-black/70 dark:text-white/70">{report.summary}</p>
              {report.nextStepRecommendation && (
                <p className="mt-2 text-xs font-medium text-black/50 dark:text-white/50">
                  Recommended next step: {report.nextStepRecommendation}
                </p>
              )}
            </div>
          </div>

          {report.decisionDNA && (
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Decision DNA</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.decisionDNA.traits.map((t) => (
                  <span key={t} className="rounded-full bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-700 dark:text-brand-400">
                    {t}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-sm text-black/70 dark:text-white/70">{report.decisionDNA.reasoning}</p>
            </div>
          )}

          {/* Strengths / development areas as chips */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Strengths</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.strengths.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-700 dark:text-emerald-400"
                  >
                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Development Areas</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.developmentAreas.map((s, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-sm text-amber-700 dark:text-amber-400"
                  >
                    <AlertIcon className="h-3.5 w-3.5 shrink-0" />
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {report.contradictions.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Contradictions found</h3>
              <div className="mt-3 space-y-3">
                {report.contradictions.map((c, i) => (
                  <div key={i} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <div className="text-black/80 dark:text-white/80">
                      <span className="font-medium text-black dark:text-white">In the interview:</span> {c.claimedInInterview}
                    </div>
                    <div className="mt-1.5 text-black/80 dark:text-white/80">
                      <span className="font-medium text-black dark:text-white">What actually happened:</span> {c.evidenceFromSimulation}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {report.recoveryScore && (
              <div className="card">
                <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Recovery Score</h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{report.recoveryScore.score}</span>
                  <span className="text-sm text-black/50 dark:text-white/50">/ 100 — {report.recoveryScore.descriptor}</span>
                </div>
                <p className="mt-2 text-sm text-black/70 dark:text-white/70">{report.recoveryScore.reasoning}</p>
              </div>
            )}

          </div>

          {report.metricsBreakdown.length > 0 && (() => {
            const { roleCompetency, workplaceIntelligence } = groupMetrics(report.metricsBreakdown);
            return (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="card">
                  <h3 className="mb-3 flex items-baseline justify-between text-sm font-semibold text-black/50 dark:text-white/50">
                    <span>Role Competency (50%)</span>
                    {roleCompetency.avgScore !== null && <span className="text-black/70 dark:text-white/70">{roleCompetency.avgScore}/100</span>}
                  </h3>
                  <div className="space-y-3">
                    {roleCompetency.buckets.map((m) => (
                      <div key={m.bucket} title={m.explanation}>
                        <Meter label={m.bucket} value={m.score} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <h3 className="mb-3 flex items-baseline justify-between text-sm font-semibold text-black/50 dark:text-white/50">
                    <span>Workplace Intelligence (50%)</span>
                    {workplaceIntelligence.avgScore !== null && (
                      <span className="text-black/70 dark:text-white/70">{workplaceIntelligence.avgScore}/100</span>
                    )}
                  </h3>
                  <div className="space-y-3">
                    {workplaceIntelligence.buckets.map((m) => (
                      <div key={m.bucket} title={m.explanation}>
                        <Meter label={m.bucket} value={m.score} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {report.predictions.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">
                Predicted performance — insights, not scores
              </h3>
              <div className="mt-3 space-y-3">
                {report.predictions.map((p, i) => (
                  <div key={i} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.dimension}</span>
                      <span className="text-black/60 dark:text-white/60">{p.likelihood}</span>
                    </div>
                    <p className="mt-1 text-black/70 dark:text-white/70">{p.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.counterfactuals.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">What if they&apos;d chosen differently?</h3>
              <div className="mt-3 space-y-3">
                {report.counterfactuals.map((c, i) => (
                  <div key={i} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                    <div className="font-medium">{c.decisionPoint}</div>
                    <div className="mt-1 text-black/70 dark:text-white/70">
                      <span className="font-medium text-black dark:text-white">Alternative path:</span> {c.alternativePath}
                    </div>
                    <div className="mt-1 text-black/70 dark:text-white/70">
                      <span className="font-medium text-black dark:text-white">Projected outcome:</span> {c.projectedOutcome}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence trail as a simple timeline */}
          <div className="card">
            <h3 className="text-sm font-semibold text-black/50 dark:text-white/50">Evidence Trail</h3>
            <div className="mt-4 space-y-5 border-l-2 border-black/5 pl-4 dark:border-white/10">
              {report.evidenceTrail.map((e, i) => (
                <div key={i} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <div className="text-sm font-medium">{e.action}</div>
                  <div className="mt-1 text-sm italic text-black/50 dark:text-white/50">&ldquo;{e.interviewProbe}&rdquo;</div>
                  <div className="mt-1 text-sm text-black/70 dark:text-white/70">{e.interpretation}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
