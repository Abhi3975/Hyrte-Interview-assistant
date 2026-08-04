import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { HyrteGateway } from '../hyrte.gateway';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { DecisionGraphService } from '../dig/decision-graph.service';
import { HyrteWorkTickService } from './work-tick.service';

interface CommandParseResult {
  targetStakeholderKey?: string | null;
  isOverreach?: boolean;
  pushback?: string;
  workItemTitle?: string;
  workItemType?: string;
  priority?: string;
  dueInHours?: number;
  delegationQuality?: 'good' | 'fair' | 'poor';
  qualityReason?: string;
}

const WORK_ITEM_TYPES = ['document', 'reply', 'decision', 'approval', 'build', 'analysis', 'meeting_outcome'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export interface CommandBarResult {
  overreach: boolean;
  message: string;
  workItemId?: string;
}

/**
 * Master Build Prompt Part F6 — Command bar pipeline. Parse intent → authority
 * check → route to a real Work Item + kick off that stakeholder's autonomous
 * work ticks (Part F4), OR realistic in-character pushback with zero state
 * change if the ask is an overreach. One LLM call does parsing, authority
 * judgment, AND delegation-quality assessment together — same "one call, not
 * several sequential ones" discipline as HyrteStakeholderAgentService.respond,
 * for the same reason (this session measured a real timeout regression from
 * chained round-trips elsewhere in this codebase).
 */
@Injectable()
export class HyrteCommandBarService {
  private readonly logger = new Logger(HyrteCommandBarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly gateway: HyrteGateway,
    private readonly evidence: EvidenceGraphService,
    private readonly decisionGraph: DecisionGraphService,
    private readonly workTicks: HyrteWorkTickService,
  ) {}

  async submit(sessionId: string, candidateId: string, instruction: string): Promise<CommandBarResult> {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id: sessionId, candidateId } });
    if (!session) throw new NotFoundException('Session not found');

    const [stakeholders, companyState] = await Promise.all([
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
    ]);
    const roster = stakeholders.map((s) => ({ key: s.id, name: s.name, role: s.role, department: s.department, authorityLevel: s.authorityLevel }));

    const result = await this.ai.completeJson<CommandParseResult>(
      [
        {
          role: 'system',
          content:
            'You are the intent parser for a workplace simulation\'s command bar. The candidate is a ' +
            `${session.role} at ${session.companyName} — they can delegate work to their colleagues, but have ` +
            'no authority over company-wide decisions (budget cuts, firing people, overriding another ' +
            'department\'s priorities, changing company policy) — those are overreach. Given the candidate\'s ' +
            'instruction, decide: is this a legitimate delegation to ONE person on the roster, or an overreach? ' +
            'Return ONLY JSON: {"isOverreach": boolean, "pushback": string (only if overreach — 1-2 sentences, ' +
            'realistic in-character pushback from whoever would push back, e.g. their manager or the person ' +
            'whose authority was overstepped), "targetStakeholderKey": string|null (only if NOT overreach — must ' +
            'match a roster key, whoever is the clear best fit), "workItemTitle": string (only if NOT overreach — ' +
            `short, concrete), "workItemType": one of ${JSON.stringify(WORK_ITEM_TYPES)}, "priority": one of ` +
            `${JSON.stringify(PRIORITIES)}, "dueInHours": int, "delegationQuality": "good"|"fair"|"poor" (did the ` +
            'candidate pick the right person with a clear, specific ask and a realistic deadline?), ' +
            '"qualityReason": string (1 sentence, why).',
        },
        {
          role: 'user',
          content:
            `Roster: ${JSON.stringify(roster)}. Company state: ${JSON.stringify(companyState ? omitMeta(companyState) : {})}. ` +
            `Candidate's instruction: "${instruction}"`,
        },
      ],
      { temperature: 0.5, maxTokens: 400 },
    );

    if (result.isOverreach || !result.targetStakeholderKey) {
      const message = result.pushback?.trim() || "That's not something I can act on — it's outside what I have authority over.";
      await this.decisionGraph.recordDecision({
        sessionId,
        actor: candidateId,
        actionType: 'command_bar.overreach',
        payload: { instruction },
        outcome: message,
      });
      this.evidence
        .createEvidence({
          hyrteSessionId: sessionId,
          candidateId,
          source: 'SIMULATION',
          type: 'SIMULATION_ACTION',
          rawText: `Command bar: "${instruction}" — flagged as overreach, no state change. Response: "${message}"`,
          behaviorContext: 'PRESSURE',
        })
        .catch((e) => this.logger.warn(e));
      return { overreach: true, message };
    }

    const target = stakeholders.find((s) => s.id === result.targetStakeholderKey);
    if (!target) {
      return { overreach: true, message: "I couldn't tell who that should go to — can you be more specific about who owns this?" };
    }

    const priority = (PRIORITIES.includes((result.priority ?? '').toLowerCase()) ? result.priority!.toUpperCase() : 'MEDIUM') as
      | 'LOW'
      | 'MEDIUM'
      | 'HIGH'
      | 'CRITICAL';
    const type = (WORK_ITEM_TYPES.includes((result.workItemType ?? '').toLowerCase()) ? result.workItemType!.toUpperCase() : 'DOCUMENT') as
      | 'DOCUMENT'
      | 'REPLY'
      | 'DECISION'
      | 'APPROVAL'
      | 'BUILD'
      | 'ANALYSIS'
      | 'MEETING_OUTCOME';
    const dueInHours = typeof result.dueInHours === 'number' && result.dueInHours > 0 ? result.dueInHours : 24;
    const title = result.workItemTitle?.trim() || instruction.slice(0, 80);

    const workItem = await this.prisma.hyrteWorkItem.create({
      data: {
        sessionId,
        title,
        type,
        priority,
        origin: 'CANDIDATE_DELEGATION',
        ownerStakeholderId: target.id,
        dueAt: new Date(Date.now() + dueInHours * 3_600_000),
        history: [
          { at: new Date().toISOString(), actor: candidateId, action: 'delegated', note: `"${instruction}" → ${target.name}` },
        ] as unknown as Prisma.InputJsonValue,
      },
    });
    this.gateway.broadcast(sessionId, { type: 'task:update', task: workItem });

    const quality = result.delegationQuality === 'good' || result.delegationQuality === 'fair' || result.delegationQuality === 'poor' ? result.delegationQuality : 'fair';
    await this.decisionGraph.recordDecision({
      sessionId,
      actor: candidateId,
      actionType: 'command_bar.delegate',
      payload: { instruction, workItemId: workItem.id, targetStakeholderId: target.id },
      reasoning: result.qualityReason,
      outcome: `Delegated "${title}" to ${target.name}`,
    });
    this.evidence
      .createEvidence({
        hyrteSessionId: sessionId,
        candidateId,
        source: 'SIMULATION',
        type: 'SIMULATION_DECISION',
        rawText: `Command bar delegation: "${instruction}" → ${target.name} (${target.role}). Delegation quality: ${quality} — ${result.qualityReason ?? ''}`,
        metadata: { delegationQuality: quality },
      })
      .catch((e) => this.logger.warn(e));

    this.workTicks.scheduleStart(workItem.id);

    return { overreach: false, message: `Sent to ${target.name}.`, workItemId: workItem.id };
  }
}

function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _s, updatedAt: _u, ...rest } = state;
  return rest;
}
