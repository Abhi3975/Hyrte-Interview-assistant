'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { CheckIcon, AlertIcon, XIcon, HelpCircleIcon } from '@/components/icons';
import { api } from '@/lib/api';
import type { CouncilCalibration, CouncilAgentCalibration } from '@/lib/hyrte-types';

/**
 * §9 Learning Engine, recruiter view — the committee's report card on itself.
 *
 * The honest framing matters more than the numbers here: this measures which
 * members called it right among the candidates who were actually hired. It
 * cannot measure a rejection, because nobody ever found out. The page says so
 * rather than letting the percentages imply more than they carry.
 */

const AGENT_NAMES: Record<string, string> = {
  interviewLead: 'Interview Lead',
  hiringManager: 'Hiring Manager',
  functionalExpert: 'Functional Expert',
  futureTeammate: 'Future Teammate',
  executiveFounder: 'Executive / Founder',
};

const VERDICT_META: Record<CouncilAgentCalibration['verdict'], { label: string; icon: typeof CheckIcon; wrap: string; text: string; blurb: string }> = {
  PREDICTIVE: {
    label: 'Predictive',
    icon: CheckIcon,
    wrap: 'border-emerald-500/30 bg-emerald-500/5',
    text: 'text-emerald-600',
    blurb: 'Backed the hires who worked out and doubted the ones who did not.',
  },
  NEUTRAL: {
    label: 'Not informative',
    icon: HelpCircleIcon,
    wrap: 'border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]',
    text: 'text-black/50 dark:text-white/50',
    blurb: 'Said much the same thing either way, so their vote adds little.',
  },
  ANTI_PREDICTIVE: {
    label: 'Backwards',
    icon: XIcon,
    wrap: 'border-red-500/30 bg-red-500/5',
    text: 'text-red-600',
    blurb: 'Leaned toward the hires that did not work out. Down-weighted, not removed.',
  },
  INSUFFICIENT: {
    label: 'Not enough data',
    icon: AlertIcon,
    wrap: 'border-amber-500/30 bg-amber-500/5',
    text: 'text-amber-600',
    blurb: 'Has not voted on enough sessions with a known outcome to judge.',
  },
};

const CONFIDENCE_VERDICT: Record<string, string> = {
  WELL_CALIBRATED: 'Decision Cortex claims about as much certainty as it earns.',
  OVERCONFIDENT: 'Decision Cortex claims more certainty than its record supports — read its confidence figure down.',
  UNDERCONFIDENT: 'Decision Cortex has been more right than it claimed — its confidence figure is conservative.',
  INSUFFICIENT: 'Not enough reports with a recorded confidence to tell yet.',
};

export default function CouncilCalibrationPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['council-calibration'],
    queryFn: () => api.get<CouncilCalibration>('/hyrte/council-calibration'),
  });

  return (
    <DashboardShell area="recruiter" title="Committee calibration">
      <p className="mb-5 max-w-3xl text-sm text-black/60 dark:text-white/60">
        Every hiring outcome recorded against a HYRTE session feeds back here. Members whose stance has actually tracked
        how the hire worked out count for more in the next committee vote; members who said the same thing regardless
        count for less.
      </p>

      {isLoading && <p className="text-sm text-black/50 dark:text-white/50">Reading the record…</p>}
      {isError && <p className="text-sm text-red-600">Could not load calibration.</p>}

      {data && (
        <div className="space-y-4">
          {/* The evidence base, stated before any conclusion drawn from it. */}
          <div className="card">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <Stat label="Outcomes recorded" value={data.totalLabelled} />
              <Stat label="Hires that worked out" value={data.successes} />
              <Stat label="Hires that did not" value={data.failures} />
            </div>
            {!data.sufficient && data.reason && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                  Every member is currently weighted equally.
                </p>
                <p className="mt-1 text-sm text-black/70 dark:text-white/70">{data.reason}</p>
              </div>
            )}
          </div>

          {data.sufficient && (
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Committee members</h3>
              <div className="space-y-2">
                {[...data.agents]
                  .sort((a, b) => b.weight - a.weight)
                  .map((agent) => {
                    const meta = VERDICT_META[agent.verdict];
                    const Icon = meta.icon;
                    return (
                      <div key={agent.agentKey} className={`rounded-lg border p-3 ${meta.wrap}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Icon className={`h-4 w-4 ${meta.text}`} />
                          <span className="font-medium">{AGENT_NAMES[agent.agentKey] ?? agent.agentKey}</span>
                          <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
                          <span className="ml-auto font-mono text-sm tabular-nums">
                            &times;{agent.weight.toFixed(2)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-black/70 dark:text-white/70">{meta.blurb}</p>
                        {agent.verdict !== 'INSUFFICIENT' && (
                          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                            Across {agent.n} sessions: averaged {agent.successMean.toFixed(2)} on the hires who worked
                            out and {agent.failureMean.toFixed(2)} on the ones who did not, on a scale where hire is +2
                            and no-hire is &minus;2.
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {data.confidence && (
            <div className="card">
              <h3 className="mb-2 text-sm font-semibold text-black/50 dark:text-white/50">Stated confidence</h3>
              <p className="text-sm text-black/70 dark:text-white/70">
                {CONFIDENCE_VERDICT[data.confidence.verdict]}
              </p>
              {data.confidence.bins.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-left text-xs text-black/50 dark:text-white/50">
                        <th className="py-1 pr-4 font-medium">Confidence claimed</th>
                        <th className="py-1 pr-4 font-medium">Sessions</th>
                        <th className="py-1 pr-4 font-medium">Average claim</th>
                        <th className="py-1 font-medium">Actually worked out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.confidence.bins.map((bin) => (
                        <tr key={bin.lowerPercent} className="border-t border-black/5 dark:border-white/5">
                          <td className="py-1.5 pr-4">
                            {bin.lowerPercent}&ndash;{bin.upperPercent}%
                          </td>
                          <td className="py-1.5 pr-4">{bin.n}</td>
                          <td className="py-1.5 pr-4">{bin.statedMean.toFixed(0)}%</td>
                          <td className="py-1.5">{bin.actualSuccessRate.toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Not a disclaimer to skip past — it bounds what every figure above means. */}
          <div className="card">
            <h3 className="mb-2 text-sm font-semibold text-black/50 dark:text-white/50">What this can and cannot tell you</h3>
            <p className="text-sm text-black/70 dark:text-white/70">
              These figures cover candidates who were hired and later reviewed. A candidate the committee turned down
              produces no evidence either way, because nobody found out what they would have done — so this measures who
              saw it coming among the people you hired, not how often the committee is right. Weights are held between
              &times;0.50 and &times;1.50 and are pulled toward &times;1.00 while the sample is small, so no single member
              can carry a vote on a short run of luck.
            </p>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-black/50 dark:text-white/50">{label}</p>
    </div>
  );
}
