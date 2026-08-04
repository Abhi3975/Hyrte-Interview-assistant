import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { HyrteSimulationRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { HyrteGateway } from './hyrte.gateway';
import { CreateHyrteSessionDto, SubmitBaselineChallengeDto } from './dto/hyrte.dto';
import { getPmSaasStartupFixture } from './fixtures/pm-saas-startup.fixture';
import { HyrteSimulationGeneratorService, JobSuccessModelGrounding } from './generator/simulation-generator.service';
import { WorldStabilizationError } from './generator/world-stabilization';
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
    private readonly ai: AIService,
  ) {}

  /**
   * Upgrade §2/§4 — session creation returns IMMEDIATELY (phase GENERATING)
   * and the actual pipeline runs in the background via `populateWorld`. This
   * used to await the whole generation pipeline inline; with Steps 2-6 now
   * multiple sequential/parallel LLM round-trips, that occasionally exceeded
   * real infra timeouts (reproduced live: a dev-proxy 30s ceiling). The
   * client polls `GET /hyrte/sessions/:id` until phase flips to
   * MISSION_BRIEF — see HyrtePhaseGate on the frontend.
   */
  async create(dto: CreateHyrteSessionDto, candidateId: string) {
    const session = await this.createPlaceholder(dto, candidateId, {});
    this.populateWorld(session.id, dto, candidateId, {}).catch((e) => this.logger.error(`populateWorld failed for session ${session.id}: ${e instanceof Error ? e.message : String(e)}`));
    return session;
  }

  /**
   * Upgrade §1 — a session launched from a recruiter's SimulationRequest
   * (real JD, decomposed). Grounds generation in the actual Job Success
   * Model (not just the six seed labels — see JobSuccessModelGrounding) and
   * links the resulting JobSuccessModel row to this session, copied from the
   * request's cached decomposition rather than re-calling the LLM. Same
   * immediate-return-then-background-generate pattern as `create`.
   */
  async createFromSimulationRequest(request: HyrteSimulationRequest, candidateId: string) {
    const dto: CreateHyrteSessionDto = {
      role: request.role,
      experienceLevel: request.experienceLevel,
      industry: request.industry,
      companyType: request.companyType,
      difficulty: request.difficulty,
      culture: request.culture,
      sessionType: 'ASSESSMENT',
    };
    const grounding: JobSuccessModelGrounding = {
      coreOutcomes: request.coreOutcomes,
      capabilityRequirements: (request.capabilityRequirements ?? []) as unknown as JobSuccessModelGrounding['capabilityRequirements'],
      industryProbeThemes: ((request.industryContext as { probeThemes?: string[] } | null)?.probeThemes ?? []),
    };
    const session = await this.createPlaceholder(dto, candidateId, { simulationRequestId: request.id });

    // Independent of world generation (built straight from the request's own
    // fields) — created synchronously so it's available immediately, not
    // gated behind the background pipeline.
    await this.prisma.jobSuccessModel.create({
      data: {
        hyrteSessionId: session.id,
        role: request.role,
        coreOutcomes: request.coreOutcomes,
        capabilityRequirements: request.capabilityRequirements as Prisma.InputJsonValue,
        industryContext: request.industryContext as Prisma.InputJsonValue,
        companyContext: request.companyContext as Prisma.InputJsonValue,
        sourceJobDescription: request.jobDescriptionRaw,
        sourceCompanyContext: request.companyContextRaw,
      },
    });

    this.populateWorld(session.id, dto, candidateId, { grounding }).catch((e) => this.logger.error(`populateWorld failed for session ${session.id}: ${e instanceof Error ? e.message : String(e)}`));
    return session;
  }

  private async createPlaceholder(dto: CreateHyrteSessionDto, candidateId: string, options: { simulationRequestId?: string }) {
    return this.prisma.hyrteSession.create({
      data: {
        candidateId,
        sessionType: dto.sessionType ?? 'PRACTICE',
        simulationRequestId: options.simulationRequestId,
        phase: 'GENERATING',
        role: dto.role,
        experienceLevel: dto.experienceLevel,
        industry: dto.industry,
        companyType: dto.companyType,
        difficulty: dto.difficulty,
        culture: dto.culture,
        companyName: 'Generating…',
      },
    });
  }

  private async populateWorld(
    sessionId: string,
    dto: CreateHyrteSessionDto,
    candidateId: string,
    options: { grounding?: JobSuccessModelGrounding },
  ) {
    const world = await this.generator.generate(dto, options.grounding).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Simulation generation failed, using fallback fixture: ${msg}`);
      // §2 — never lose the Stabilization Gate's failure report just because
      // we're falling back; it's persisted below once the session exists.
      const failureArtifact = e instanceof WorldStabilizationError ? [{ step: 'stabilization_gate' as const, status: 'FAILED_FELL_BACK' as const, payload: e.report }] : [];
      return { fixture: getPmSaasStartupFixture(), artifacts: failureArtifact };
    });
    const fixture = world.fixture;

    // UX flow §8: candidate sees the Mission Brief (step 1) and Baseline
    // Skill Challenge (step 2) before the workspace unlocks — the phase only
    // advances to WORKSPACE_ACTIVE once submitBaselineChallenge runs. This
    // update is what actually flips GENERATING → MISSION_BRIEF for the
    // client's poll to pick up.
    const session = await this.prisma.hyrteSession.update({
      where: { id: sessionId },
      data: {
        phase: 'MISSION_BRIEF',
        companyName: fixture.companyName,
        missionBrief: fixture.missionBrief as unknown as Prisma.InputJsonValue,
        baselineChallenge: fixture.baselineChallenge as unknown as Prisma.InputJsonValue,
      },
    });

    // Upgrade §2/§6 — one row per pipeline step, so a failing step is
    // debuggable after the fact (which step fell back, and to what).
    if (world.artifacts.length > 0) {
      await this.prisma.hyrteWorldGenerationArtifact.createMany({
        data: world.artifacts.map((a) => ({
          sessionId: session.id,
          step: a.step,
          status: a.status,
          payload: a.payload as Prisma.InputJsonValue,
        })),
      });
    }

    await this.prisma.hyrteCompanyState.create({
      data: { sessionId: session.id, ...fixture.companyState, departments: fixture.departments as unknown as Prisma.InputJsonValue },
    });

    const stakeholders = await Promise.all(
      fixture.stakeholders.map((s) =>
        this.prisma.hyrteStakeholder.create({
          data: {
            sessionId: session.id,
            name: s.name,
            role: s.role,
            avatarSeed: s.avatarSeed,
            department: s.department,
            experienceLevel: s.experienceLevel,
            authorityLevel: s.authorityLevel ?? 50,
            kpis: s.kpis ?? [],
            currentTasks: s.currentTasks ?? [],
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
        agenda: c.agenda,
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
    // (Step 5 output — IMMEDIATE events, materialized straight in; no queue
    // row needed, they're not "upcoming".)
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

    // Fallback-fixture-only path: the static PM/SaaS fixture still expresses
    // delayed content via `arrivesLater` directly on inbox/slack rather than
    // a scheduledEvents array (see hyrte-fixture.types.ts) — kept as a bare
    // setTimeout, not queue-tracked, since it's a rare last-resort path, not
    // the primary generation flow this upgrade targets.
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

    // Upgrade §6 — Event Queue. Step 6's output, persisted as real
    // HyrteWorldEvent(kind=SCHEDULED) rows instead of a bare setTimeout with
    // no trace, so "what's coming" is queryable, not just eventually visible.
    for (const e of fixture.scheduledEvents) {
      const fromStakeholderId = keyToId.get(e.fromKey);
      const event = await this.prisma.hyrteWorldEvent.create({
        data: {
          sessionId: session.id,
          kind: 'SCHEDULED',
          surface: e.surface,
          fireAtOffsetSeconds: e.fireAtOffsetSeconds,
          payload: { fromStakeholderId, subject: e.subject, channel: e.channel, body: e.body, urgent: e.urgent ?? false, ethicalDilemma: e.ethicalDilemma ?? false } as unknown as Prisma.InputJsonValue,
        },
      });
      setTimeout(() => this.fireScheduledEvent(session.id, event.id).catch((err) => this.logger.warn(err)), e.fireAtOffsetSeconds * 1000);
    }

    return this.getById(session.id, candidateId);
  }

  /** Fires a SCHEDULED HyrteWorldEvent: materializes it into a real inbox/Slack row and marks the queue entry FIRED. */
  private async fireScheduledEvent(sessionId: string, eventId: string): Promise<void> {
    const event = await this.prisma.hyrteWorldEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PENDING') return;
    const payload = event.payload as { fromStakeholderId?: string; subject?: string; channel?: string; body: string; urgent: boolean; ethicalDilemma: boolean };

    if (event.surface === 'inbox') {
      const created = await this.prisma.hyrteInboxMessage.create({
        data: {
          sessionId,
          fromStakeholderId: payload.fromStakeholderId,
          subject: payload.subject || '(no subject)',
          body: payload.body,
          urgent: payload.urgent,
          ethicalDilemma: payload.ethicalDilemma,
        },
      });
      this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
      if (payload.urgent) this.consequences.scheduleIgnoredCheck(sessionId, created.id, randomIgnoredWindow());
    } else {
      const created = await this.prisma.hyrteSlackMessage.create({
        data: { sessionId, channel: payload.channel || '#product', fromStakeholderId: payload.fromStakeholderId, body: payload.body, ethicalDilemma: payload.ethicalDilemma },
      });
      this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });
    }

    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } });
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

  /** Upgrade §5/Step 14 — real state evolution over time, not just the current snapshot. */
  async getCompanyStateHistory(id: string, candidateId: string) {
    await this.getById(id, candidateId);
    return this.prisma.hyrteCompanyStateHistory.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
  }

  /** Upgrade §6 — the Event Queue, made queryable ("what's coming / what already fired") rather than a black box. */
  async getWorldEvents(id: string, candidateId: string) {
    await this.getById(id, candidateId);
    return this.prisma.hyrteWorldEvent.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
  }

  /** Upgrade §2/§6 — per-step generation artifacts, for debugging which pipeline step (if any) fell back. */
  async getWorldGenerationArtifacts(id: string, candidateId: string) {
    await this.getById(id, candidateId);
    return this.prisma.hyrteWorldGenerationArtifact.findMany({ where: { sessionId: id }, orderBy: { createdAt: 'asc' } });
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
    const challenge = session.baselineChallenge as unknown as {
      scenario: string;
      options: { id: string; label: string }[];
      roleKnowledgeQuestion: string;
      toolsQuestion: string;
    } | null;
    const chosen = challenge?.options.find((o) => o.id === dto.optionId);
    if (!chosen) throw new BadRequestException('Invalid option for this challenge');

    // Upgrade §4/Step 9 — Role Calibration is "not MCQ-only": the two
    // free-text questions get a real score, unlike the decision-framework
    // scenario above (deliberately unscored — no single correct option).
    const { roleKnowledgeScore, toolsScore, notes } = await this.scoreCalibrationAnswers(
      session.role,
      challenge?.roleKnowledgeQuestion ?? '',
      dto.roleKnowledgeAnswer,
      challenge?.toolsQuestion ?? '',
      dto.toolsAnswer,
    );
    const calibrationScore = Math.round((roleKnowledgeScore + toolsScore) / 2);

    const baselineResponse = {
      optionId: dto.optionId,
      optionLabel: chosen.label,
      reasoning: dto.reasoning,
      roleKnowledgeAnswer: dto.roleKnowledgeAnswer,
      roleKnowledgeScore,
      toolsAnswer: dto.toolsAnswer,
      toolsScore,
      calibrationScore,
    };

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
        rawText:
          `Baseline challenge — chose "${chosen.label}". Reasoning: ${dto.reasoning} | Role calibration: ` +
          `${calibrationScore}/100 (role knowledge ${roleKnowledgeScore}, tools ${toolsScore}) — ${notes}`,
        behaviorContext: 'AMBIGUITY', // the decision-framework scenario has no single correct option, by design (§8 step 2)
      }),
    ]);

    // Chaos Engine (§4.5) — one wave, timed from when the workspace actually
    // unlocks (not from session creation, when the candidate is still on the
    // Mission Brief/Baseline screens and hasn't started working yet), scaled
    // by the calibration score (§4/Step 9's "adjust event difficulty weights").
    this.consequences.scheduleChaosWave(id, calibrationScore);

    return updated;
  }

  private async scoreCalibrationAnswers(
    role: string,
    roleKnowledgeQuestion: string,
    roleKnowledgeAnswer: string,
    toolsQuestion: string,
    toolsAnswer: string,
  ): Promise<{ roleKnowledgeScore: number; toolsScore: number; notes: string }> {
    try {
      const result = await this.ai.completeJson<{ roleKnowledgeScore?: number; toolsScore?: number; notes?: string }>(
        [
          {
            role: 'system',
            content:
              'You are scoring a quick Role Calibration check before a candidate enters a workplace simulation. ' +
              'Score each answer 0-100 on whether it shows real, correct understanding — brief but substantive ' +
              'answers can score well; empty/nonsensical answers score near 0. Return ONLY JSON: ' +
              '{"roleKnowledgeScore": int, "toolsScore": int, "notes": string (one short sentence)}.',
          },
          {
            role: 'user',
            content:
              `Role: ${role}.\nQ1 (role knowledge): ${roleKnowledgeQuestion}\nA1: ${roleKnowledgeAnswer}\n\n` +
              `Q2 (tools/industry basics): ${toolsQuestion}\nA2: ${toolsAnswer}`,
          },
        ],
        { temperature: 0.3, maxTokens: 200 },
      );
      const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 50)));
      return { roleKnowledgeScore: clamp(result.roleKnowledgeScore), toolsScore: clamp(result.toolsScore), notes: result.notes ?? '' };
    } catch (e) {
      this.logger.warn(`scoreCalibrationAnswers failed, defaulting to neutral scores: ${e instanceof Error ? e.message : String(e)}`);
      return { roleKnowledgeScore: 50, toolsScore: 50, notes: 'Scoring unavailable — defaulted to neutral.' };
    }
  }
}
