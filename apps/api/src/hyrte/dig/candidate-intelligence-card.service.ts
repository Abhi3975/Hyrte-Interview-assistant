import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

function bucket(count: number): 'low' | 'medium' | 'high' {
  if (count >= 6) return 'high';
  if (count >= 2) return 'medium';
  return 'low';
}

/**
 * §3.2 — denormalized read-model over the Evidence Graph. Rebuilt wholesale
 * on demand (`refresh`), never hand-edited. Every field ships as a
 * confidence-labeled bucket ("low"/"medium"/"high"), not a raw score, per
 * the doc's explicit instruction — this card is a quick-display summary, not
 * a scoring surface.
 *
 * HYRTE has no resume/LinkedIn ingestion pipeline (see plan for a future
 * System 5) — `experiencePattern` and `careerPattern` stay null until that
 * exists; this phase only computes what's derivable from the Evidence Graph
 * and the candidate's own HYRTE session history.
 */
@Injectable()
export class CandidateIntelligenceCardService {
  constructor(private readonly prisma: PrismaService) {}

  async refresh(candidateId: string) {
    const [evidence, sessions] = await Promise.all([
      this.prisma.evidenceObject.findMany({ where: { candidateId } }),
      this.prisma.hyrteSession.findMany({ where: { candidateId }, select: { role: true, industry: true } }),
    ]);

    const primaryExposureAreas = Array.from(new Set(sessions.map((s) => `${s.role} (${s.industry})`)));
    const leadershipSignals = evidence.filter(
      (e) => e.type === 'BEHAVIORAL_SIGNAL' && /lead|manage|mentor/i.test(e.rawText),
    ).length;
    const technicalSignals = evidence.filter((e) => e.type === 'SKILL_DEMONSTRATION').length;

    return this.prisma.candidateIntelligenceCard.upsert({
      where: { candidateId },
      create: {
        candidateId,
        primaryExposureAreas,
        evidenceDensity: evidence.length,
        leadershipExposure: bucket(leadershipSignals),
        technicalDepthConfidence: bucket(technicalSignals),
      },
      update: {
        primaryExposureAreas,
        evidenceDensity: evidence.length,
        leadershipExposure: bucket(leadershipSignals),
        technicalDepthConfidence: bucket(technicalSignals),
      },
    });
  }

  async get(candidateId: string) {
    return this.prisma.candidateIntelligenceCard.findUnique({ where: { candidateId } });
  }
}
