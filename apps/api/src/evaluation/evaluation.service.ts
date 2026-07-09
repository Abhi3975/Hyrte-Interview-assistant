import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Recommendation } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';

/** Competency dimensions scored by the engine (0-100 each). */
const COMPETENCIES = [
  'communication',
  'technicalAccuracy',
  'confidence',
  'problemSolving',
  'leadership',
  'behavioral',
] as const;

export interface PerQuestionScore {
  /** 0-5 score for this answer (Koyo-style "4/5"). */
  score: number;
  max: number;
  notes: string;
}

export interface EvaluationJson {
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: Recommendation;
  /** Per-question breakdown (self-serve practice only; not persisted). */
  perQuestion?: PerQuestionScore[];
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  /**
   * Evaluate a completed session. Aggregates every answer + the interview
   * context, asks the model for a strict-JSON assessment, then persists it.
   * Idempotent: re-running replaces the prior evaluation.
   */
  async evaluateSession(sessionId: string): Promise<EvaluationJson> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        interview: true,
        answers: { include: { interviewQuestion: { include: { question: true } } } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const transcript = session.answers
      .map((a, i) => {
        const q = a.interviewQuestion.question;
        const response = a.code
          ? `Code (${a.language}):\n${a.code}`
          : a.responseText ?? '(no answer)';
        return `Q${i + 1} [${q.category}/${q.difficulty}]: ${q.prompt}\nExpected: ${
          q.expectedAnswer ?? 'open-ended'
        }\nCandidate: ${response}`;
      })
      .join('\n\n');

    const system = [
      'You are a rigorous, fair senior technical interviewer.',
      'Score each competency 0-100. Be evidence-based and avoid bias.',
      'Return ONLY JSON matching this TypeScript type:',
      `{ overallScore:number; competencies:{ ${COMPETENCIES.map((c) => `${c}:number`).join('; ')} };`,
      'strengths:string[]; weaknesses:string[]; summary:string;',
      'recommendation:"STRONG_HIRE"|"HIRE"|"LEAN_HIRE"|"NO_HIRE"|"STRONG_NO_HIRE" }',
    ].join(' ');

    const user = `Role: ${session.interview.jobRole}\nCategory: ${session.interview.category}\nDifficulty: ${session.interview.difficulty}\n\nTranscript:\n${transcript}`;

    let result: EvaluationJson;
    try {
      result = await this.ai.completeJson<EvaluationJson>(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        { temperature: 0.2, maxTokens: 1500 },
      );
    } catch (err) {
      this.logger.error(`Evaluation failed for ${sessionId}: ${err}`);
      throw err;
    }

    const normalized = this.normalize(result);

    await this.prisma.evaluation.upsert({
      where: { sessionId },
      create: {
        sessionId,
        overallScore: normalized.overallScore,
        competencies: normalized.competencies,
        strengths: normalized.strengths,
        weaknesses: normalized.weaknesses,
        summary: normalized.summary,
        recommendation: normalized.recommendation,
        modelMeta: { providers: this.ai.availableProviders() },
      },
      update: {
        overallScore: normalized.overallScore,
        competencies: normalized.competencies,
        strengths: normalized.strengths,
        weaknesses: normalized.weaknesses,
        summary: normalized.summary,
        recommendation: normalized.recommendation,
      },
    });

    return normalized;
  }

  /**
   * Stateless evaluation used by self-serve practice mode. Takes an explicit
   * Q&A transcript (no DB session) and returns the scored assessment.
   */
  async evaluateTranscript(
    context: { jobRole: string; category: string; difficulty: string },
    items: { prompt: string; response: string }[],
  ): Promise<EvaluationJson> {
    const transcript = items
      .map((it, i) => `Q${i + 1}: ${it.prompt}\nCandidate: ${it.response || '(no answer)'}`)
      .join('\n\n');

    const system = [
      'You are a rigorous, fair senior technical interviewer and confidence coach.',
      'Score each competency 0-100. Be evidence-based, specific, and avoid bias.',
      'In weaknesses, give actionable guidance the candidate can use to improve.',
      'Also grade EACH question 0-5 with a one-line note; perQuestion MUST have',
      'exactly one entry per question, in order.',
      'Return ONLY JSON matching this TypeScript type:',
      `{ overallScore:number; competencies:{ ${COMPETENCIES.map((c) => `${c}:number`).join('; ')} };`,
      'strengths:string[]; weaknesses:string[]; summary:string;',
      'perQuestion:{ score:number; max:number; notes:string }[];',
      'recommendation:"STRONG_HIRE"|"HIRE"|"LEAN_HIRE"|"NO_HIRE"|"STRONG_NO_HIRE" }',
    ].join(' ');
    const user = `Role: ${context.jobRole}\nCategory: ${context.category}\nDifficulty: ${context.difficulty}\n\nTranscript:\n${transcript}`;

    const result = await this.ai.completeJson<EvaluationJson>(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.2, maxTokens: 1800 },
    );
    return this.normalize(result, items.length);
  }

  async getBySession(sessionId: string) {
    const evaluation = await this.prisma.evaluation.findUnique({ where: { sessionId } });
    if (!evaluation) throw new NotFoundException('Evaluation not ready');
    return evaluation;
  }

  /** Clamp scores into range and guard against a missing recommendation. */
  private normalize(raw: EvaluationJson, questionCount?: number): EvaluationJson {
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const competencies: Record<string, number> = {};
    for (const key of COMPETENCIES) competencies[key] = clamp(raw.competencies?.[key] ?? 0);
    const valid: Recommendation[] = [
      'STRONG_HIRE',
      'HIRE',
      'LEAN_HIRE',
      'NO_HIRE',
      'STRONG_NO_HIRE',
    ];
    const normalized: EvaluationJson = {
      overallScore: clamp(raw.overallScore),
      competencies,
      strengths: (raw.strengths ?? []).slice(0, 10),
      weaknesses: (raw.weaknesses ?? []).slice(0, 10),
      summary: raw.summary ?? '',
      recommendation: valid.includes(raw.recommendation) ? raw.recommendation : 'NO_HIRE',
    };
    if (questionCount && questionCount > 0) {
      const clamp5 = (n: number) => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      const src = Array.isArray(raw.perQuestion) ? raw.perQuestion : [];
      normalized.perQuestion = Array.from({ length: questionCount }, (_, i) => ({
        score: clamp5(src[i]?.score ?? 0),
        max: 5,
        notes: (src[i]?.notes ?? '').toString().slice(0, 400),
      }));
    }
    return normalized;
  }
}
