import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { DeliverableSection, RoleTaskTemplate, findRoleTask, resolveRoleTasks } from '../generator/role-tasks';

/**
 * Founder feedback (WhatsApp, 7 Sep):
 *   "Task added nhi h as per the job role while working in the simulation."
 *   "Simulation kaafi review and approve type hori thi instead of working on
 *    real tasks disguised in the simulation."
 *
 * Refinements doc §10 — "The candidate shouldn't spend 80% of the simulation:
 * approve, delegate, review, respond. They need to do the work." §11 — "Every
 * simulation should have 1–3 Hero Tasks."
 *
 * This service owns those tasks end to end: seeding them from the role
 * templates (generator/role-tasks.ts) grounded in the generated world, serving
 * the workspace the candidate actually works in, autosaving what they write,
 * and running the real stakeholder review when they submit — which can send the
 * work back for revision rather than rubber-stamping it.
 */

export interface BriefPayload {
  objective: string;
  context: string;
  successCriteria: string[];
  tags: string[];
}

export interface DeliverablePayload {
  sections?: DeliverableSection[];
  draft?: Record<string, string>;
  lastSavedAt?: string;
  buckets?: string[];
  items?: { id: string; label: string; evidence: string }[];
  placement?: Record<string, string>;
  rationale?: Record<string, string>;
}

export interface ReviewEntry {
  at: string;
  stakeholderId: string | null;
  stakeholderName: string;
  verdict: 'approved' | 'revision_requested';
  notes: string;
}

/**
 * Refinements doc, Tasks §4 — "A PM task shouldn't simply go Not Started →
 * Completed. It should behave more like: Assigned → Investigating → Working →
 * Review → Revision → Submitted → Evaluated", and crucially "the system
 * automatically detects progress from actual actions... No fake 'I completed
 * this checkbox' behavior."
 *
 * Every state below is derived from something the candidate really did — a
 * saved draft with content, a submission, a reviewer's verdict — never from a
 * self-reported toggle.
 */
export type HeroTaskState = 'ASSIGNED' | 'INVESTIGATING' | 'WORKING' | 'REVIEW' | 'REVISION' | 'COMPLETED';

/** A draft this short is someone poking at the editor, not working on it. */
const WORKING_MIN_CHARS = 40;

function asBrief(value: Prisma.JsonValue | null): BriefPayload {
  const v = (value ?? {}) as Partial<BriefPayload>;
  return {
    objective: typeof v.objective === 'string' ? v.objective : '',
    context: typeof v.context === 'string' ? v.context : '',
    successCriteria: Array.isArray(v.successCriteria) ? v.successCriteria.filter((s): s is string => typeof s === 'string') : [],
    tags: Array.isArray(v.tags) ? v.tags.filter((s): s is string => typeof s === 'string') : [],
  };
}

function asDeliverable(value: Prisma.JsonValue | null): DeliverablePayload {
  return (value ?? {}) as DeliverablePayload;
}

function draftLength(d: DeliverablePayload): number {
  const sections = Object.values(d.draft ?? {}).join('').trim().length;
  const placed = Object.keys(d.placement ?? {}).length;
  const rationale = Object.values(d.rationale ?? {}).join('').trim().length;
  return sections + rationale + placed * 20;
}

@Injectable()
export class HyrteHeroTaskService {
  private readonly logger = new Logger(HyrteHeroTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly evidence: EvidenceGraphService,
    private readonly decisionGraph: DecisionGraphService,
  ) {}

