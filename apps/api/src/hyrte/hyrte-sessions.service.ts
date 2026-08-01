import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HyrteGateway } from './hyrte.gateway';
import { CreateHyrteSessionDto, SubmitBaselineChallengeDto } from './dto/hyrte.dto';
import { getPmSaasStartupFixture } from './fixtures/pm-saas-startup.fixture';
import { HyrteSimulationGeneratorService } from './generator/simulation-generator.service';
import { HyrteConsequenceService, randomIgnoredWindow } from './consequences/consequence.service';
import { DecisionGraphService } from './dig/decision-graph.service';
import { EvidenceGraphService } from './dig/evidence-graph.service';

// Random spread for messages marked `arrivesLater` by the generator/fixture —
// "messages start arriving on their own" (doc §8 step 4).
const MIN_ARRIVAL_DELAY_MS = 12_000;
const MAX_ARRIVAL_DELAY_MS = 35_000;
const randomArrivalDelay = () =>
  MIN_ARRIVAL_DELAY_MS + Math.floor(Math.random() * (MAX_ARRIVAL_DELAY_MS - MIN_ARRIVAL_DELAY_MS));

@Injectable()
export class HyrteSessionsService {
  private readonly logger = new Logger(HyrteSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: HyrteGateway,
    private readonly generator: HyrteSimulationGeneratorService,
    private readonly consequences: HyrteConsequenceService,
    private readonly decisionGraph: DecisionGraphService,
    private readonly evidence: EvidenceGraphService,
  ) {}

