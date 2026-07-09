import { Injectable } from '@nestjs/common';
import { ProctorEvent, ProctorEventType } from '@prisma/client';
import { weightFor, RiskWeight } from './risk-weights';

export interface RiskResult {
  riskScore: number;          // 0-100
  cheatingProbability: number; // 0-1
  confidenceScore: number;     // 0-1 — how much evidence backs the score
  breakdown: Record<string, number>; // per-category contribution
  topSignals: string[];
}

/**
 * Pure risk computation.
 *
 * Given the recent proctoring events for a session, produce a single
 * time-decayed, weighted risk score plus an explainable breakdown. Kept free
 * of I/O so it is trivially unit-testable and deterministic.
 *
 * Key properties:
 *  - Time decay: each event's contribution halves every `decayHalfLifeSec`,
 *    so old transient blips fade instead of accumulating forever.
 *  - Occurrence gating: signals below their `minOccurrences` within the window
 *    are treated as noise and contribute nothing — this is what prevents a
 *    single poor-lighting frame from ever mattering.
 *  - Diminishing returns: repeated low-weight signals saturate so a candidate
 *    isn't buried by dozens of tiny events.
 */
@Injectable()
export class RiskEngine {
  compute(events: ProctorEvent[], now: Date = new Date()): RiskResult {
    // Group by type to apply occurrence gating and saturation.
    const byType = new Map<ProctorEventType, ProctorEvent[]>();
    for (const e of events) {
      const list = byType.get(e.type) ?? [];
      list.push(e);
      byType.set(e.type, list);
    }

    const breakdown: Record<string, number> = {};
    const signalScores: { type: string; score: number }[] = [];
    let evidenceMass = 0;

    for (const [type, list] of byType) {
      const w = weightFor(type);
      if (list.length < w.minOccurrences) continue; // gated as noise

      const contribution = this.contributionFor(list, w, now);
      if (contribution <= 0) continue;

      breakdown[w.category] = (breakdown[w.category] ?? 0) + contribution;
      signalScores.push({ type, score: contribution });
      evidenceMass += list.length;
    }

    // Combine category contributions with soft saturation toward 100.
    const rawTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
    const riskScore = Math.round(100 * (1 - Math.exp(-rawTotal / 100)));

    // Cheating probability: logistic on the risk score, centered at ~60.
    const cheatingProbability = round2(1 / (1 + Math.exp(-(riskScore - 60) / 12)));

    // Confidence grows with the amount of corroborating evidence.
    const confidenceScore = round2(1 - Math.exp(-evidenceMass / 8));

    const topSignals = signalScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((s) => s.type);

    return {
      riskScore: Math.min(100, riskScore),
      cheatingProbability,
      confidenceScore,
      breakdown: roundMap(breakdown),
      topSignals,
    };
  }

  /**
   * Sum the time-decayed weights for one signal type, with diminishing
   * returns so N repeats don't scale linearly.
   */
  private contributionFor(events: ProctorEvent[], w: RiskWeight, now: Date): number {
    let sum = 0;
    for (const e of events) {
      const ageSec = Math.max(0, (now.getTime() - e.occurredAt.getTime()) / 1000);
      const decay = Math.pow(0.5, ageSec / w.decayHalfLifeSec);
      // Severity multiplier lets the client/vision service nudge weight up.
      const sev = SEVERITY_MULT[e.severity] ?? 1;
      sum += w.weight * decay * sev;
    }
    // Diminishing returns: sqrt-like saturation per signal type.
    return w.weight * Math.log1p(sum / w.weight);
  }
}

const SEVERITY_MULT: Record<string, number> = {
  INFO: 0.25,
  LOW: 0.6,
  MEDIUM: 1,
  HIGH: 1.5,
  CRITICAL: 2,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function roundMap(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) out[k] = Math.round(v * 10) / 10;
  return out;
}