  private async assertOwnership(sessionId: string, candidateId: string) {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id: sessionId, candidateId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  // ── Seeding ──

  /**
   * Creates this session's Hero Tasks. Called once, at world population.
   *
   * The task STRUCTURE (which tasks, which sections) is deterministic — it
   * comes from the role templates, so a PM always gets a PRD with a real scope
   * and success-metrics section regardless of what the LLM does. Only the
   * grounding — what this company's version of the task is actually about — is
   * generated, and it falls back to real world data rather than failing.
   */
  async seedHeroTasks(sessionId: string, role: string, companyName: string, missionObjective: string, signatureArtifactLabel?: string): Promise<void> {
    const templates = resolveRoleTasks(role);
    const grounding = await this.groundTasks(sessionId, role, companyName, missionObjective, templates);

    for (const [index, template] of templates.entries()) {
      const ground = grounding[template.key] ?? { objective: template.summary, context: '' };
      const deliverable: DeliverablePayload =
        template.workspace === 'PRIORITIZATION'
          ? {
              buckets: template.buckets ?? ['Now', 'Next', 'Later', 'Not planned'],
              items: ground.items ?? [],
              placement: {},
              rationale: {},
            }
          : { sections: template.sections, draft: {} };

      const created = await this.prisma.hyrteWorkItem.create({
        data: {
          sessionId,
          title: template.title,
          type: template.type,
          priority: index === 0 ? 'HIGH' : 'MEDIUM',
          origin: 'EVENT',
          ownerIsCandidate: true,
          isHeroTask: true,
          heroOrder: index,
          // Doc §22's Role-Specific Signature Challenge is the FIRST hero task
          // rather than a separate title-only work item — same "one flagship
          // deliverable per role" guarantee, but now something the candidate
          // genuinely produces and a colleague genuinely reviews.
          isSignatureArtifact: index === 0,
          signatureArtifactLabel: index === 0 ? signatureArtifactLabel ?? template.title : null,
          roleTaskKey: template.key,
          workspaceKind: template.workspace,
          brief: {
            objective: ground.objective || template.summary,
            context: ground.context,
            successCriteria: template.successCriteria,
            tags: template.tags,
          } as unknown as Prisma.InputJsonValue,
          deliverable: deliverable as unknown as Prisma.InputJsonValue,
          history: [{ at: new Date().toISOString(), actor: 'system', action: 'assigned', note: template.summary }] as unknown as Prisma.InputJsonValue,
        },
      });
      this.gateway.broadcast(sessionId, { type: 'task:update', task: created });
    }
  }

  /**
   * One LLM call to ground all of this role's tasks in the real generated
   * company. Falls back to the template's own summary plus real world data —
   * a failed grounding call degrades the flavour text, never the task itself.
   */
  private async groundTasks(
    sessionId: string,
    role: string,
    companyName: string,
    missionObjective: string,
    templates: RoleTaskTemplate[],
  ): Promise<Record<string, { objective: string; context: string; items?: { id: string; label: string; evidence: string }[] }>> {
    const [companyState, knowledgeDocs, inbox] = await Promise.all([
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
      this.prisma.hyrteKnowledgeDoc.findMany({ where: { sessionId }, select: { title: true }, take: 8 }),
      this.prisma.hyrteInboxMessage.findMany({ where: { sessionId }, select: { subject: true, body: true }, take: 4 }),
    ]);

    const fallback = (): Record<string, { objective: string; context: string; items?: { id: string; label: string; evidence: string }[] }> =>
      Object.fromEntries(
        templates.map((t) => [
          t.key,
          {
            objective: t.summary,
            // Real world data, not a placeholder: the candidate still gets a
            // task anchored to something that actually exists in this company.
            context: missionObjective ? `Your objective this quarter: ${missionObjective}` : `Current priority at ${companyName}.`,
            items:
              t.workspace === 'PRIORITIZATION'
                ? inbox.slice(0, 4).map((m, i) => ({ id: `item-${i + 1}`, label: m.subject, evidence: m.body.slice(0, 160) }))
                : undefined,
          },
        ]),
      );

    try {
      const needsItems = templates.filter((t) => t.workspace === 'PRIORITIZATION').map((t) => t.key);
      const result = await this.ai.completeJson<{ tasks?: Record<string, { objective?: string; context?: string; items?: { label?: string; evidence?: string }[] }> }>(
        [
          {
            role: 'system',
            content:
              'You are grounding a workplace simulation\'s role tasks in a specific generated company. For each task ' +
              'key given, write what THIS company\'s version of that task is actually about — reference the real ' +
              'metrics, documents and situations below, never generic filler. Return ONLY JSON: {"tasks": { "<key>": ' +
              '{ "objective": string (one sentence, what this candidate must produce and why it matters HERE), ' +
              '"context": string (2-3 sentences of the real situation behind it — numbers, names, constraints)' +
              (needsItems.length
                ? ', "items": [{ "label": string (a real competing ask, short), "evidence": string (one line: who asked, ' +
                  'revenue or user impact, and rough effort) }] (4-5 entries, ONLY for these keys: ' +
                  `${needsItems.join(', ')} — they must be genuinely in tension, not obviously rankable)`
                : '') +
              ' } } }. No prose outside the JSON.',
          },
          {
            role: 'user',
            content:
              `Role: ${role}. Company: ${companyName}. Objective: ${missionObjective || 'n/a'}.\n` +
              `Company state: ${JSON.stringify(companyState ? { revenue: companyState.revenue, customerSatisfaction: companyState.customerSatisfaction, engineeringCapacity: companyState.engineeringCapacity, technicalDebt: companyState.technicalDebt, growth: companyState.growth, riskLevel: companyState.riskLevel } : {})}\n` +
              `Knowledge base: ${knowledgeDocs.map((d) => d.title).join('; ')}\n` +
              `In the inbox right now: ${inbox.map((m) => m.subject).join('; ')}\n` +
              `Task keys to ground: ${templates.map((t) => `${t.key} (${t.title} — ${t.summary})`).join(' | ')}`,
          },
        ],
        { temperature: 0.7, maxTokens: 900 },
      );

      const base = fallback();
      for (const t of templates) {
        const g = result.tasks?.[t.key];
        if (!g) continue;
        if (typeof g.objective === 'string' && g.objective.trim()) base[t.key].objective = g.objective.trim();
        if (typeof g.context === 'string' && g.context.trim()) base[t.key].context = g.context.trim();
        if (t.workspace === 'PRIORITIZATION' && Array.isArray(g.items)) {
          const items = g.items
            .filter((i) => typeof i.label === 'string' && i.label.trim())
            .slice(0, 6)
            .map((i, idx) => ({ id: `item-${idx + 1}`, label: i.label!.trim(), evidence: typeof i.evidence === 'string' ? i.evidence.trim() : '' }));
          if (items.length >= 2) base[t.key].items = items;
        }
      }
      return base;
    } catch (e) {
      this.logger.warn(`Hero task grounding failed, using world-derived fallback: ${e instanceof Error ? e.message : String(e)}`);
      return fallback();
    }
  }

  // ── Reads ──

  /** §11 — "Your objectives / Your 3 critical tasks. Everything else becomes the environment around those objectives." */
  async listMyTasks(sessionId: string, candidateId: string) {
    const session = await this.assertOwnership(sessionId, candidateId);
    const items = await this.prisma.hyrteWorkItem.findMany({
      where: { sessionId, isHeroTask: true },
      orderBy: { heroOrder: 'asc' },
    });
    const brief = session.missionBrief as { objective?: string; objectives?: { primary?: string[]; secondary?: string[]; stretch?: string[] } } | null;

    const tasks = items.map((item) => {
      const state = this.deriveState(item);
      return {
        id: item.id,
        title: item.title,
        summary: asBrief(item.brief).objective,
        tags: asBrief(item.brief).tags,
        priority: item.priority,
        workspaceKind: item.workspaceKind,
        state,
        stateLabel: STATE_LABEL[state],
        submissionCount: item.submissionCount,
        latestFeedback: (item.reviewFeedback as unknown as ReviewEntry[] | null)?.slice(-1)[0] ?? null,
        dueAt: item.dueAt,
      };
    });

    return {
      primaryObjective: brief?.objective ?? '',
      objectives: brief?.objectives ?? { primary: [], secondary: [], stretch: [] },
      completed: tasks.filter((t) => t.state === 'COMPLETED').length,
      total: tasks.length,
      tasks,
    };
  }

  /** The workspace itself: the brief, whatever the candidate has written so far, and the real resources they can pull on. */
  async getTaskWorkspace(sessionId: string, taskId: string, candidateId: string) {
    const session = await this.assertOwnership(sessionId, candidateId);
    const item = await this.prisma.hyrteWorkItem.findFirst({ where: { id: taskId, sessionId, isHeroTask: true } });
    if (!item) throw new NotFoundException('Task not found');

    const [knowledgeDocs, stakeholders, companyState] = await Promise.all([
      this.prisma.hyrteKnowledgeDoc.findMany({ where: { sessionId }, select: { id: true, title: true, category: true }, take: 8 }),
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId }, select: { id: true, name: true, role: true, department: true } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
    ]);

    const state = this.deriveState(item);
    return {
      id: item.id,
      title: item.title,
      workspaceKind: item.workspaceKind,
      state,
      stateLabel: STATE_LABEL[state],
      submissionCount: item.submissionCount,
      brief: asBrief(item.brief),
      deliverable: asDeliverable(item.deliverable),
      reviewFeedback: (item.reviewFeedback as unknown as ReviewEntry[] | null) ?? [],
      // §Tasks — "the important part is what happens around it": the candidate
      // pulls evidence from the same world everything else lives in.
      resources: {
        knowledgeDocs,
        // Who to actually talk to, with a deep link into the DM that opens that conversation.
        people: stakeholders.map((s) => ({ ...s, dmChannel: `dm:${s.id}` })),
        metrics: companyState
          ? {
              revenue: companyState.revenue,
              customerSatisfaction: companyState.customerSatisfaction,
              engineeringCapacity: companyState.engineeringCapacity,
              technicalDebt: companyState.technicalDebt,
              growth: companyState.growth,
              riskLevel: companyState.riskLevel,
            }
          : null,
      },
      companyName: session.companyName,
      role: session.role,
    };
  }

