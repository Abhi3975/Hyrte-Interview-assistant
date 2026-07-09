import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, Difficulty, Prisma, ProctorEventType, ProctorSeverity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionService } from '../questions/question.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import { AIService } from '../ai/ai.service';
import { PistonClient } from './piston.client';

/** Maps a browser proctoring flag to a stored ProctorEvent type + severity. */
const FLAG_MAP: Record<string, { type: ProctorEventType; severity: ProctorSeverity }> = {
  tabSwitch: { type: ProctorEventType.TAB_SWITCH, severity: ProctorSeverity.MEDIUM },
  eyeShift: { type: ProctorEventType.LOOKING_AWAY, severity: ProctorSeverity.LOW },
  multiFace: { type: ProctorEventType.MULTIPLE_FACES, severity: ProctorSeverity.HIGH },
  aiAssist: { type: ProctorEventType.COPY_PASTE, severity: ProctorSeverity.HIGH },
  secondVoice: { type: ProctorEventType.AUDIO_ADDITIONAL_VOICE, severity: ProctorSeverity.MEDIUM },
};

export interface PracticeQuestion {
  id: string;
  title: string;
  prompt: string;
  type: string;
  category: Category;
  difficulty: Difficulty;
}

/**
 * Self-serve practice / mock-interview mode. Unlike recruiter assessments,
 * candidates start these themselves — no invitation, admin approval, or
 * one-time token. Questions come from the bank (AI-generated on demand if the
 * bank is thin), and results are scored by the same evaluation engine.
 */