  async create(dto: CreateHyrteSessionDto, candidateId: string) {
    const fixture = await this.generator.generate(dto).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Simulation generation failed, using fallback fixture: ${msg}`);
      return getPmSaasStartupFixture();
    });

    const session = await this.prisma.hyrteSession.create({
      data: {
        candidateId,
        sessionType: dto.sessionType ?? 'PRACTICE',
        // UX flow §8: candidate sees the Mission Brief (step 1) and Baseline
        // Skill Challenge (step 2) before the workspace unlocks — the phase
        // only advances to WORKSPACE_ACTIVE once submitBaselineChallenge runs.
        phase: 'MISSION_BRIEF',
        role: dto.role,
        experienceLevel: dto.experienceLevel,
        industry: dto.industry,
        companyType: dto.companyType,
        difficulty: dto.difficulty,
        culture: dto.culture,
        companyName: fixture.companyName,
        missionBrief: fixture.missionBrief as unknown as Prisma.InputJsonValue,
        baselineChallenge: fixture.baselineChallenge as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.hyrteCompanyState.create({
      data: { sessionId: session.id, ...fixture.companyState },
    });

    const stakeholders = await Promise.all(
      fixture.stakeholders.map((s) =>
        this.prisma.hyrteStakeholder.create({
          data: {
            sessionId: session.id,
            name: s.name,
            role: s.role,
            avatarSeed: s.avatarSeed,
            personality: s.personality as Prisma.InputJsonValue,
            hiddenIntention: s.hiddenIntention,
            ...(s.stress !== undefined && { stress: s.stress }),
            ...(s.urgency !== undefined && { urgency: s.urgency }),
            ...(s.patience !== undefined && { patience: s.patience }),
            ...(s.motivation !== undefined && { motivation: s.motivation }),
          },
        }),
      ),
    );
    const keyToId = new Map(fixture.stakeholders.map((s, i) => [s.key, stakeholders[i].id]));

    await this.prisma.hyrteTask.createMany({
      data: fixture.tasks.map((t) => ({
        sessionId: session.id,
        title: t.title,
        priority: t.priority,
        dueAt: t.dueInHours ? new Date(Date.now() + t.dueInHours * 3_600_000) : null,
      })),
    });

    await this.prisma.hyrteCalendarEvent.createMany({
      data: fixture.calendarEvents.map((c) => ({
        sessionId: session.id,
        title: c.title,
        startAt: new Date(Date.now() + c.startInHours * 3_600_000),
        endAt: new Date(Date.now() + c.startInHours * 3_600_000 + c.durationMins * 60_000),
      })),
    });

    await this.prisma.hyrteKnowledgeDoc.createMany({
      data: fixture.knowledgeDocs.map((k) => ({
        sessionId: session.id,
        title: k.title,
        body: k.body,
        category: k.category,
      })),
    });

    // Immediate inbox/Slack seed — present the moment the workspace loads.
    for (const m of fixture.inbox.filter((m) => !m.arrivesLater)) {
      const created = await this.prisma.hyrteInboxMessage.create({
        data: {
          sessionId: session.id,
          fromStakeholderId: keyToId.get(m.fromKey),
          subject: m.subject,
          body: m.body,
          urgent: m.urgent,
          ethicalDilemma: m.ethicalDilemma ?? false,
        },
      });
      // Ignoring an urgent item has a consequence (doc §6) — start the clock now.
      if (m.urgent) this.consequences.scheduleIgnoredCheck(session.id, created.id, randomIgnoredWindow());
    }
    for (const m of fixture.slack.filter((m) => !m.arrivesLater)) {
      await this.prisma.hyrteSlackMessage.create({
        data: {
          sessionId: session.id,
          channel: m.channel,
          fromStakeholderId: keyToId.get(m.fromKey),
          body: m.body,
          ethicalDilemma: m.ethicalDilemma ?? false,
        },
      });
    }

    // Delayed seed — "messages start arriving on their own" (doc §8 step 4).
    for (const m of fixture.inbox.filter((m) => m.arrivesLater)) {
      setTimeout(() => {
        this.prisma.hyrteInboxMessage
          .create({
            data: {
              sessionId: session.id,
              fromStakeholderId: keyToId.get(m.fromKey),
              subject: m.subject,
              body: m.body,
              urgent: m.urgent,
              ethicalDilemma: m.ethicalDilemma ?? false,
            },
          })
          .then((created) => {
            this.gateway.broadcast(session.id, { type: 'inbox:new', message: created });
            if (m.urgent) this.consequences.scheduleIgnoredCheck(session.id, created.id, randomIgnoredWindow());
          })
          .catch((e) => this.logger.warn(e));
      }, randomArrivalDelay());
    }
    for (const m of fixture.slack.filter((m) => m.arrivesLater)) {
      setTimeout(() => {
        this.prisma.hyrteSlackMessage
          .create({
            data: {
              sessionId: session.id,
              channel: m.channel,
              fromStakeholderId: keyToId.get(m.fromKey),
              body: m.body,
              ethicalDilemma: m.ethicalDilemma ?? false,
            },
          })
          .then((created) => this.gateway.broadcast(session.id, { type: 'slack:new', message: created }))
          .catch((e) => this.logger.warn(e));
      }, randomArrivalDelay());
    }

    return this.getById(session.id, candidateId);
  }

  async getById(id: string, candidateId: string) {
    const session = await this.prisma.hyrteSession.findFirst({
      where: { id, candidateId },
      include: { companyState: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getCompanyState(id: string, candidateId: string) {
    await this.getById(id, candidateId); // ownership check
    const state = await this.prisma.hyrteCompanyState.findUnique({ where: { sessionId: id } });
    if (!state) throw new NotFoundException('Company state not found');
    return state;
  }

  /** UX flow §8 step 1 → 2: candidate has read the brief, move on to the challenge. */
  async advancePastMissionBrief(id: string, candidateId: string) {
    const session = await this.getById(id, candidateId);
    if (session.phase !== 'MISSION_BRIEF') return session; // idempotent — already past this screen
    return this.prisma.hyrteSession.update({ where: { id }, data: { phase: 'BASELINE_SKILL_CHECK' } });
  }

  /**
   * UX flow §8 step 2 → 3: records the candidate's choice + reasoning as both
   * a Decision Graph node (DIG write-path contract) and an Evidence Graph
   * object (simulation_decision — §3.1), then unlocks the workspace. This is
   * the earliest point in a session anything gets written to either graph.
   */
  async submitBaselineChallenge(id: string, candidateId: string, dto: SubmitBaselineChallengeDto) {
    const session = await this.getById(id, candidateId);
    if (session.phase !== 'BASELINE_SKILL_CHECK') {
      throw new BadRequestException('Baseline challenge already completed or not reached yet');
    }
    const challenge = session.baselineChallenge as unknown as { scenario: string; options: { id: string; label: string }[] } | null;
    const chosen = challenge?.options.find((o) => o.id === dto.optionId);
    if (!chosen) throw new BadRequestException('Invalid option for this challenge');

    const baselineResponse = { optionId: dto.optionId, optionLabel: chosen.label, reasoning: dto.reasoning };

    const [updated] = await Promise.all([
      this.prisma.hyrteSession.update({
        where: { id },
        data: { phase: 'WORKSPACE_ACTIVE', baselineResponse: baselineResponse as unknown as Prisma.InputJsonValue },
      }),
      this.decisionGraph.recordDecision({
        sessionId: id,
        actor: candidateId,
        actionType: 'baseline_challenge.submit',
        payload: baselineResponse,
        reasoning: dto.reasoning,
        alternativesConsidered: challenge?.options.filter((o) => o.id !== dto.optionId).map((o) => o.label) ?? [],
      }),
      this.evidence.createEvidence({
        hyrteSessionId: id,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_DECISION',
        rawText: `Baseline challenge — chose "${chosen.label}". Reasoning: ${dto.reasoning}`,
        behaviorContext: 'AMBIGUITY', // no single correct option, by design (§8 step 2)
      }),
    ]);

    // Chaos Engine (§4.5) — one wave, timed from when the workspace actually
    // unlocks (not from session creation, when the candidate is still on the
    // Mission Brief/Baseline screens and hasn't started working yet).
    this.consequences.scheduleChaosWave(id);

    return updated;
  }
}
