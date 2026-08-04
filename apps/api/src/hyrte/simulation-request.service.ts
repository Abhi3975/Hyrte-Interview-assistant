import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { HyrteSessionsService } from './hyrte-sessions.service';
import { CreateSimulationRequestDto, PreviewSimulationRequestDto } from './dto/hyrte.dto';

export interface DecomposedJd {
  role?: string;
  coreOutcomes?: string[];
  capabilityRequirements?: { skill: string; importance: 'critical' | 'high' | 'medium'; depth?: string }[];
  industryProbeThemes?: string[];
  suggestedSeed?: {
    experienceLevel?: string;
    industry?: string;
    companyType?: string;
    difficulty?: 'EASY' | 'MEDIUM' | 'HARD' | 'EXPERT';
    culture?: string;
  };
}

/**
 * Upgrade §1 — the entry point. A real, recruiter-authored JD is decomposed
 * into a Job Success Model + six seed suggestions (LLM-suggested, always
 * editable — never persisted until the recruiter confirms via `create`).
 * `create` mints a shareable code; a candidate resolves it (pre-login OK) and
 * `launch`es a session grounded in this decomposition, not just six free-
 * picked labels. Self-serve PRACTICE sessions from /hyrte are untouched by
 * any of this — this is a parallel, additive entry point, not a replacement.
 */
@Injectable()
export class SimulationRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly sessions: HyrteSessionsService,
  ) {}

  async preview(dto: PreviewSimulationRequestDto): Promise<DecomposedJd> {
    return this.decompose(dto.jobDescriptionText, dto.companyContext);
  }

  async create(recruiterId: string, dto: CreateSimulationRequestDto) {
    const code = randomBytes(6).toString('base64url');
    return this.prisma.hyrteSimulationRequest.create({
      data: {
        createdById: recruiterId,
        code,
        jobDescriptionRaw: dto.jobDescriptionText,
        companyContextRaw: dto.companyContext,
        role: dto.role,
        coreOutcomes: dto.coreOutcomes,
        capabilityRequirements: dto.capabilityRequirements as unknown as Prisma.InputJsonValue,
        industryContext: { probeThemes: dto.industryProbeThemes } as Prisma.InputJsonValue,
        companyContext: {} as Prisma.InputJsonValue,
        experienceLevel: dto.experienceLevel,
        industry: dto.industry,
        companyType: dto.companyType,
        difficulty: dto.difficulty,
        culture: dto.culture,
      },
    });
  }

  async listMine(recruiterId: string) {
    return this.prisma.hyrteSimulationRequest.findMany({
      where: { createdById: recruiterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Candidate-facing preview — deliberately excludes jobDescriptionRaw/companyContextRaw (recruiter's own text, not needed candidate-side). */
  async getByCode(code: string) {
    const request = await this.prisma.hyrteSimulationRequest.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        status: true,
        role: true,
        coreOutcomes: true,
        experienceLevel: true,
        industry: true,
        companyType: true,
        difficulty: true,
        culture: true,
        expiresAt: true,
      },
    });
    if (!request) throw new NotFoundException('Invalid simulation link');
    if (request.expiresAt && request.expiresAt < new Date()) throw new BadRequestException('This simulation link has expired');
    if (request.status === 'EXPIRED') throw new BadRequestException('This simulation link has expired');
    return request;
  }

  async launch(code: string, candidateId: string) {
    const request = await this.prisma.hyrteSimulationRequest.findUnique({ where: { code } });
    if (!request) throw new NotFoundException('Invalid simulation link');
    if (request.expiresAt && request.expiresAt < new Date()) throw new BadRequestException('This simulation link has expired');
    if (request.status === 'EXPIRED') throw new BadRequestException('This simulation link has expired');
    // Deliberately not single-use: one recruiter-shared link may be sent to
    // several candidates for the same role (an assessment, not a 1:1 invite).
    return this.sessions.createFromSimulationRequest(request, candidateId);
  }

  private async decompose(jobDescriptionText: string, companyContextText: string | undefined): Promise<DecomposedJd> {
    const userContent =
      `Job description:\n${jobDescriptionText.trim().slice(0, 6000)}` +
      (companyContextText?.trim() ? `\n\nCompany/industry context:\n${companyContextText.trim().slice(0, 2000)}` : '');
    return this.ai.completeJson<DecomposedJd>(
      [
        {
          role: 'system',
          content:
            'Decompose this into a Job Success Model for a hiring-simulation platform — read the actual ' +
            'text, do not keyword-match. Return ONLY JSON: {"role": string (job title, inferred), ' +
            '"coreOutcomes": string[] (3-5, what this role must actually accomplish), ' +
            '"capabilityRequirements": [{"skill": string, "importance": "critical"|"high"|"medium", ' +
            '"depth": string}] (4-8 entries), "industryProbeThemes": string[] (3-5 themes specific to ' +
            'this industry, e.g. SaaS->churn/activation/ARR, fintech->risk/compliance/fraud), ' +
            '"suggestedSeed": {"experienceLevel": one of "Intern"|"Junior"|"Mid"|"Senior"|"Lead/Manager", ' +
            '"industry": one of "SaaS"|"Healthcare"|"E-commerce"|"Manufacturing"|"Banking" (closest match), ' +
            '"companyType": one of "Startup"|"SME"|"Enterprise"|"Consulting"|"Government" (closest match), ' +
            '"difficulty": one of "EASY"|"MEDIUM"|"HARD"|"EXPERT" (infer from seniority bar), ' +
            '"culture": a short 2-4 word culture phrase (e.g. "Customer-obsessed", "Engineering-driven")}}.',
        },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.4, maxTokens: 900 },
    );
  }
}