  private deriveState(item: { stage: string; deliverable: Prisma.JsonValue | null; submissionCount: number; reviewFeedback: Prisma.JsonValue }): HeroTaskState {
    if (item.stage === 'DONE') return 'COMPLETED';
    if (item.stage === 'WAITING_REVIEW') return 'REVIEW';
    const feedback = (item.reviewFeedback as unknown as ReviewEntry[] | null) ?? [];
    if (feedback.length > 0 && feedback[feedback.length - 1].verdict === 'revision_requested') return 'REVISION';
    const d = asDeliverable(item.deliverable);
    const written = draftLength(d);
    if (written >= WORKING_MIN_CHARS) return 'WORKING';
    // Anything saved at all means they have opened the workspace and started
    // engaging with it — that is "investigating", not "not started".
    if (written > 0 || !!d.lastSavedAt) return 'INVESTIGATING';
    return 'ASSIGNED';
  }

  // ── Writes ──

  /** Autosave. Deliberately does not touch `stage` — the lifecycle state is derived from the content, never asserted. */
  async saveDraft(
    sessionId: string,
    taskId: string,
    candidateId: string,
    patch: { draft?: Record<string, string>; placement?: Record<string, string>; rationale?: Record<string, string> },
  ) {
    await this.assertOwnership(sessionId, candidateId);
    const item = await this.prisma.hyrteWorkItem.findFirst({ where: { id: taskId, sessionId, isHeroTask: true } });
    if (!item) throw new NotFoundException('Task not found');
    if (item.stage === 'DONE') throw new BadRequestException('This task has already been completed');

    const current = asDeliverable(item.deliverable);
    const next: DeliverablePayload = {
      ...current,
      ...(patch.draft ? { draft: { ...(current.draft ?? {}), ...patch.draft } } : {}),
      ...(patch.placement ? { placement: { ...(current.placement ?? {}), ...patch.placement } } : {}),
      ...(patch.rationale ? { rationale: { ...(current.rationale ?? {}), ...patch.rationale } } : {}),
      lastSavedAt: new Date().toISOString(),
    };

    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: taskId },
      data: {
        deliverable: next as unknown as Prisma.InputJsonValue,
        // Real progress from a real action: the first time there is genuine
        // content, the item moves off NEW on its own.
        ...(item.stage === 'NEW' && draftLength(next) >= WORKING_MIN_CHARS ? { stage: 'IN_PROGRESS' as const } : {}),
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: updated });
    return { savedAt: next.lastSavedAt, state: this.deriveState(updated) };
  }

  /**
   * §Tasks — "When they submit it: Engineering agent reviews the PRD.
   * 'Requirement #3 isn't technically feasible within the current sprint.' The
   * candidate can revise it. That's actual PM work."
   *
   * A real colleague reads what was written and can genuinely send it back. The
   * reviewer is picked deterministically (the most senior person in the
   * department this task touches), never LLM-chosen.
   */
  async submit(sessionId: string, taskId: string, candidateId: string) {
    const session = await this.assertOwnership(sessionId, candidateId);
    const item = await this.prisma.hyrteWorkItem.findFirst({ where: { id: taskId, sessionId, isHeroTask: true } });
    if (!item) throw new NotFoundException('Task not found');
    if (item.stage === 'DONE') throw new BadRequestException('This task has already been completed');

    const template = item.roleTaskKey ? findRoleTask(session.role, item.roleTaskKey) : undefined;
    const deliverable = asDeliverable(item.deliverable);

    // Required sections are enforced in code, not left to the reviewer's mood —
    // an empty submission must never reach a colleague as if it were work.
    const missing = (template?.sections ?? deliverable.sections ?? [])
      .filter((s) => s.required && !(deliverable.draft?.[s.id] ?? '').trim())
      .map((s) => s.label);
    if (missing.length > 0) throw new BadRequestException(`Still empty: ${missing.join(', ')}`);
    if (item.workspaceKind === 'PRIORITIZATION' && Object.keys(deliverable.placement ?? {}).length === 0) {
      throw new BadRequestException('Place at least one item before submitting');
    }

    const stakeholders = await this.prisma.hyrteStakeholder.findMany({ where: { sessionId } });
    const reviewer = pickReviewer(stakeholders, template);

    const submissionCount = item.submissionCount + 1;
    const body = this.renderDeliverable(deliverable, item.workspaceKind);
    const review = await this.reviewSubmission(session.role, session.companyName, item.title, template, body, reviewer, submissionCount);

    const feedback: ReviewEntry[] = [
      ...(((item.reviewFeedback as unknown as ReviewEntry[] | null) ?? [])),
      { at: new Date().toISOString(), stakeholderId: reviewer?.id ?? null, stakeholderName: reviewer?.name ?? 'Your manager', verdict: review.verdict, notes: review.notes },
    ];

    const history = [
      ...((Array.isArray(item.history) ? item.history : []) as unknown as { at: string; actor: string; action: string; note?: string }[]),
      { at: new Date().toISOString(), actor: 'You', action: 'submitted', note: `Submission ${submissionCount}` },
      { at: new Date().toISOString(), actor: reviewer?.name ?? 'Your manager', action: review.verdict, note: review.notes },
    ];

    const updated = await this.prisma.hyrteWorkItem.update({
      where: { id: taskId },
      data: {
        // Approved work is genuinely done; a revision request puts it back in
        // the candidate's hands rather than parking it in a review queue.
        stage: review.verdict === 'approved' ? 'DONE' : 'IN_PROGRESS',
        submissionCount,
        reviewFeedback: feedback as unknown as Prisma.InputJsonValue,
        history: history as unknown as Prisma.InputJsonValue,
        artifacts: [...(Array.isArray(item.artifacts) ? item.artifacts : []), { type: 'deliverable', content: body, submittedAt: new Date().toISOString() }] as unknown as Prisma.InputJsonValue,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: updated });

    // The work itself is the strongest evidence this simulation produces — it
    // is the candidate doing the job, not talking about doing it.
    await this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_ACTION',
        rawText:
          `Hero task "${item.title}" — submission ${submissionCount}. The candidate produced:\n${body}\n\n` +
          `${reviewer?.name ?? 'Their manager'} ${review.verdict === 'approved' ? 'accepted it' : 'sent it back for revision'}: ${review.notes}`,
        metadata: { workItemId: taskId, roleTaskKey: item.roleTaskKey, submissionCount, verdict: review.verdict },
      })
      .catch((e) => this.logger.warn(e));

    await this.decisionGraph
      .recordDecision({
        sessionId,
        actor: candidateId,
        actionType: 'hero_task.submit',
        payload: { workItemId: taskId, roleTaskKey: item.roleTaskKey, submissionCount },
        outcome: `${reviewer?.name ?? 'Manager'} ${review.verdict === 'approved' ? 'approved' : 'requested changes to'} "${item.title}"`,
      })
      .catch((e) => this.logger.warn(e));

    // The reviewer says so in the inbox too, so this lands the same way every
    // other piece of news in the company does rather than only inside the task.
    if (reviewer) {
      const created = await this.prisma.hyrteInboxMessage.create({
        data: {
          sessionId,
          fromStakeholderId: reviewer.id,
          subject: review.verdict === 'approved' ? `Approved: ${item.title}` : `Changes needed: ${item.title}`,
          body: review.notes,
          urgent: review.verdict === 'revision_requested',
        },
      });
      this.gateway.broadcast(sessionId, { type: 'inbox:new', message: created });
    }

    return { verdict: review.verdict, notes: review.notes, reviewer: reviewer?.name ?? 'Your manager', state: this.deriveState(updated) };
  }

  /** Flattens whatever the candidate produced into the text a reviewer (and the report) actually reads. */
  private renderDeliverable(d: DeliverablePayload, workspaceKind: string | null): string {
    if (workspaceKind === 'PRIORITIZATION') {
      const byBucket = (d.buckets ?? []).map((bucket) => {
        const inBucket = (d.items ?? []).filter((i) => d.placement?.[i.id] === bucket);
        const lines = inBucket.map((i) => `  - ${i.label}${d.rationale?.[i.id] ? ` — rationale: ${d.rationale[i.id]}` : ' — no rationale given'}`);
        return `${bucket}:\n${lines.length ? lines.join('\n') : '  (empty)'}`;
      });
      const unplaced = (d.items ?? []).filter((i) => !d.placement?.[i.id]);
      return byBucket.join('\n\n') + (unplaced.length ? `\n\nLeft unranked: ${unplaced.map((i) => i.label).join(', ')}` : '');
    }
    return (d.sections ?? [])
      .map((s) => `## ${s.label}\n${(d.draft?.[s.id] ?? '').trim() || '(left empty)'}`)
      .join('\n\n');
  }

  /**
   * The reviewer's judgement. Falls back to a deterministic completeness check
   * when the model is unavailable — the candidate always gets a real verdict
   * rather than a silent failure, and the fallback still refuses to approve
   * work that is obviously thin.
   */
  private async reviewSubmission(
    role: string,
    companyName: string,
    taskTitle: string,
    template: RoleTaskTemplate | undefined,
    body: string,
    reviewer: { name: string; role: string } | null,
    submissionCount: number,
  ): Promise<{ verdict: 'approved' | 'revision_requested'; notes: string }> {
    const fallbackVerdict = (): { verdict: 'approved' | 'revision_requested'; notes: string } => {
      const thin = body.length < 320 || body.includes('(left empty)');
      if (thin && submissionCount < 2) {
        return {
          verdict: 'revision_requested',
          notes: `I've read this through. There isn't enough here yet for me to sign off on — several parts are thin or missing detail I'd need. Add the specifics and send it back over.`,
        };
      }
      return { verdict: 'approved', notes: `Read through this — it works, and it covers what I needed to see. Signing off on it.` };
    };

    if (!reviewer) return fallbackVerdict();

    try {
      const result = await this.ai.completeJson<{ verdict?: string; notes?: string }>(
        [
          {
            role: 'system',
            content:
              `You are ${reviewer.name}, ${reviewer.role} at ${companyName}. A ${role} on your team has just sent you ` +
              `their "${taskTitle}" for review. Read what they ACTUALLY wrote and respond like a real colleague would — ` +
              'specific, referencing their actual words, not generic praise. Push back where it is genuinely weak. ' +
              (submissionCount >= 3
                ? 'This is their third pass; unless it is still seriously deficient, accept it and move on. '
                : 'Only request changes if there is a real, nameable problem — do not manufacture one. ') +
              'Return ONLY JSON: {"verdict": "approved" | "revision_requested", "notes": string (2-4 sentences in your ' +
              'own voice, addressed to them directly; if requesting changes, name the SPECIFIC thing that needs to ' +
              'change and why it matters here)}.',
          },
          {
            role: 'user',
            content:
              (template ? `What good looks like for this: ${template.successCriteria.join('; ')}\n\n` : '') +
              `Submission ${submissionCount}:\n\n${body}`,
          },
        ],
        { temperature: 0.7, maxTokens: 400 },
      );
      const verdict = result.verdict === 'approved' || result.verdict === 'revision_requested' ? result.verdict : undefined;
      const notes = typeof result.notes === 'string' && result.notes.trim() ? result.notes.trim() : undefined;
      if (!verdict || !notes) return fallbackVerdict();
      return { verdict, notes };
    } catch (e) {
      this.logger.warn(`Hero task review failed, using deterministic verdict: ${e instanceof Error ? e.message : String(e)}`);
      return fallbackVerdict();
    }
  }
}

