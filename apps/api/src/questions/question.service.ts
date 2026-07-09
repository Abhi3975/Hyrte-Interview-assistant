import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Category, Difficulty, Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import {
  GenerateQuestionDto,
  QuestionQueryDto,
  SubmitQuestionDto,
} from './dto/question.dto';

@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  /** Read path — served from the replica to keep the writer free. */
  async list(query: QuestionQueryDto, organizationId: string | null) {
    const where: Prisma.QuestionWhereInput = {
      isActive: true,
      moderation: { in: ['APPROVED', 'AUTO_APPROVED'] },
      // Org sees its own private questions + all public (org-less) ones.
      OR: [{ organizationId: null }, { organizationId: organizationId ?? undefined }],
      ...(query.category ? { category: query.category } : {}),
      ...(query.difficulty ? { difficulty: query.difficulty } : {}),
      ...(query.topic ? { topic: { contains: query.topic, mode: 'insensitive' } } : {}),
      ...(query.search
        ? { OR: [{ title: { contains: query.search, mode: 'insensitive' } }, { prompt: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.reader.question.findMany({
        where,
        take: query.take ?? 25,
        skip: query.skip ?? 0,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          publicId: true,
          title: true,
          category: true,
          topic: true,
          difficulty: true,
          type: true,
          tags: true,
          source: true,
        },
      }),
      this.prisma.reader.question.count({ where }),
    ]);
    return { items, total };
  }

  async getById(id: string) {
    const q = await this.prisma.question.findUnique({
      where: { id },
      include: { testCases: true, license: true },
    });
    if (!q) throw new NotFoundException('Question not found');
    return q;
  }

  /**
   * User-submitted question. Stored as USER_SUBMITTED with a USER_GRANTED
   * license and PENDING moderation — never shown to candidates until approved.
   */
  async submit(dto: SubmitQuestionDto, userId: string, organizationId: string | null) {
    const license = await this.prisma.license.create({
      data: {
        type: 'USER_GRANTED',
        sourceName: `User submission: ${userId}`,
      },
    });

    return this.prisma.question.create({
      data: {
        publicId: this.publicId(dto.category, dto.topic),
        title: dto.title,
        prompt: dto.prompt,
        category: dto.category,
        topic: dto.topic,
        difficulty: dto.difficulty,
        type: dto.type,
        tags: dto.tags ?? [],
        followUps: dto.followUps ?? [],
        expectedAnswer: dto.expectedAnswer,
        source: 'USER_SUBMITTED',
        licenseId: license.id,
        contentHash: this.hash(dto.prompt),
        moderation: 'PENDING',
        submittedById: userId,
        organizationId,
      },
    });
  }

  async moderate(id: string, decision: 'APPROVED' | 'REJECTED') {
    const q = await this.prisma.question.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Question not found');
    return this.prisma.question.update({
      where: { id },
      data: { moderation: decision, isActive: decision === 'APPROVED' },
    });
  }

  async pendingModeration(organizationId: string | null) {
    return this.prisma.question.findMany({
      where: { moderation: 'PENDING', organizationId: organizationId ?? undefined },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Dynamic AI generation. Output is licensed AI_GENERATED (no third-party
   * rights) and auto-approved. Produces a full record incl. rubric + follow-ups.
   */
  async generate(dto: GenerateQuestionDto, organizationId: string | null) {
    const count = dto.count ?? 1;
    const type = dto.type ?? 'SHORT_ANSWER';

    const generated = await this.ai.completeJson<{
      questions: {
        title: string;
        prompt: string;
        expectedAnswer: string;
        rubric: { criterion: string; weight: number }[];
        followUps: string[];
        tags: string[];
      }[];
    }>(
      [
        {
          role: 'system',
          content:
            'You are an expert interview designer. Generate original interview questions with a scoring rubric and follow-ups. ' +
            'Return JSON {questions:[{title,prompt,expectedAnswer,rubric:[{criterion,weight}],followUps:string[],tags:string[]}]}.',
        },
        {
          role: 'user',
          content: `Generate ${count} ${dto.difficulty} ${dto.category} questions on "${dto.topic}"${
            dto.jobRole ? ` for a ${dto.jobRole} role` : ''
          }. Type: ${type}.`,
        },
      ],
      { temperature: 0.7, maxTokens: 2000 },
    );

    const created = [];
    for (const g of generated.questions ?? []) {
      const license = await this.prisma.license.create({
        data: { type: 'AI_GENERATED', sourceName: 'InterviewAI generation engine' },
      });
      const q = await this.prisma.question.create({
        data: {
          publicId: this.publicId(dto.category, dto.topic),
          title: g.title,
          prompt: g.prompt,
          category: dto.category,
          topic: dto.topic,
          difficulty: dto.difficulty,
          type,
          tags: g.tags ?? [],
          followUps: g.followUps ?? [],
          expectedAnswer: g.expectedAnswer,
          rubric: g.rubric ?? [],
          source: 'AI_GENERATED',
          licenseId: license.id,
          contentHash: this.hash(g.prompt),
          moderation: 'AUTO_APPROVED',
          organizationId,
        },
      });
      created.push(q);
    }
    return created;
  }

  private hash(prompt: string): string {
    const canonical = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return createHash('sha256').update(canonical).digest('hex');
  }

  private publicId(category: Category, topic: string): string {
    const slug = topic.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'GEN';
    const rand = createHash('sha1')
      .update(`${Date.now()}${Math.random()}`)
      .digest('hex')
      .slice(0, 6)
      .toUpperCase();
    return `${category}-${slug}-${rand}`;
  }
}
