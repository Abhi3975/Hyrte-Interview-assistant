import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { HyrteSimulationRequest, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { HyrteGateway } from './hyrte.gateway';
import { CreateHyrteSessionDto, SubmitBaselineChallengeDto } from './dto/hyrte.dto';
import { getPmSaasStartupFixture } from './fixtures/pm-saas-startup.fixture';
import {
  EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY,
  GeneratedWorld,
  HyrteSimulationGeneratorService,
  JobSuccessModelGrounding,
  WARMUP_COUNT_BY_DIFFICULTY,
  WorldVariety,
} from './generator/simulation-generator.service';
import { enforceWarmupVariety, pickAxes } from './generator/question-variety';
import { resolveSignatureArtifact } from './generator/signature-artifacts';
import { findMentionedKnowledgeDoc, resolveRelevantRoles } from './generator/knowledge-linking';
import { WorldStabilizationError } from './generator/world-stabilization';
import { HyrteConsequenceService, randomIgnoredWindow } from './consequences/consequence.service';
import { DecisionGraphService } from './dig/decision-graph.service';
import { EvidenceGraphService } from './dig/evidence-graph.service';
import { HyrteWorkTickService } from './work/work-tick.service';
import { HyrteHeroTaskService } from './work/hero-task.service';
import { ORIENTATION_UNTIL_FRACTION, elapsedFraction, orientationEndMs, phaseDescriptorAt, plannedDurationMs, rampedDelayMs, scheduledEventDelayMs } from './pacing/session-pacing';

/** Part F8 What-Changed — camelCase KPI key → readable label. */
function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

/** Part F8 What-Changed — maps HyrteConsequenceService's applyCompanyStateDelta `reason` strings to readable causes. */
const REASON_LABEL: Record<string, string> = {
  task_completion: 'a work item was completed',
  chaos_wave: 'a wave of simultaneous demands hit',
  stakeholder_reply: 'a conversation with a colleague',
  stakeholder_independent_reaction: 'a colleague reacting to something they observed',
  escalation_hop_1: 'an ignored message escalating (1st follow-up)',
  escalation_hop_2: 'an ignored message escalating (2nd follow-up)',
  escalation_hop_3: 'an ignored message escalating to management',
};

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
    private readonly workTicks: HyrteWorkTickService,
    private readonly heroTasks: HyrteHeroTaskService,
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
    // Founder feedback (WhatsApp, 9 Sep) — "questions are very repeated in pm
    // role... kuch bhi repeat nhi hona chahiye." Self-serve PRACTICE sessions
    // previously passed NO grounding at all, so the pre-existing
    // priorWarmupQuestions avoid-list never ran for them — which is exactly the
    // flow the repetition was observed in. Every session now gets variety.
    const variety = await this.buildVariety(candidateId, dto);
    const session = await this.createPlaceholder(dto, candidateId, {});
    this.populateWorld(session.id, dto, candidateId, { variety }).catch((e) => this.logger.error(`populateWorld failed for session ${session.id}: ${e instanceof Error ? e.message : String(e)}`));
    return session;
  }

  /**
   * Builds the per-candidate no-repeats context for one session: what this
   * candidate has already been asked/shown in this same role, plus a
   * deterministically rotated set of competency axes for the warm-ups (see
   * question-variety.ts). `extraPriorQuestions` folds in the recruiter-link
   * avoid-list for ASSESSMENT sessions, which is about a different axis of
   * repetition (across candidates on one link, rather than across sessions for
   * one candidate) — both matter, so both are applied.
   */
  private async buildVariety(candidateId: string, dto: CreateHyrteSessionDto, extraPriorQuestions: string[] = []): Promise<WorldVariety> {
    const priorSessions = await this.prisma.hyrteSession.findMany({
      where: { candidateId, role: dto.role },
      select: { baselineChallenge: true, companyName: true },
      orderBy: { startedAt: 'desc' },
      take: 12,
    });
    const priorWarmupQuestions: string[] = [];
    const priorBaselineScenarios: string[] = [];
    for (const s of priorSessions) {
      const challenge = s.baselineChallenge as { scenario?: string; warmupQuestions?: { question?: string }[] } | null;
      for (const q of challenge?.warmupQuestions ?? []) if (q.question) priorWarmupQuestions.push(q.question);
      if (challenge?.scenario) priorBaselineScenarios.push(challenge.scenario);
    }
    const warmupCount = WARMUP_COUNT_BY_DIFFICULTY[dto.difficulty] ?? WARMUP_COUNT_BY_DIFFICULTY.MEDIUM;
    return {
      // Sane caps — this is prompt context, not a permanent archive.
      priorWarmupQuestions: Array.from(new Set([...extraPriorQuestions, ...priorWarmupQuestions])).slice(0, 30),
      priorBaselineScenarios: priorBaselineScenarios.slice(0, 6),
      priorCompanyNames: Array.from(new Set(priorSessions.map((s) => s.companyName).filter((n) => n && n !== 'Generating…'))).slice(0, 8),
      warmupAxes: pickAxes(dto.role, warmupCount, priorSessions.length),
    };
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
    // Doc §3 "Warm-up Questions" — "no two candidates should receive the
    // exact same warm-up." Real when it matters most: a recruiter link is
    // often shared with several candidates for the same role, so pull the
    // actual warm-up questions already generated for prior candidates on
    // THIS link and feed them into groundingNote() as an explicit avoid-list.
    const priorSessions = await this.prisma.hyrteSession.findMany({
      where: { simulationRequestId: request.id },
      select: { baselineChallenge: true },
    });
    const priorWarmupQuestions = priorSessions
      .flatMap((s) => {
        const challenge = s.baselineChallenge as { warmupQuestions?: { question?: string }[] } | null;
        return (challenge?.warmupQuestions ?? []).map((q) => q.question).filter((q): q is string => !!q);
      })
      .slice(0, 20); // sane cap — this is prompt context, not a permanent archive

    const grounding: JobSuccessModelGrounding = {
      coreOutcomes: request.coreOutcomes,
      capabilityRequirements: (request.capabilityRequirements ?? []) as unknown as JobSuccessModelGrounding['capabilityRequirements'],
      industryProbeThemes: ((request.industryContext as { probeThemes?: string[] } | null)?.probeThemes ?? []),
      customRequirements: request.customRequirements,
      priorWarmupQuestions,
    };
    // Two independent repetition axes, both real: across candidates on one
    // recruiter link (priorWarmupQuestions above) and across sessions for one
    // candidate (buildVariety). Fold the first into the second so a single
    // avoid-list covers both.
    const variety = await this.buildVariety(candidateId, dto, priorWarmupQuestions);
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

    this.populateWorld(session.id, dto, candidateId, { grounding, variety }).catch((e) => this.logger.error(`populateWorld failed for session ${session.id}: ${e instanceof Error ? e.message : String(e)}`));
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
    options: { grounding?: JobSuccessModelGrounding; variety?: WorldVariety },
  ) {
    let world: GeneratedWorld;
    try {
      world = await this.generator.generate(dto, options.grounding, options.variety);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (dto.sessionType === 'ASSESSMENT') {
        // Upgrade — World Stabilization Gate is now a REAL hard blocker here:
        // an ASSESSMENT session is tied to a specific recruiter-configured JD,
        // so silently substituting the generic static fixture (PRACTICE's
        // fallback below) would hand back a workplace that has nothing to do
        // with the role actually being evaluated — actively misleading for a
        // real hiring decision, not a harmless demo degradation. The
        // candidate/recruiter get an honest GENERATION_FAILED phase instead
        // of a world that LOOKS complete but isn't what it claims to be.
        this.logger.error(`World generation failed for ASSESSMENT session ${sessionId}, blocking rather than falling back: ${msg}`);
        await this.prisma.hyrteSession.update({ where: { id: sessionId }, data: { phase: 'GENERATION_FAILED' } });
        await this.prisma.hyrteWorldGenerationArtifact.create({
          data: {
            sessionId,
            step: 'stabilization_gate',
            status: 'FAILED_BLOCKED',
            payload: (e instanceof WorldStabilizationError ? e.report : { error: msg }) as Prisma.InputJsonValue,
          },
        });
        return;
      }
      this.logger.warn(`Simulation generation failed, using fallback fixture: ${msg}`);
      // §2 — never lose the Stabilization Gate's failure report just because
      // we're falling back; it's persisted below once the session exists.
      const failureArtifact = e instanceof WorldStabilizationError ? [{ step: 'stabilization_gate' as const, status: 'FAILED_FELL_BACK' as const, payload: e.report }] : [];
      world = { fixture: getPmSaasStartupFixture(), artifacts: failureArtifact };
      // The static fallback's warm-ups are hardcoded, so a candidate who hits
      // the fallback twice would see the exact same questions both times —
      // the no-repeats guarantee has to cover this path too, not just the
      // generated one.
      if (options.variety) {
        world.fixture.baselineChallenge.warmupQuestions = enforceWarmupVariety(
          world.fixture.baselineChallenge.warmupQuestions,
          dto.role,
          options.variety.priorWarmupQuestions,
          options.variety.warmupAxes,
          WARMUP_COUNT_BY_DIFFICULTY[dto.difficulty] ?? WARMUP_COUNT_BY_DIFFICULTY.MEDIUM,
        );
      }
    }
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
            privateKnowledge: s.privateKnowledge ?? [],
            ...(s.stress !== undefined && { stress: s.stress }),
            ...(s.urgency !== undefined && { urgency: s.urgency }),
            ...(s.patience !== undefined && { patience: s.patience }),
            ...(s.motivation !== undefined && { motivation: s.motivation }),
          },
        }),
      ),
    );
    const keyToId = new Map(fixture.stakeholders.map((s, i) => [s.key, stakeholders[i].id]));

    await this.prisma.hyrteWorkItem.createMany({
      data: fixture.tasks.map((t) => ({
        sessionId: session.id,
        title: t.title,
        priority: t.priority.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
        dueAt: t.dueInHours ? new Date(Date.now() + t.dueInHours * 3_600_000) : null,
        // Generation-seeded work — the candidate's own starting workload
        // (Part C3: origin=EVENT, owner=candidate). Stakeholder-owned and
        // orchestrator-routed work items arrive later, from G4/G5.
        origin: 'EVENT' as const,
        ownerIsCandidate: true,
        history: [{ at: new Date().toISOString(), actor: 'system', action: 'created', note: 'Seeded at world generation' }] as unknown as Prisma.InputJsonValue,
      })),
    });

    // Refinements doc §22 — Role-Specific Signature Challenges. One real,
    // world-grounded flagship deliverable, tagged distinctly from the
    // generic seeded work items above. `fixture.signatureArtifact` is absent
    // only for the static fallback fixture (pre-upgrade shape) — deriving
    // the label/type from the role directly here means the guarantee ("every
    // session gets one") holds even on that path, not just the LLM-generated one.
    // The signature artifact is no longer created as its own standalone work
    // item. It used to be a work item with a TITLE and nothing behind it —
    // opening it showed a card, and "completing" it meant ticking a box, which
    // is exactly the "review and approve" shape the founder called out. Its
    // role (one flagship, genuinely role-specific deliverable the candidate is
    // measured on) is now filled by the first Hero Task, which has real
    // structure, a real workspace, a domain-appropriate reviewer and a real
    // revision loop — see seedHeroTasks below, which carries the label forward.
    await this.prisma.hyrteCalendarEvent.createMany({
      data: fixture.calendarEvents.map((c) => ({
        sessionId: session.id,
        title: c.title,
        agenda: c.agenda,
        startAt: new Date(Date.now() + c.startInHours * 3_600_000),
        endAt: new Date(Date.now() + c.startInHours * 3_600_000 + c.durationMins * 60_000),
        attendeeStakeholderIds: (c.attendeeKeys ?? []).map((k) => keyToId.get(k)).filter((v): v is string => !!v),
      })),
    });

    await this.prisma.hyrteKnowledgeDoc.createMany({
      data: fixture.knowledgeDocs.map((k) => ({
        sessionId: session.id,
        title: k.title,
        body: k.body,
        category: k.category,
        relevantRoles: resolveRelevantRoles(k.category),
      })),
    });
    // createMany doesn't return the created rows — re-fetch once so every
    // message-creation site below can deterministically link to a real doc
    // id (Refinements doc §8 — "Knowledge as Part of Work").
    const kbDocsForLinking = await this.prisma.hyrteKnowledgeDoc.findMany({
      where: { sessionId: session.id },
      select: { id: true, title: true, category: true },
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
          relatedKnowledgeDocId: findMentionedKnowledgeDoc(`${m.subject} ${m.body}`, kbDocsForLinking),
        },
      });
      // Ignoring an urgent item has a consequence (doc §6) — but the clock
      // must NOT start here. This runs during world generation, while the
      // candidate is still on the Mission Brief / Baseline Challenge screens
      // and has never seen the workspace: a 45-75s ignored-window armed now
      // has already expired by the time they arrive, so they get escalated at
      // for ignoring a message they were never shown. Armed at workspace
      // unlock instead — see armSessionTimers.
    }
    for (const m of fixture.slack.filter((m) => !m.arrivesLater)) {
      await this.prisma.hyrteSlackMessage.create({
        data: {
          sessionId: session.id,
          channel: m.channel,
          fromStakeholderId: keyToId.get(m.fromKey),
          body: m.body,
          ethicalDilemma: m.ethicalDilemma ?? false,
          relatedKnowledgeDocId: findMentionedKnowledgeDoc(m.body, kbDocsForLinking),
        },
      });
    }

    // Fallback-fixture-only path: the static PM/SaaS fixture expresses delayed
    // content via `arrivesLater` on inbox/slack rather than a scheduledEvents
    // array (see hyrte-fixture.types.ts). These used to be bare setTimeouts
    // armed here, at generation time, on a 12-35s fuse — so on the fallback
    // path they had all already landed before the candidate ever reached the
    // workspace. They are queue rows now, armed at unlock and paced like every
    // other scheduled event.
    const arrivesLater = [
      ...fixture.inbox
        .filter((m) => m.arrivesLater)
        .map((m) => ({ surface: 'inbox' as const, fromKey: m.fromKey, subject: m.subject, channel: undefined as string | undefined, body: m.body, urgent: m.urgent, ethicalDilemma: m.ethicalDilemma ?? false })),
      ...fixture.slack
        .filter((m) => m.arrivesLater)
        .map((m) => ({ surface: 'slack' as const, fromKey: m.fromKey, subject: undefined as string | undefined, channel: m.channel, body: m.body, urgent: false, ethicalDilemma: m.ethicalDilemma ?? false })),
    ];
    // The static fixture carries no offsets, only a boolean — spread them
    // evenly across the same raw-offset space the generator uses so
    // scheduledEventDelayMs paces them identically.
    const maxRawOffset = EVENT_QUEUE_MAX_OFFSET_SECONDS_BY_DIFFICULTY[session.difficulty] ?? 840;
    const laterEvents = arrivesLater.map((m, i) => ({
      surface: m.surface as string,
      fromKey: m.fromKey,
      subject: m.subject,
      channel: m.channel,
      body: m.body,
      urgent: m.urgent,
      ethicalDilemma: m.ethicalDilemma,
      fireAtOffsetSeconds: Math.round(((i + 1) / (arrivesLater.length + 1)) * maxRawOffset),
    }));

    // Upgrade §6 — Event Queue. Step 6's output, persisted as real
    // HyrteWorldEvent(kind=SCHEDULED) rows instead of a bare setTimeout with
    // no trace, so "what's coming" is queryable, not just eventually visible.
    //
    // Pacing: these are NO LONGER armed here. This method runs during world
    // generation, which happens while the candidate is still on the Mission
    // Brief and Baseline Challenge screens — arming a 15s-offset event here
    // meant it fired minutes before the candidate could possibly see it, and a
    // whole queue's worth had already piled up in the inbox by the time they
    // entered the workspace. They are armed at unlock instead
    // (armSessionTimers), spread across the real session by
    // scheduledEventDelayMs.
    for (const e of [...fixture.scheduledEvents, ...laterEvents]) {
      const fromStakeholderId = keyToId.get(e.fromKey);
      await this.prisma.hyrteWorldEvent.create({
        data: {
          sessionId: session.id,
          kind: 'SCHEDULED',
          surface: e.surface,
          fireAtOffsetSeconds: e.fireAtOffsetSeconds,
          payload: { fromStakeholderId, subject: e.subject, channel: e.channel, body: e.body, urgent: e.urgent ?? false, ethicalDilemma: e.ethicalDilemma ?? false } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    // Refinements doc §10/§11 + founder feedback (7 Sep, "task added nhi h as
    // per the job role") — the 1-3 Hero Tasks that ARE this role's job, each
    // opening a workspace the candidate actually does the work in. Seeded LAST,
    // deliberately: the grounding call reads the knowledge base, inbox and
    // company state created above, so the tasks reference this company's real
    // situation rather than generic role busywork.
    await this.heroTasks
      .seedHeroTasks(session.id, session.role, session.companyName, fixture.missionBrief?.objective ?? '', resolveSignatureArtifact(session.role).label)
      .catch((e) => this.logger.error(`Hero task seeding failed for session ${session.id}: ${e instanceof Error ? e.message : String(e)}`));

    return this.getById(session.id, candidateId);
  }

  /** Fires a SCHEDULED HyrteWorldEvent: materializes it into a real inbox/Slack row and marks the queue entry FIRED. */
  private async fireScheduledEvent(sessionId: string, eventId: string): Promise<void> {
    const event = await this.prisma.hyrteWorldEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status !== 'PENDING') return;
    const payload = event.payload as { fromStakeholderId?: string; subject?: string; channel?: string; body: string; urgent: boolean; ethicalDilemma: boolean };
    // Refinements doc §8 — same deterministic linking as the immediate seed
    // above; re-fetched here since this fires much later, independently of
    // that original createFromSimulationRequest call's scope.
    const kbDocs = await this.prisma.hyrteKnowledgeDoc.findMany({ where: { sessionId }, select: { id: true, title: true, category: true } });

    if (event.surface === 'inbox') {
      const created = await this.prisma.hyrteInboxMessage.create({
        data: {
          sessionId,
          fromStakeholderId: payload.fromStakeholderId,
          subject: payload.subject || '(no subject)',
          body: payload.body,
          urgent: payload.urgent,
          ethicalDilemma: payload.ethicalDilemma,
          relatedKnowledgeDocId: findMentionedKnowledgeDoc(`${payload.subject ?? ''} ${payload.body}`, kbDocs),
        },
      });
      this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
      if (payload.urgent) this.consequences.scheduleIgnoredCheck(sessionId, created.id, randomIgnoredWindow());
    } else {
      const created = await this.prisma.hyrteSlackMessage.create({
        data: {
          sessionId,
          channel: payload.channel || '#product',
          fromStakeholderId: payload.fromStakeholderId,
          body: payload.body,
          ethicalDilemma: payload.ethicalDilemma,
          relatedKnowledgeDocId: findMentionedKnowledgeDoc(payload.body, kbDocs),
        },
      });
      this.gateway.broadcast(sessionId, { type: 'slack:new', message: created });
    }

    await this.prisma.hyrteWorldEvent.update({ where: { id: eventId }, data: { status: 'FIRED', firedAt: new Date() } });
  }

  async getById(id: string, candidateId: string) {
    const session = await this.prisma.hyrteSession.findFirst({
      where: { id, candidateId },
      // simulationRequest.code — only populated for GENERATION_FAILED
      // sessions' benefit, so the candidate-facing UI can link straight back
      // to a fresh attempt at the same recruiter-configured link rather than
      // just showing a dead end.
      include: { companyState: true, simulationRequest: { select: { code: true } } },
    });
    if (!session) throw new NotFoundException('Session not found');
    // Pacing is computed here rather than on the client so the frontend and
    // every backend scheduler agree on exactly one definition of "how far into
    // the session are we" — the client used to derive elapsed time from
    // startedAt, which counts world generation and the Mission Brief as
    // working time.
    const fraction = elapsedFraction(session);
    return {
      ...session,
      pacing: {
        ...phaseDescriptorAt(fraction),
        elapsedFraction: fraction,
        plannedDurationMs: plannedDurationMs(session.difficulty),
        orientationEndsAtFraction: ORIENTATION_UNTIL_FRACTION,
        quietUntil: session.workspaceUnlockedAt
          ? new Date(new Date(session.workspaceUnlockedAt).getTime() + orientationEndMs(session.difficulty)).toISOString()
          : null,
      },
    };
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

  /**
   * Master Build Prompt Part F8 — What-Changed. Deliberately deterministic,
   * not an LLM synthesis: this is meant to read as a factual account of real
   * deltas, and an LLM narrating "what changed" risks paraphrasing its way
   * into a claim the actual numbers don't support. Every card traces to one
   * real HyrteCompanyStateHistory row.
   */
  async getWhatChanged(id: string, candidateId: string) {
    await this.getById(id, candidateId);
    return this.computeWhatChanged(id);
  }

  /** Ownership-unchecked core, also used by HyrteRecruiterService (Part G7 — recruiter isn't the candidate). */
  async computeWhatChanged(sessionId: string) {
    const rows = await this.prisma.hyrteCompanyStateHistory.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
    return rows.map((r) => {
      const delta = (r.delta ?? {}) as Record<string, number>;
      const parts = Object.entries(delta)
        .filter(([, v]) => typeof v === 'number' && v !== 0)
        .map(([k, v]) => `${humanizeKey(k)} ${v > 0 ? '+' : ''}${v}`);
      return {
        at: r.createdAt,
        headline: parts.length > 0 ? parts.join(', ') : 'No measurable change',
        cause: REASON_LABEL[r.reason ?? ''] ?? r.reason ?? 'unknown cause',
      };
    });
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
      warmupQuestions: { id: string; question: string }[];
    } | null;
    const chosen = challenge?.options.find((o) => o.id === dto.optionId);
    if (!chosen) throw new BadRequestException('Invalid option for this challenge');

    // Recruiter doc §3 "Warm-up Questions" — Role Calibration is "not
    // MCQ-only": every warm-up question (3-6, scaled by difficulty) gets a
    // real score, unlike the decision-framework scenario above (deliberately
    // unscored — no single correct option). Was hardcoded to exactly 2
    // fixed questions before this.
    const warmupQuestions = challenge?.warmupQuestions ?? [];
    const qa = warmupQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      answer: dto.warmupAnswers.find((a) => a.id === q.id)?.answer ?? '',
    }));
    const { scores, averageScore, notes } = await this.scoreCalibrationAnswers(session.role, qa);
    const calibrationScore = averageScore;

    const baselineResponse = {
      optionId: dto.optionId,
      optionLabel: chosen.label,
      reasoning: dto.reasoning,
      warmupAnswers: qa.map((q, i) => ({ id: q.id, question: q.question, answer: q.answer, score: scores[i] })),
      calibrationScore,
    };

    const [updated] = await Promise.all([
      this.prisma.hyrteSession.update({
        where: { id },
        // workspaceUnlockedAt is the pacing clock's zero point — every
        // in-session timer is measured from here, not from startedAt.
        data: { phase: 'WORKSPACE_ACTIVE', workspaceUnlockedAt: new Date(), baselineResponse: baselineResponse as unknown as Prisma.InputJsonValue },
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
          `${calibrationScore}/100 across ${qa.length} warm-up questions (${scores.join(', ')}) — ${notes}`,
        behaviorContext: 'AMBIGUITY', // the decision-framework scenario has no single correct option, by design (§8 step 2)
      }),
    ]);

    // Everything that makes the world move is armed HERE, from the real
    // workspace-unlock moment — the event queue, the ignored-message clocks,
    // the chaos wave, the orchestrator and ambient chatter — and every one of
    // them is paced through session-pacing.ts so the candidate gets a genuine
    // orientation window before anything lands.
    await this.armSessionTimers(id, calibrationScore);

    return updated;
  }

  /**
   * Founder feedback (WhatsApp, 7 Sep) — "simulation gradually open up hoga
   * naki sara kuch ek saath... exploration k liye atleast 10 min dene h."
   *
   * The single place every in-session timer starts. Before this, four separate
   * mechanics armed themselves at three different moments (world generation,
   * baseline submit, and inbox seeding), none of them aware of each other or of
   * how far into the session the candidate was — so the first few minutes got
   * everything at once and the rest of the session got comparatively little.
   *
   * Now: one entry point, one clock (`workspaceUnlockedAt`), and every delay
   * routed through `rampedDelayMs`/`scheduledEventDelayMs`.
   */
  private async armSessionTimers(sessionId: string, calibrationScore?: number): Promise<void> {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId } });
    if (!session) return;

    // 1. The generated event queue, spread across the whole session rather
    //    than bunched into its first two minutes.
    const pending = await this.prisma.hyrteWorldEvent.findMany({
      where: { sessionId, kind: 'SCHEDULED', status: 'PENDING' },
      orderBy: { fireAtOffsetSeconds: 'asc' },
    });
    const offsets = pending.map((e) => e.fireAtOffsetSeconds ?? 0);
    const minRawOffset = offsets.length ? Math.min(...offsets) : 0;
    const maxRawOffset = offsets.length ? Math.max(...offsets) : 0;
    for (const event of pending) {
      const delay = scheduledEventDelayMs(event.fireAtOffsetSeconds ?? 0, minRawOffset, maxRawOffset, session.difficulty);
      setTimeout(() => this.fireScheduledEvent(sessionId, event.id).catch((err) => this.logger.warn(err)), delay);
    }

    // 2. Ignored-message clocks for the urgent content that was already
    //    waiting when the candidate walked in. These used to be armed at
    //    generation time, so they had typically already expired before the
    //    candidate ever saw the message.
    const urgentUnread = await this.prisma.hyrteInboxMessage.findMany({
      where: { sessionId, urgent: true, readAt: null },
      select: { id: true },
    });
    for (const m of urgentUnread) {
      this.consequences.scheduleIgnoredCheck(sessionId, m.id, rampedDelayMs(randomIgnoredWindow(), session));
    }

    // 3. Chaos Engine (§4.5), scaled by the calibration score (§4/Step 9's
    //    "adjust event difficulty weights") — now also paced, so a wave cannot
    //    land during the orientation window.
    this.consequences.scheduleChaosWave(sessionId, calibrationScore);

    // 4. Part F3 Orchestrator — periodic Manager/CEO context reviews.
    this.workTicks.scheduleOrchestratorReview(sessionId);

    // 5. Refinements doc §4 — ambient AI-to-AI Slack chatter.
    this.consequences.scheduleAmbientChatter(sessionId);
  }

  /** Recruiter doc §3 — scores N warm-up questions (3-6, was hardcoded to exactly 2) in one call, same order as given. */
  private async scoreCalibrationAnswers(
    role: string,
    qa: { id: string; question: string; answer: string }[],
  ): Promise<{ scores: number[]; averageScore: number; notes: string }> {
    if (qa.length === 0) return { scores: [], averageScore: 50, notes: 'No warm-up questions to score.' };
    try {
      const result = await this.ai.completeJson<{ scores?: number[]; notes?: string }>(
        [
          {
            role: 'system',
            content:
              'You are scoring a quick Role Calibration check before a candidate enters a workplace simulation. ' +
              'Score each answer 0-100 on whether it shows real, correct understanding — brief but substantive ' +
              'answers can score well; empty/nonsensical answers score near 0. Return ONLY JSON: {"scores": ' +
              `int[] (EXACTLY ${qa.length} entries, same order as the questions given), "notes": string (one ` +
              'short sentence, overall impression)}.',
          },
          {
            role: 'user',
            content: `Role: ${role}.\n\n` + qa.map((p, i) => `Q${i + 1}: ${p.question}\nA${i + 1}: ${p.answer}`).join('\n\n'),
          },
        ],
        { temperature: 0.3, maxTokens: 300 },
      );
      const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(typeof n === 'number' && Number.isFinite(n) ? n : 50)));
      const scores = qa.map((_, i) => clamp(result.scores?.[i]));
      const averageScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      return { scores, averageScore, notes: result.notes ?? '' };
    } catch (e) {
      this.logger.warn(`scoreCalibrationAnswers failed, defaulting to neutral scores: ${e instanceof Error ? e.message : String(e)}`);
      return { scores: qa.map(() => 50), averageScore: 50, notes: 'Scoring unavailable — defaulted to neutral.' };
    }
  }
}
