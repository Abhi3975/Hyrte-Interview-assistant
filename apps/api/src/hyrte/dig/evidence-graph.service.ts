import { Injectable, NotFoundException } from '@nestjs/common';
import type { BehaviorContext, EvidenceLinkKind, EvidenceSource, EvidenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateEvidenceInput {
  hyrteSessionId?: string;
  candidateId: string;
  source: EvidenceSource;
  type: EvidenceType;
  rawText: string;
  needsInvestigation?: boolean;
  probeCandidates?: string[];
  /** §4.18 Contextual Behavior — see BehaviorContext's schema doc comment. Omit if no context fits. */
  behaviorContext?: BehaviorContext;
  metadata?: Record<string, unknown>;
}

const SUPPORT_STEP = 10;
const CONTRADICT_STEP = 20;
const BASELINE_CONFIDENCE = 50;

/**
 * Candidate Evidence Graph (build prompt §3.1) — the shared structure both the
 * simulation and the interviewer read/write, per Section 0's framing ("if the
 * simulation observes a behavior, the interviewer must be able to ask about
 * it, and if the interviewer catches a claim, the report must be able to
 * check it against simulation behavior"). Phase 1 builds the graph itself;
 * no subsystem is wired to write into it yet (Phase 2-4 concern) except
 * through this service's own API, which later phases call directly.
 *
 * Evidence Confidence Score (§3.1 NEW) is a computed field, never hand-set.
 * The current formula is a deterministic placeholder — SUPPORTS/CONTRADICTS
 * link counts nudge it up/down from a 50 baseline — because there's no LLM
 * call in this phase to weigh quantitative evidence, reasoning quality, or
 * consistency the way the doc describes. Swapping in an LLM-scored version
 * later doesn't change this method's signature, so nothing downstream (the
 * interviewer's evidence-aware questioning, the Decision Council reading
 * `confidenceScore`) needs to change when that happens.
 */
@Injectable()
export class EvidenceGraphService {
  constructor(private readonly prisma: PrismaService) {}

  async createEvidence(input: CreateEvidenceInput) {
    return this.prisma.evidenceObject.create({
      data: {
        hyrteSessionId: input.hyrteSessionId,
        candidateId: input.candidateId,
        source: input.source,
        type: input.type,
        rawText: input.rawText,
        needsInvestigation: input.needsInvestigation ?? false,
        probeCandidates: input.probeCandidates ?? [],
        behaviorContext: input.behaviorContext,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Links two evidence objects and recomputes both sides' confidence.
   * A CONTRADICTS link is how the doc's "contradiction" evidence type is
   * modeled — as a typed edge, not a third free-floating object — so either
   * claim can be queried to find what it conflicts with.
   */
  async linkEvidence(fromId: string, toId: string, kind: EvidenceLinkKind, note?: string) {
    const link = await this.prisma.evidenceLink.create({ data: { fromId, toId, kind, note } });
    await Promise.all([this.recomputeConfidence(fromId), this.recomputeConfidence(toId)]);
    return link;
  }

  /** Recomputes and persists `confidenceScore` (and `status`) for one evidence object. */
  async recomputeConfidence(evidenceId: string) {
    const evidence = await this.prisma.evidenceObject.findUnique({
      where: { id: evidenceId },
      include: { linksFrom: true, linksTo: true },
    });
    if (!evidence) throw new NotFoundException('Evidence object not found');

    const links = [...evidence.linksFrom, ...evidence.linksTo];
    const supports = links.filter((l) => l.kind === 'SUPPORTS').length;
    const contradicts = links.filter((l) => l.kind === 'CONTRADICTS').length;

    const score = Math.max(
      0,
      Math.min(100, BASELINE_CONFIDENCE + supports * SUPPORT_STEP - contradicts * CONTRADICT_STEP),
    );
    const status = contradicts > 0 ? 'CONTRADICTED' : evidence.status === 'PENDING' && supports > 0 ? 'INVESTIGATED' : evidence.status;

    return this.prisma.evidenceObject.update({
      where: { id: evidenceId },
      data: { confidenceScore: score, status },
    });
  }

  async markVerified(evidenceId: string) {
    return this.prisma.evidenceObject.update({ where: { id: evidenceId }, data: { status: 'VERIFIED' } });
  }

  async getForSession(hyrteSessionId: string) {
    return this.prisma.evidenceObject.findMany({
      where: { hyrteSessionId },
      include: { linksFrom: { include: { to: true } }, linksTo: { include: { from: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getForCandidate(candidateId: string) {
    return this.prisma.evidenceObject.findMany({ where: { candidateId }, orderBy: { createdAt: 'asc' } });
  }

  /** Open investigation targets — what the interviewer (Phase 4) should probe. */
  async getOpenAreas(hyrteSessionId: string) {
    return this.prisma.evidenceObject.findMany({
      where: { hyrteSessionId, needsInvestigation: true, status: { in: ['PENDING', 'CONTRADICTED'] } },
      orderBy: { confidenceScore: 'asc' },
    });
  }

  async getContradictions(hyrteSessionId: string) {
    return this.prisma.evidenceLink.findMany({
      where: { kind: 'CONTRADICTS', OR: [{ from: { hyrteSessionId } }, { to: { hyrteSessionId } }] },
      include: { from: true, to: true },
    });
  }

  /** §4.18 — evidence grouped by context, so consumers never have to average across contexts themselves. */
  async getByContext(hyrteSessionId: string) {
    const evidence = await this.prisma.evidenceObject.findMany({
      where: { hyrteSessionId },
      orderBy: { createdAt: 'asc' },
    });
    const grouped: Record<string, typeof evidence> = {};
    for (const e of evidence) {
      const key = e.behaviorContext ?? 'UNCLASSIFIED';
      (grouped[key] ??= []).push(e);
    }
    return grouped;
  }
}
