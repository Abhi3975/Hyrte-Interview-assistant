import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionClient, ExecResult } from './execution.client';
import {
  fingerprints,
  fingerprintString,
  parseFingerprint,
  similarity,
  tokenize,
} from './plagiarism';

interface CaseResult {
  ordinal: number;
  passed: boolean;
  hidden: boolean;
  status: string;
  timeMs: number | null;
  // Expected/actual are only exposed for non-hidden (sample) cases.
  expected?: string;
  actual?: string | null;
}

export interface GradeResult {
  status: SubmissionStatus;
  passed: number;
  total: number;
  results: CaseResult[];
  runtimeMs: number | null;
  submissionId?: string;
  similarity?: number | null;
}

// A submission at/above this similarity is flagged for reviewer attention.
const PLAGIARISM_THRESHOLD = 0.85;

@Injectable()
export class CodingService {
  private readonly logger = new Logger(CodingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exec: ExecutionClient,
  ) {}

  async runOrSubmit(params: {
    sessionId: string;
    questionId: string;
    language: string;
    code: string;
    submit: boolean;
    candidateId: string;
  }): Promise<GradeResult> {
    if (!this.exec.isAvailable()) {
      throw new BadRequestException('Code execution engine is not configured');
    }
    // Guard: only an active session's owner may execute.
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: params.sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== params.candidateId) {
      throw new BadRequestException('Not your session');
    }

    const question = await this.prisma.question.findUnique({
      where: { id: params.questionId },
      include: { testCases: { orderBy: { ordinal: 'asc' } } },
    });
    if (!question) throw new NotFoundException('Question not found');

    // "run" uses only sample (non-hidden) cases; "submit" uses all.
    const cases = params.submit
      ? question.testCases
      : question.testCases.filter((t) => !t.isHidden);
    if (cases.length === 0) throw new BadRequestException('No test cases available');

    const results: CaseResult[] = [];
    let passed = 0;
    let maxTime = 0;
    let terminal: SubmissionStatus = SubmissionStatus.ACCEPTED;

    for (const tc of cases) {
      let exec: ExecResult;
      try {
        exec = await this.exec.run({
          language: params.language,
          source: params.code,
          stdin: tc.input,
          expectedOutput: tc.output,
        });
      } catch (err) {
        this.logger.warn(`Execution failed: ${err}`);
        terminal = SubmissionStatus.ERROR;
        results.push({ ordinal: tc.ordinal, passed: false, hidden: tc.isHidden, status: 'Execution Error', timeMs: null });
        continue;
      }

      const ok = exec.status === 'Accepted' || this.matches(exec.stdout, tc.output);
      if (ok) passed++;
      else terminal = this.mapStatus(exec.status);
      if (exec.timeMs) maxTime = Math.max(maxTime, exec.timeMs);

      results.push({
        ordinal: tc.ordinal,
        passed: ok,
        hidden: tc.isHidden,
        status: exec.status,
        timeMs: exec.timeMs,
        // Never leak hidden-case expected output.
        ...(tc.isHidden ? {} : { expected: tc.output, actual: exec.stdout }),
      });
    }

    const status: SubmissionStatus =
      passed === cases.length ? SubmissionStatus.ACCEPTED : terminal === SubmissionStatus.ACCEPTED ? SubmissionStatus.WRONG_ANSWER : terminal;

    const grade: GradeResult = {
      status,
      passed,
      total: cases.length,
      results,
      runtimeMs: maxTime || null,
    };

    // Persist + plagiarism-check only on real submissions.
    if (params.submit) {
      const fps = fingerprints(tokenize(params.code, params.language));
      const sim = await this.checkPlagiarism(params.questionId, params.sessionId, fps);
      const saved = await this.prisma.codingSubmission.create({
        data: {
          sessionId: params.sessionId,
          questionId: params.questionId,
          language: params.language,
          code: params.code,
          status,
          results: results as object[],
          passed,
          total: cases.length,
          runtimeMs: maxTime || null,
          fingerprint: fingerprintString(fps),
          similarity: sim,
        },
      });
      grade.submissionId = saved.id;
      grade.similarity = sim;
    }

    return grade;
  }

  /** Compare against prior submissions for the same question (other sessions). */
  private async checkPlagiarism(
    questionId: string,
    sessionId: string,
    fps: Set<string>,
  ): Promise<number | null> {
    const others = await this.prisma.codingSubmission.findMany({
      where: { questionId, sessionId: { not: sessionId }, fingerprint: { not: null } },
      select: { fingerprint: true },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });
    let max = 0;
    for (const o of others) {
      const sim = similarity(fps, parseFingerprint(o.fingerprint));
      if (sim > max) max = sim;
    }
    if (max >= PLAGIARISM_THRESHOLD) {
      // Raise a proctoring signal so it feeds the risk engine as evidence.
      await this.prisma.proctorEvent.create({
        data: {
          sessionId,
          type: 'PLAGIARISM_FLAG',
          severity: 'HIGH',
          payload: { similarity: max, questionId },
          provider: 'internal',
        },
      });
    }
    return Math.round(max * 100) / 100;
  }

  private matches(stdout: string | null, expected: string): boolean {
    return (stdout ?? '').trim() === expected.trim();
  }

  private mapStatus(judge0Status: string): SubmissionStatus {
    const s = judge0Status.toLowerCase();
    if (s.includes('compilation')) return SubmissionStatus.COMPILE_ERROR;
    if (s.includes('time limit')) return SubmissionStatus.TIME_LIMIT_EXCEEDED;
    if (s.includes('runtime')) return SubmissionStatus.RUNTIME_ERROR;
    if (s.includes('wrong')) return SubmissionStatus.WRONG_ANSWER;
    return SubmissionStatus.ERROR;
  }
}
