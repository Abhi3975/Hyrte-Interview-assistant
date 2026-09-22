import type { ProctorEvent } from '@prisma/client';
import type { RiskResult } from '../proctoring/risk-engine.service';

/**
 * The multi-modal bridge: what the camera and screen actually observed,
 * reaching the evaluation that scores the candidate on it.
 *
 * This closes a real honesty bug rather than adding a feature. The 84-parameter
 * framework has always asked the model to score `proctoring_risk`,
 * `coaching_suspicion` and `ai_assist_signal` — and `evaluateSession` fetched
 * the interview and the answers and nothing else. No proctor event has ever
 * reached the evaluator. So a number presented to a recruiter as a proctoring
 * measurement was produced by a language model that had never seen a single
 * proctoring observation, from a transcript.
 *
 * Two fixes, and the second matters more than the first:
 *
 *  1. The observations now reach the prompt, so the model's judgment on
 *     coaching and AI-assist — which legitimately combines what was seen with
 *     how the candidate answered — is grounded in evidence.
 *
 *  2. `proctoring_risk` is no longer asked for at all. It is already computed
 *     deterministically, time-decayed and explainable, by RiskEngine, which
 *     the evaluation simply never consulted. A measurement should come from
 *     the thing that measured it.
 *
 * And where nothing was proctored — practice mode, no camera, a candidate who
 * declined — the metric is marked unmeasured instead of scored. A confident
 * risk number for a session nobody watched is the worst of the three
 * possibilities.
 */

/** Keys whose value is an observation, not a judgment — these come from the risk engine. */
export const PROCTORING_MEASURED_KEYS = ['proctoring_risk'] as const;

/**
 * Keys the model still scores, but which should never be scored blind — they
 * combine what was observed with how the candidate actually answered.
 */
export const PROCTORING_INFORMED_KEYS = ['coaching_suspicion', 'ai_assist_signal'] as const;

export interface ProctoringContext {
  /** Prompt block describing what was observed. Never empty — says so when nothing was. */
  observationBlock: string;
  /** True when proctoring actually ran for this session. */
  measured: boolean;
  /** The risk engine's score, already on the framework's 100-is-best scale. */
  proctoringScore: number;
  /** What to write in the parameter's interpretation, stated as evidence. */
  interpretation: string;
}

/** How many distinct signals to name before summarising the rest. */
const MAX_NAMED_SIGNALS = 6;

const humanise = (type: string) => type.toLowerCase().replace(/_/g, ' ');

/**
 * Turn real proctor events into something an evaluator can reason about, and
 * into the score that replaces the invented one.
 */
export function buildProctoringContext(events: ProctorEvent[], risk: RiskResult | null): ProctoringContext {
  if (events.length === 0 || !risk) {
    return {
      measured: false,
      // 100 is "least risky" on this framework's scale. Nothing was observed,
      // so nothing counts against the candidate — an unmeasured risk must not
      // become a penalty, and `measured: false` keeps it from reading as a
      // finding.
      proctoringScore: 100,
      interpretation:
        'Not measured — no proctoring ran for this session, so there is no observational basis for a risk score.',
      observationBlock:
        'PROCTORING: none ran for this session. You have NO observational evidence about the candidate\'s ' +
        'environment, screen, or who else was present. Do not infer any. Score coaching_suspicion and ' +
        'ai_assist_signal from the transcript alone, and only where the language itself gives you a reason.',
    };
  }

  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const named = ranked.slice(0, MAX_NAMED_SIGNALS).map(([type, n]) => `${humanise(type)} ×${n}`);
  const remaining = ranked.length - named.length;

  // The framework's scale is 100 = best. The risk engine's is 100 = worst.
  const proctoringScore = Math.max(0, Math.min(100, 100 - Math.round(risk.riskScore)));

  const confidenceNote =
    risk.confidenceScore < 0.4
      ? ' Evidence is thin, so treat this as weak rather than conclusive.'
      : risk.confidenceScore > 0.75
        ? ' There is substantial evidence behind this.'
        : '';

  return {
    measured: true,
    proctoringScore,
    interpretation:
      `Computed from ${events.length} proctoring observation${events.length === 1 ? '' : 's'} by the risk engine ` +
      `(risk ${Math.round(risk.riskScore)}/100${risk.topSignals.length ? `, chiefly ${risk.topSignals.slice(0, 3).join(', ')}` : ''}).` +
      confidenceNote,
    observationBlock:
      `PROCTORING OBSERVATIONS (${events.length} event${events.length === 1 ? '' : 's'} actually recorded during this ` +
      `session — these are observed facts, not inferences): ${named.join(', ')}` +
      (remaining > 0 ? `, and ${remaining} other signal type${remaining === 1 ? '' : 's'}` : '') +
      `.\nComputed risk: ${Math.round(risk.riskScore)}/100` +
      (Object.keys(risk.breakdown).length
        ? ` across ${Object.entries(risk.breakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([category]) => category)
            .join(', ')}`
        : '') +
      `.\nUse these when scoring coaching_suspicion and ai_assist_signal — but do NOT restate the risk score as ` +
      `your own finding, and do not treat a low-weight environmental signal (a brief face-detection drop, poor ` +
      `lighting) as evidence of dishonesty. Where the observations and the transcript disagree, say so.`,
  };
}
