import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { COUNCIL_AGENTS } from '../../council-shared/council-agents.config';
import { VALID_STANCES } from '../../council-shared/council-core.service';
import type { CouncilStance } from '@prisma/client';
import { calibrate, labelOutcome, type CalibrationReport, type CalibrationSample } from './outcome-calibration';

/**
 * §9 Learning Engine, read side — the half that was never built.
 *
 * Joins what the committee said (HyrteCouncilAgentReport) against what
 * actually happened (HyrteHiringOutcomeEvent) and turns the overlap into vote
 * weights. All the judgment lives in the pure `outcome-calibration` module;
 * this only fetches, shapes and caches.
 *
 * Global rather than per-organization, which matches the rest of the HYRTE
 * recruiter surface: there is no recruiter/organization assignment model yet
 * (see learning.controller.ts for the same note). It is also the only slice
 * that will clear the evidence gate for a long time — outcomes arrive months
 * after the interview, so splitting them further would mean never learning
 * anything. Nothing candidate-identifying crosses the boundary; the output is
 * aggregate agent statistics.
 */

/** Outcomes change on a human timescale — re-deriving per council run would be waste. */
const CACHE_TTL_MS = 10 * 60_000;

const VOTING_AGENT_KEYS = COUNCIL_AGENTS.filter((a) => a.votes).map((a) => a.key);

@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);
  private cached: { at: number; report: CalibrationReport } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Called when an outcome is recorded — the next council run learns from it. */
  invalidate() {
    this.cached = null;
  }

  async getCalibration(force = false): Promise<CalibrationReport> {
    if (!force && this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.report;

    let report: CalibrationReport;
    try {
      report = calibrate(await this.buildSamples(), VOTING_AGENT_KEYS);
    } catch (e) {
      // A council run must never fail because the learning engine did. Flat
      // weights are exactly the pre-learning behaviour.
      this.logger.warn(`Calibration failed, falling back to unweighted votes: ${e instanceof Error ? e.message : String(e)}`);
      report = {
        totalLabelled: 0,
        successes: 0,
        failures: 0,
        sufficient: false,
        reason: 'The learning engine could not be read just now; every committee member is being weighted equally.',
        agents: [],
        confidence: null,
        weights: Object.fromEntries(VOTING_AGENT_KEYS.map((k) => [k, 1])),
      };
    }

    this.cached = { at: Date.now(), report };
    return report;
  }

  /** What `CouncilCoreService.tallyVotes` should multiply each voter by. */
  async getVoteWeights(): Promise<Record<string, number>> {
    return (await this.getCalibration()).weights;
  }

  private async buildSamples(): Promise<CalibrationSample[]> {
    // Only sessions that have an outcome recorded can teach us anything, so
    // the outcome events are the driving side of the join rather than every
    // session ever run.
    const sessions = await this.prisma.hyrteSession.findMany({
      where: { hiringOutcomeEvents: { some: {} }, councilAgentReports: { some: {} } },
      select: {
        id: true,
        hiringOutcomeEvents: { select: { eventType: true, performanceRating: true, occurredAt: true } },
        councilAgentReports: { select: { agentKey: true, stance: true } },
        interviewReport: { select: { confidencePercent: true } },
      },
    });

    const samples: CalibrationSample[] = [];
    for (const session of sessions) {
      const label = labelOutcome(session.hiringOutcomeEvents);
      if (label === 'UNKNOWN') continue;

      const stances: Record<string, CouncilStance> = {};
      for (const r of session.councilAgentReports) {
        if (r.stance && VALID_STANCES.has(r.stance)) stances[r.agentKey] = r.stance;
      }
      if (Object.keys(stances).length === 0) continue;

      samples.push({
        sessionId: session.id,
        label,
        stances,
        confidencePercent: session.interviewReport?.confidencePercent ?? null,
      });
    }
    return samples;
  }
}