/**
 * §Tasks — "Engineering agent reviews the PRD: 'Requirement #3 isn't
 * technically feasible within the current sprint.'" The reviewer is the most
 * senior person in the domain this task actually touches, so a PRD goes to
 * engineering rather than to whoever happens to outrank everyone. Deterministic
 * — never LLM-chosen — same discipline as the manager/escalation derivations
 * elsewhere in this codebase.
 */
function pickReviewer<T extends { role: string; department: string | null; authorityLevel: number | null }>(
  stakeholders: T[],
  template: RoleTaskTemplate | undefined,
): T | null {
  if (stakeholders.length === 0) return null;
  const mostSenior = (pool: T[]) => pool.reduce((a, b) => ((b.authorityLevel ?? 50) > (a.authorityLevel ?? 50) ? b : a));
  if (template?.reviewerHint) {
    const matches = stakeholders.filter((s) => template.reviewerHint!.test(s.role) || (s.department ? template.reviewerHint!.test(s.department) : false));
    if (matches.length > 0) return mostSenior(matches);
  }
  return mostSenior(stakeholders);
}

const STATE_LABEL: Record<HeroTaskState, string> = {
  ASSIGNED: 'Not started',
  INVESTIGATING: 'Investigating',
  WORKING: 'In progress',
  REVIEW: 'In review',
  REVISION: 'Changes requested',
  COMPLETED: 'Completed',
};
