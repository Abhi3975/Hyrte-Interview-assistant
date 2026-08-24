'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { ACTION_LABELS, HyrteDecisionLogEntry } from '@/lib/hyrte-types';

const METRIC_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  customerSatisfaction: 'Customer Satisfaction',
  engineeringCapacity: 'Engineering Capacity',
  technicalDebt: 'Technical Debt',
  teamMorale: 'Team Morale',
  budget: 'Budget',
  riskLevel: 'Risk Level',
  deadlinePressure: 'Deadline Pressure',
  marketReputation: 'Market Reputation',
  cashRunway: 'Cash Runway',
  complianceRisk: 'Compliance Risk',
  productQuality: 'Product Quality',
  burnout: 'Team Burnout',
  hiringCapacity: 'Hiring Capacity',
  operationalRisk: 'Operational Risk',
  growth: 'Growth',
};

function DeltaChip({ metricKey, value }: { metricKey: string; value: number }) {
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        up ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'
      }`}
    >
      {METRIC_LABELS[metricKey] ?? metricKey} {up ? '↑' : '↓'} {Math.abs(value)}
    </span>
  );
}

/** One node in the causal chain — the decision itself, its stated reasoning/risk/outcome, what metrics it moved, and what it caused. Recurses one level into causedDecisions (the only depth this codebase's causal chains actually reach today). */
function DecisionNode({ entry, byId, depth }: { entry: HyrteDecisionLogEntry; byId: Map<string, HyrteDecisionLogEntry>; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const recoveredFrom = entry.recoveryOfId ? byId.get(entry.recoveryOfId) : undefined;
  const hasDetail = !!(entry.reasoning || entry.riskAssessment || entry.outcome || entry.stateDeltas.length || entry.causedDecisions.length || recoveredFrom);

  return (
    <div className={depth > 0 ? 'ml-5 border-l-2 border-black/10 pl-4 dark:border-white/10' : ''}>
      <div className="card">
        <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => hasDetail && setOpen((v) => !v)}>
          <div>
            <div className="text-sm font-medium">{ACTION_LABELS[entry.actionType] ?? entry.actionType}</div>
            {recoveredFrom && (
              <div className="mt-0.5 text-xs text-brand-600 dark:text-brand-400">
                ↳ Recovery attempt after: {ACTION_LABELS[recoveredFrom.actionType] ?? recoveredFrom.actionType}
              </div>
            )}
          </div>
          <span className="shrink-0 text-xs text-black/40 dark:text-white/40">{new Date(entry.createdAt).toLocaleString()}</span>
        </button>

        {open && hasDetail && (
          <div className="mt-3 space-y-2 border-t border-black/5 pt-3 text-sm dark:border-white/10">
            {entry.reasoning && <p className="text-black/70 dark:text-white/70">&ldquo;{entry.reasoning}&rdquo;</p>}
            {entry.riskAssessment && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                <span className="font-semibold">Risk: </span>
                {entry.riskAssessment}
              </p>
            )}
            {entry.outcome && <p className="text-black/80 dark:text-white/80">{entry.outcome}</p>}
            {entry.stateDeltas.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.stateDeltas.flatMap((d) =>
                  Object.entries(d.delta).map(([k, v]) => <DeltaChip key={`${d.createdAt}-${k}`} metricKey={k} value={v} />),
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {open && entry.causedDecisions.length > 0 && (
        <div className="mt-2 space-y-2">
          {entry.causedDecisions.map((c) => {
            const full = byId.get(c.id);
            return full ? (
              <DecisionNode key={c.id} entry={full} byId={byId} depth={depth + 1} />
            ) : (
              <div key={c.id} className="ml-5 border-l-2 border-black/10 pl-4 text-xs text-black/50 dark:border-white/10 dark:text-white/50">
                → {ACTION_LABELS[c.actionType] ?? c.actionType}: {c.outcome}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Refinements doc §10 — "An Explainable Audit Trail... every decision is
 * recorded as a chain of cause and effect," not a flat technical event list.
 * Top-level rows are decisions NOT themselves caused by another one
 * (causedByDecisionId is null) — a decision that IS caused by another
 * renders nested under its cause instead of a second time at the top level.
 */
export default function HyrteDecisionLog({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: entries } = useQuery({
    queryKey: ['hyrte', 'decision-log', id],
    queryFn: () => api.get<HyrteDecisionLogEntry[]>(`/hyrte/sessions/${id}/decision-log`),
  });

  const byId = new Map((entries ?? []).map((e) => [e.id, e]));
  const topLevel = (entries ?? []).filter((e) => !e.causedByDecisionId);

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Decision Log"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <p className="mb-4 text-sm text-black/60 dark:text-white/60">
        Everything you&apos;ve done in this simulation, and what it caused — this is what the interviewer will ask you about.
      </p>
      <div className="space-y-3">
        {topLevel.map((e) => (
          <DecisionNode key={e.id} entry={e} byId={byId} depth={0} />
        ))}
        {!topLevel.length && <p className="text-sm text-black/50 dark:text-white/50">No actions logged yet.</p>}
      </div>
    </DashboardShell>
  );
}