@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questions: QuestionService,
    private readonly evaluation: EvaluationService,
    private readonly ai: AIService,
    private readonly piston: PistonClient,
  ) {}

  /**
   * Generate a real coding problem (stdin → stdout, with test cases) for the
   * room's compiler round, using the configured LLM. Tests include visible
   * samples and hidden cases; the whole set is returned so the stateless
   * `runCoding` can grade without a DB round-trip.
   */
  async generateCoding(topic: string, difficulty: Difficulty, kind: 'code' | 'sql' = 'code') {
    const system =
      kind === 'sql'
        ? [
            'You are a database interview problem setter.',
            'Design ONE self-contained MySQL problem. The candidate writes a SELECT.',
            'The starter.sql MUST contain the full schema: CREATE TABLE + INSERT rows,',
            'followed by a comment "-- Write your SELECT query below".',
            'Each test runs the ENTIRE script (schema + the candidate query) and the',
            'expected output is MySQL tab-separated rows WITH the column header line',
            '(exactly as the mysql CLI prints: header row, then rows, tab-delimited).',
            'Since the schema is fixed, use 1 visible sample + 1 hidden test (input="").',
            'Return ONLY JSON: { title:string; statement:string; inputFormat:string;',
            'outputFormat:string; starter:{ sql:string };',
            'tests:{ input:string; output:string; hidden:boolean }[] }',
          ].join(' ')
        : [
            'You are a competitive-programming problem setter.',
            'Design ONE self-contained coding problem the candidate solves by reading',
            'from STDIN and printing to STDOUT (no function signatures).',
            'Provide 4 test cases: 2 visible samples + 2 hidden. Keep it solvable in the',
            'given difficulty. Return ONLY JSON of this TypeScript type:',
            '{ title:string; statement:string; inputFormat:string; outputFormat:string;',
            'starter:{ python:string; javascript:string; java:string; cpp:string };',
            'tests:{ input:string; output:string; hidden:boolean }[] }',
            'Each test input/output is the exact stdin/stdout text (use \\n for newlines).',
          ].join(' ');
    const user = `Topic: ${topic}\nDifficulty: ${difficulty}`;
    const problem = await this.ai.completeJson<{
      title: string; statement: string; inputFormat: string; outputFormat: string;
      starter: Record<string, string>;
      tests: { input: string; output: string; hidden: boolean }[];
    }>([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { temperature: 0.4, maxTokens: 1600 });

    problem.tests = (problem.tests ?? []).slice(0, 6);
    return problem;
  }

  /** Execute candidate code against test cases via the Piston sandbox. */
  async runCoding(
    language: string,
    code: string,
    tests: { input: string; output: string; hidden?: boolean }[],
  ) {
    if (!this.piston.supports(language)) {
      throw new BadRequestException(`Language "${language}" is not runnable. Use python, javascript, java, cpp or go.`);
    }
    const norm = (s: string) => s.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();
    const results = [];
    let passed = 0;
    for (let i = 0; i < tests.length; i++) {
      const t = tests[i];
      try {
        const out = await this.piston.run(language, code, t.input ?? '');
        const ok = !out.compileError && norm(out.stdout) === norm(t.output ?? '');
        if (ok) passed++;
        results.push({
          ordinal: i,
          passed: ok,
          hidden: Boolean(t.hidden),
          status: out.compileError ? 'Compile Error' : ok ? 'Passed' : out.stderr ? 'Runtime Error' : 'Wrong Answer',
          stderr: out.compileError || out.stderr || null,
          ...(t.hidden ? {} : { expected: t.output, actual: out.stdout }),
        });
      } catch (err) {
        results.push({ ordinal: i, passed: false, hidden: Boolean(t.hidden), status: 'Execution Error', stderr: String(err).slice(0, 200) });
      }
    }
    return { passed, total: tests.length, results };
  }

  /**
   * Pull a mock-interview question set for a SPECIFIC topic (e.g. "React",
   * "Node.js", "Python") within a category. Matches the bank on topic/tags
   * first; if there aren't enough topic-specific questions, generates fresh
   * ones with AI so every technology gets a real, relevant interview.
   */
  async start(
    category: Category,
    difficulty: Difficulty,
    count = 5,
    topic?: string,
  ): Promise<PracticeQuestion[]> {
    const chosen: PracticeQuestion[] = [];

    if (topic) {
      // Topic-specific matches (title/topic/tags contain the topic term).
      const matches = await this.prisma.reader.question.findMany({
        where: {
          category,
          isActive: true,
          moderation: { in: ['APPROVED', 'AUTO_APPROVED'] },
          OR: [
            { topic: { contains: topic, mode: 'insensitive' } },
            { title: { contains: topic, mode: 'insensitive' } },
            { tags: { has: topic } },
          ],
        },
        select: { id: true, title: true, prompt: true, type: true, category: true, difficulty: true },
        take: 40,
      });
      chosen.push(...shuffle(matches).slice(0, count));
    }

    // Generate topic-specific questions to fill the gap (needs an AI key).
    if (chosen.length < count) {
      try {
        const generated = await this.questions.generate(
          { category, topic: topic ?? category.toString(), difficulty, count: count - chosen.length },
          null,
        );
        for (const g of generated) {
          chosen.push({ id: g.id, title: g.title, prompt: g.prompt, type: g.type, category: g.category, difficulty: g.difficulty });
        }
      } catch {
        // fall through to category fallback
      }
    }

    // Last resort: any question in the category so we never return empty.
    if (chosen.length < count) {
      const any = await this.prisma.reader.question.findMany({
        where: { category, isActive: true, moderation: { in: ['APPROVED', 'AUTO_APPROVED'] } },
        select: { id: true, title: true, prompt: true, type: true, category: true, difficulty: true },
        take: 40,
      });
      const have = new Set(chosen.map((c) => c.id));
      chosen.push(...shuffle(any).filter((q) => !have.has(q.id)).slice(0, count - chosen.length));
    }

    return chosen.slice(0, count);
  }

  /**
   * Create a persisted session for the proctored interview room so its flags,
   * transcript and score are recorded and reviewable afterwards. Self-serve
   * candidates have no org, so all practice interviews hang off one shared
   * "self-serve practice" organization (created on demand — no migration).
   */
  async startSession(
    candidateId: string,
    input: { category: Category; difficulty: Difficulty; topic?: string; jobRole?: string },
  ): Promise<{ sessionId: string }> {
    const jobRole = input.jobRole ?? input.topic ?? `${input.category} candidate`;
    const title = `${jobRole} · ${input.difficulty} (AI room)`;

    const org =
      (await this.prisma.organization.findUnique({ where: { slug: 'self-serve-practice' } })) ??
      (await this.prisma.organization.create({
        data: { name: 'Self-serve Practice', slug: 'self-serve-practice' },
      }));

    const interview =
      (await this.prisma.interview.findFirst({
        where: { organizationId: org.id, title, category: input.category, difficulty: input.difficulty },
      })) ??
      (await this.prisma.interview.create({
        data: {
          organizationId: org.id,
          title,
          jobRole,
          category: input.category,
          difficulty: input.difficulty,
          status: 'SCHEDULED',
          createdById: candidateId,
          config: { selfServe: true, proctored: true },
        },
      }));

    const session = await this.prisma.interviewSession.create({
      data: {
        interviewId: interview.id,
        candidateId,
        status: 'IN_PROGRESS',
        examState: 'ACTIVE',
        startedAt: new Date(),
      },
      select: { id: true },
    });
    return { sessionId: session.id };
  }

  /**
   * Persist a completed room session: store the transcript + proctoring flags,
   * score it, and save the evaluation. Returns the evaluation for the UI.
   */
  async completeSession(
    candidateId: string,
    sessionId: string,
    input: {
      category: Category;
      difficulty: Difficulty;
      jobRole?: string;
      answers: { prompt: string; response: string }[];
      flags?: Record<string, number>;
      integrity?: number;
    },
  ) {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: { interview: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidateId) throw new ForbiddenException('Not your session');

    const evaluation = await this.evaluation.evaluateTranscript(
      {
        jobRole: input.jobRole ?? session.interview.jobRole,
        category: input.category,
        difficulty: input.difficulty,
      },
      input.answers,
    );

    // One ProctorEvent per triggered flag, carrying its count in the payload.
    const events: Prisma.ProctorEventCreateManyInput[] = [];
    for (const [key, count] of Object.entries(input.flags ?? {})) {
      const map = FLAG_MAP[key];
      if (map && count > 0) {
        events.push({ sessionId, type: map.type, severity: map.severity, payload: { count } });
      }
    }
    const integrity = Math.max(0, Math.min(100, Math.round(input.integrity ?? 100)));

    await this.prisma.$transaction(async (tx) => {
      if (events.length) await tx.proctorEvent.createMany({ data: events });
      await tx.interviewSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          examState: 'COMPLETED',
          completedAt: new Date(),
          riskScore: 100 - integrity,
          transcript: { answers: input.answers, flags: input.flags ?? {}, integrity } as Prisma.InputJsonValue,
        },
      });
      await tx.evaluation.upsert({
        where: { sessionId },
        create: {
          sessionId,
          overallScore: evaluation.overallScore,
          competencies: evaluation.competencies,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
          summary: evaluation.summary,
          recommendation: evaluation.recommendation,
        },
        update: {
          overallScore: evaluation.overallScore,
          competencies: evaluation.competencies,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
          summary: evaluation.summary,
          recommendation: evaluation.recommendation,
        },
      });
    });

    return evaluation;
  }

  /** Score a completed mock interview and return decision-ready feedback. */
  async evaluate(input: {
    category: Category;
    difficulty: Difficulty;
    jobRole?: string;
    answers: { prompt: string; response: string }[];
  }) {
    return this.evaluation.evaluateTranscript(
      {
        jobRole: input.jobRole ?? `${input.category} candidate`,
        category: input.category,
        difficulty: input.difficulty,
      },
      input.answers,
    );
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
