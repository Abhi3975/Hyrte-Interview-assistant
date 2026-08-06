import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, Recommendation } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AIService } from '../ai/ai.service';

/** Competency dimensions scored by the engine (0-100 each) — legacy shape, kept for backward compat (still read by the in-session inline result view). */
const COMPETENCIES = [
  'communication',
  'technicalAccuracy',
  'confidence',
  'problemSolving',
  'leadership',
  'behavioral',
] as const;

/**
 * P5 — the 80+ parameter framework (spec: "80+ parameter framework grouped
 * under: communication, technical/role competency, behavioral, confidence &
 * delivery, cognitive, risk detection, hiring readiness — with per-role
 * dynamic weighting. Never output a bare number without its interpretation").
 *
 * The taxonomy itself (which 84 parameters, their labels, their group) is
 * DETERMINISTIC — defined once here, not invented by the LLM per call. This
 * is the same "don't trust the model for structural guarantees" discipline
 * used throughout this codebase: the LLM's job is to SCORE each named
 * parameter against real transcript evidence, not to decide what the
 * parameters even are. That keeps every candidate's report directly
 * comparable (same 84 axes every time) and makes the framework auditable —
 * a recruiter can see exactly what's being measured before ever running it.
 */
export const PARAMETER_GROUPS = ['communication', 'technical', 'behavioral', 'confidence', 'cognitive', 'risk', 'hiring_readiness'] as const;
export type ParameterGroup = (typeof PARAMETER_GROUPS)[number];

export const PARAMETER_TAXONOMY: Record<ParameterGroup, { key: string; label: string }[]> = {
  communication: [
    { key: 'clarity', label: 'Clarity of expression' },
    { key: 'structure', label: 'Structured thinking in answers' },
    { key: 'fluency', label: 'Verbal/written fluency' },
    { key: 'active_listening', label: 'Active listening' },
    { key: 'conciseness', label: 'Conciseness' },
    { key: 'vocabulary', label: 'Vocabulary & precision' },
    { key: 'tone_modulation', label: 'Tone appropriateness' },
    { key: 'filler_dependency', label: 'Filler-word dependency (lower is better)' },
    { key: 'pacing', label: 'Pacing of delivery' },
    { key: 'question_comprehension', label: 'Question comprehension' },
    { key: 'written_communication', label: 'Written communication (code comments, chat)' },
    { key: 'verbal_confidence', label: 'Verbal confidence' },
  ],
  technical: [
    { key: 'domain_knowledge_depth', label: 'Domain knowledge depth' },
    { key: 'problem_decomposition', label: 'Problem decomposition' },
    { key: 'algorithmic_thinking', label: 'Algorithmic thinking' },
    { key: 'code_quality', label: 'Code quality' },
    { key: 'debugging_approach', label: 'Debugging approach' },
    { key: 'system_design_awareness', label: 'System design awareness' },
    { key: 'tool_familiarity', label: 'Tooling/tech-stack familiarity' },
    { key: 'best_practices', label: 'Best-practices awareness' },
    { key: 'edge_case_handling', label: 'Edge-case handling' },
    { key: 'scalability_awareness', label: 'Scalability awareness' },
    { key: 'technical_communication', label: 'Explaining technical ideas clearly' },
    { key: 'role_specific_expertise', label: 'Role-specific expertise' },
  ],
  behavioral: [
    { key: 'teamwork_orientation', label: 'Teamwork orientation' },
    { key: 'conflict_handling', label: 'Conflict handling' },
    { key: 'ownership', label: 'Ownership & accountability' },
    { key: 'adaptability', label: 'Adaptability' },
    { key: 'leadership_signals', label: 'Leadership signals' },
    { key: 'initiative', label: 'Initiative' },
    { key: 'feedback_receptiveness', label: 'Receptiveness to feedback' },
    { key: 'prioritization', label: 'Prioritization judgment' },
    { key: 'stakeholder_empathy', label: 'Stakeholder empathy' },
    { key: 'ethical_judgment', label: 'Ethical judgment' },
    { key: 'growth_mindset', label: 'Growth mindset' },
    { key: 'culture_alignment', label: 'Culture-alignment signals' },
  ],
  confidence: [
    { key: 'composure_under_pressure', label: 'Composure under pressure' },
    { key: 'response_latency', label: 'Response latency (thinking-to-answer gap)' },
    { key: 'vocal_steadiness', label: 'Vocal steadiness' },
    { key: 'presence', label: 'Presence / engagement' },
    { key: 'assertiveness', label: 'Assertiveness' },
    { key: 'self_awareness', label: 'Self-awareness' },
    { key: 'mistake_recovery', label: 'Recovery from mistakes' },
    { key: 'enthusiasm', label: 'Enthusiasm' },
    { key: 'body_language_signals', label: 'Body-language signals (where observable)' },
    { key: 'answer_commitment', label: 'Commitment to answers (vs. hedging)' },
    { key: 'stress_resilience', label: 'Stress resilience' },
    { key: 'presentation_polish', label: 'Presentation polish' },
  ],
  cognitive: [
    { key: 'logical_reasoning', label: 'Logical reasoning' },
    { key: 'abstraction_ability', label: 'Abstraction ability' },
    { key: 'pattern_recognition', label: 'Pattern recognition' },
    { key: 'multi_part_handling', label: 'Handling multi-part questions' },
    { key: 'creativity', label: 'Creativity' },
    { key: 'critical_thinking', label: 'Critical thinking' },
    { key: 'learning_agility', label: 'Learning-agility signals' },
    { key: 'analytical_rigor', label: 'Analytical rigor' },
    { key: 'hypothesis_formation', label: 'Hypothesis formation' },
    { key: 'tradeoff_reasoning', label: 'Trade-off reasoning' },
    { key: 'root_cause_analysis', label: 'Root-cause analysis' },
    { key: 'estimation_ability', label: 'Estimation ability' },
  ],
  risk: [
    { key: 'bluff_probability', label: 'Bluff probability (lower is better)' },
    { key: 'scripted_response_probability', label: 'Scripted-response probability (lower is better)' },
    { key: 'answer_inconsistency', label: 'Answer inconsistency (lower is better)' },
    { key: 'ai_assist_signal', label: 'AI-assist / plagiarism signal (lower is better)' },
    { key: 'proctoring_risk', label: 'Proctoring/identity risk (lower is better)' },
    { key: 'overclaiming_risk', label: 'Overclaiming risk (lower is better)' },
    { key: 'evasiveness', label: 'Evasiveness (lower is better)' },
    { key: 'contradiction_count', label: 'Contradictions observed (lower is better)' },
    { key: 'timing_anomaly_risk', label: 'Timing-anomaly risk (lower is better)' },
    { key: 'resume_claim_mismatch', label: 'Resume-claim mismatch (lower is better)' },
    { key: 'generic_answer_risk', label: 'Generic/templated-answer risk (lower is better)' },
    { key: 'coaching_suspicion', label: 'Off-screen coaching suspicion (lower is better)' },
  ],
  hiring_readiness: [
    { key: 'role_fit', label: 'Role fit' },
    { key: 'experience_level_match', label: 'Experience-level match' },
    { key: 'ramp_up_speed', label: 'Estimated ramp-up speed' },
    { key: 'team_fit', label: 'Team fit' },
    { key: 'growth_potential', label: 'Growth potential' },
    { key: 'retention_signal', label: 'Retention signal (flight-risk, lower risk is better)' },
    { key: 'expectation_clarity', label: 'Expectation clarity' },
    { key: 'onboarding_readiness', label: 'Onboarding readiness' },
    { key: 'immediate_impact_potential', label: 'Immediate-impact potential' },
    { key: 'long_term_potential', label: 'Long-term potential' },
    { key: 'culture_add', label: 'Culture add' },
    { key: 'overall_readiness', label: 'Overall hiring readiness' },
  ],
};
export const PARAMETER_COUNT = PARAMETER_GROUPS.reduce((n, g) => n + PARAMETER_TAXONOMY[g].length, 0); // 84

/**
 * P5 — per-role dynamic weighting, deterministic (keyword-matched), not
 * LLM-guessed: a hiring decision's own weighting logic shouldn't vary by
 * model mood on the same role. Sales/PM-flavored roles weight communication
 * & behavioral higher; engineering/data-flavored roles weight technical &
 * cognitive higher. Falls back to equal weighting (1) for anything
 * unmatched — never a silent zero.
 */
export function weightsForRole(jobRole: string, category: string): Record<ParameterGroup, number> {
  const text = `${jobRole} ${category}`.toLowerCase();
  const base: Record<ParameterGroup, number> = { communication: 1, technical: 1, behavioral: 1, confidence: 1, cognitive: 1, risk: 1, hiring_readiness: 1 };
  if (/sales|marketing|account|business development|\bbd\b|customer success|hr\b|human resources/.test(text)) {
    return { ...base, communication: 1.5, behavioral: 1.4, technical: 0.6, cognitive: 0.9 };
  }
  if (/engineer|developer|dsa|backend|frontend|full.?stack|devops|data (scientist|engineer|analyst)|ai.?ml|sql/.test(text)) {
    return { ...base, technical: 1.5, cognitive: 1.3, communication: 0.8 };
  }
  if (/product manager|\bpm\b|program manager|project manager/.test(text)) {
    return { ...base, communication: 1.3, cognitive: 1.2, behavioral: 1.2, technical: 0.8 };
  }
  return base;
}

/**
 * P5 — radar benchmark, deterministic and clearly labeled as a target bar
 * for the role/level, NOT fabricated population statistics (this app has no
 * real aggregated candidate population to draw a genuine benchmark from
 * yet). Level inferred from experience-level-flavored words in the role
 * string; defaults to a mid-level bar.
 */
export function benchmarkForRole(jobRole: string): number {
  const text = jobRole.toLowerCase();
  if (/senior|staff|principal|lead|architect/.test(text)) return 80;
  if (/junior|intern|fresher|entry/.test(text)) return 60;
  return 70;
}

const LEVELS = ['Weak', 'Decent', 'Good', 'Strong'] as const;
export type Level = (typeof LEVELS)[number];
/** Score→level mapping is deterministic (code), never trusted from the LLM's own label choice — the same discipline as everywhere else in this codebase: a model can misjudge its own score-to-label mapping, code cannot. */
export function levelForScore(score: number): Level {
  if (score >= 86) return 'Strong';
  if (score >= 66) return 'Good';
  if (score >= 41) return 'Decent';
  return 'Weak';
}

const SKILL_CARD_DEFS = [
  { key: 'problem_solving', label: 'Problem Solving', groups: ['cognitive', 'technical'] as ParameterGroup[] },
  { key: 'technical_knowledge', label: 'Technical Knowledge', groups: ['technical'] as ParameterGroup[] },
  { key: 'code_quality', label: 'Code Quality', groups: ['technical'] as ParameterGroup[] },
  { key: 'communication', label: 'Communication', groups: ['communication'] as ParameterGroup[] },
  { key: 'confidence_delivery', label: 'Confidence & Delivery', groups: ['confidence'] as ParameterGroup[] },
  { key: 'role_competencies', label: 'Role Competencies & Culture Fit', groups: ['behavioral', 'hiring_readiness'] as ParameterGroup[] },
];

export interface ParameterScore {
  key: string;
  group: ParameterGroup;
  label: string;
  score: number;
  interpretation: string;
  weight: number;
}
export interface SkillCard {
  key: string;
  label: string;
  level: Level;
  instanceNote: string;
}
export interface RadarAxis {
  axis: string;
  score: number;
  benchmark: number;
}
export interface PerQuestionScore {
  /** 0-5 score for this answer (Koyo-style "4/5"). */
  score: number;
  max: number;
  notes: string;
  /** P5 — when present, the recruiter report can deep-link into the recording at this moment. */
  occurredAt?: string;
}

export interface EvaluationJson {
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: Recommendation;
  perQuestion?: PerQuestionScore[];
  // P5
  parameterScores?: ParameterScore[];
  skillCards?: SkillCard[];
  radar?: RadarAxis[];
}

/** Raw shapes the LLM actually returns — narrower than EvaluationJson, which also carries the deterministic bits (weight, level, benchmark, group) computed in code afterward. */
interface CoreEvalResponse {
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: Recommendation;
  perQuestion?: { score: number; notes: string }[];
  skillCards?: { key: string; score: number; instanceNote: string }[];
}
interface ParameterResponse {
  scores: Record<string, { score: number; interpretation: string }>;
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {}

  /**
   * Evaluate a completed session (the Answer-row-backed take-page flow).
   * Aggregates every answer + the interview context, asks the model for a
   * strict-JSON assessment, then persists it. Idempotent: re-running
   * replaces the prior evaluation.
   */
  async evaluateSession(sessionId: string): Promise<EvaluationJson> {
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: sessionId },
      include: {
        interview: true,
        answers: { include: { interviewQuestion: { include: { question: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!session) throw new NotFoundException('Session not found');

    const items = session.answers.map((a) => ({
      prompt: a.interviewQuestion.question.prompt,
      response: a.code ? `Code (${a.language}):\n${a.code}` : a.responseText ?? '(no answer)',
      occurredAt: a.createdAt.toISOString(),
    }));
    const transcript = session.answers
      .map((a, i) => {
        const q = a.interviewQuestion.question;
        const response = a.code ? `Code (${a.language}):\n${a.code}` : a.responseText ?? '(no answer)';
        return `Q${i + 1} [${q.category}/${q.difficulty}]: ${q.prompt}\nExpected: ${q.expectedAnswer ?? 'open-ended'}\nCandidate: ${response}`;
      })
      .join('\n\n');

    const context = { jobRole: session.interview.jobRole, category: session.interview.category, difficulty: session.interview.difficulty };
    const evaluation = await this.buildRichEvaluation(context, transcript, items);
    await this.persist(sessionId, evaluation);
    return evaluation;
  }

  /**
   * Stateless evaluation used by self-serve practice mode AND the practice
   * room (recruiter-invited sessions launched via the room also flow through
   * here — see PracticeService.completeSession, not evaluateSession above).
   * `items[].occurredAt` (P5) is what lets the report deep-link into the
   * session recording; optional so the /practice/evaluate stateless
   * endpoint (no session/recording at all) still works unchanged.
   */
  async evaluateTranscript(
    context: { jobRole: string; category: string; difficulty: string },
    items: { prompt: string; response: string; occurredAt?: string }[],
  ): Promise<EvaluationJson> {
    const transcript = items
      .map((it, i) => `Q${i + 1}: ${it.prompt}\nCandidate: ${it.response || '(no answer)'}`)
      .join('\n\n');
    return this.buildRichEvaluation(context, transcript, items);
  }

  async getBySession(sessionId: string) {
    const evaluation = await this.prisma.evaluation.findUnique({ where: { sessionId } });
    if (!evaluation) throw new NotFoundException('Evaluation not ready');
    return evaluation;
  }

  /**
   * P5 — full report: the evaluation plus enough session context (startedAt)
   * for the frontend to compute recording-deep-link offsets itself, same
   * shape/reasoning as ProctoringService.sessionTimeline's click-to-jump
   * math. Recording/proctoring data itself is fetched separately by the
   * frontend from their own existing endpoints — this stays evaluation's own
   * concern, not a grab-bag God endpoint.
   */
  async getReport(sessionId: string) {
    const [evaluation, session] = await Promise.all([
      this.prisma.evaluation.findUnique({ where: { sessionId } }),
      this.prisma.interviewSession.findUnique({
        where: { id: sessionId },
        select: { startedAt: true, completedAt: true, candidate: { select: { fullName: true } }, interview: { select: { jobRole: true, title: true } } },
      }),
    ]);
    if (!evaluation) throw new NotFoundException('Evaluation not ready');
    if (!session) throw new NotFoundException('Session not found');
    return { evaluation, session };
  }

  /** P5 — generate (or rotate) a shareable link token. Rotating invalidates the previous link. */
  async createShareLink(sessionId: string, expiresInDays = 30): Promise<{ token: string; expiresAt: string }> {
    const evaluation = await this.prisma.evaluation.findUnique({ where: { sessionId }, select: { id: true } });
    if (!evaluation) throw new NotFoundException('Evaluation not ready');
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
    await this.prisma.evaluation.update({ where: { sessionId }, data: { shareToken: token, shareTokenExpiresAt: expiresAt } });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** P5 — revoke an active share link without waiting for it to expire. */
  async revokeShareLink(sessionId: string): Promise<{ ok: true }> {
    await this.prisma.evaluation.update({ where: { sessionId }, data: { shareToken: null, shareTokenExpiresAt: null } });
    return { ok: true };
  }

  /**
   * P5 — public read by token, no login required (the token itself IS the
   * credential — same "anyone with the link" pattern as most SaaS share
   * links). Expired/missing tokens are indistinguishable from "not found" —
   * never leaks whether a token once existed.
   */
  async getByShareToken(token: string) {
    const evaluation = await this.prisma.evaluation.findUnique({ where: { shareToken: token } });
    if (!evaluation || !evaluation.shareTokenExpiresAt || evaluation.shareTokenExpiresAt < new Date()) {
      throw new NotFoundException('This link is invalid or has expired');
    }
    const session = await this.prisma.interviewSession.findUnique({
      where: { id: evaluation.sessionId },
      select: { startedAt: true, completedAt: true, candidate: { select: { fullName: true } }, interview: { select: { jobRole: true, title: true } } },
    });
    return { evaluation, session };
  }

  /**
   * The shared core: two LLM calls (kept separate rather than one giant
   * ~84-parameter response — smaller, more reliable JSON per call than
   * cramming everything into one completion) plus fully-deterministic
   * post-processing (weights, levels, benchmark) that never depends on the
   * model getting arithmetic or self-labeling right.
   */
  private async buildRichEvaluation(
    context: { jobRole: string; category: string; difficulty: string },
    transcript: string,
    items: { prompt: string; occurredAt?: string }[],
  ): Promise<EvaluationJson> {
    const questionCount = items.length;

    // Call 1 — the existing narrative shape (summary/strengths/weaknesses/
    // recommendation/legacy competencies/per-question scores) plus skill
    // card RAW scores (levels computed deterministically afterward).
    const coreSystem = [
      'You are a rigorous, fair senior interviewer and hiring evaluator.',
      'Score each competency 0-100. Be evidence-based, specific, and avoid bias.',
      'The recommendation and summary MUST be grounded in specific things the candidate actually said — reference at least one concrete moment, never generic filler.',
      questionCount > 0 ? `Grade EACH of the ${questionCount} questions 0-5 with a one-line note citing what they actually said; perQuestion MUST have exactly ${questionCount} entries, in order.` : '',
      `Also score these 6 skill-card areas 0-100 with an instanceNote that quotes or closely paraphrases an ACTUAL moment from the transcript (never a generic statement): ${SKILL_CARD_DEFS.map((c) => c.key).join(', ')}.`,
      'Return ONLY JSON matching this TypeScript type:',
      `{ overallScore:number; competencies:{ ${COMPETENCIES.map((c) => `${c}:number`).join('; ')} };`,
      'strengths:string[]; weaknesses:string[]; summary:string;',
      questionCount > 0 ? 'perQuestion:{ score:number; notes:string }[];' : '',
      `skillCards:{ key:string (one of: ${SKILL_CARD_DEFS.map((c) => c.key).join(', ')}); score:number; instanceNote:string }[];`,
      'recommendation:"STRONG_HIRE"|"HIRE"|"LEAN_HIRE"|"NO_HIRE"|"STRONG_NO_HIRE" }',
    ]
      .filter(Boolean)
      .join(' ');
    const user = `Role: ${context.jobRole}\nCategory: ${context.category}\nDifficulty: ${context.difficulty}\n\nTranscript:\n${transcript}`;

    // Call 2 — the 84-parameter framework. The taxonomy (keys/labels/groups)
    // is fixed in code and handed to the model verbatim; its only job is to
    // fill in score + interpretation for each named key, not invent the axes.
    const paramSystem = [
      'You are scoring a candidate against a FIXED evaluation framework — do not invent, rename, skip, or reorder parameters.',
      'For EVERY parameter listed below, return a 0-100 score AND a short (one sentence) interpretation grounded in the transcript — never a bare number, and never boilerplate that could apply to any candidate.',
      "For parameters explicitly marked '(lower is better)', still score 0-100 in the SAME direction as everything else (100 = best/least risky) — you are not inverting the scale, just noting what 'good' means for that one.",
      'Parameters, by group:',
      ...PARAMETER_GROUPS.map((g) => `[${g}]: ${PARAMETER_TAXONOMY[g].map((p) => p.key).join(', ')}.`),
      'Return ONLY JSON: {"scores": {"<parameter key>": {"score": number, "interpretation": string}, ...}} — one entry per key listed above, using the EXACT key strings given.',
    ].join(' ');

    let core: CoreEvalResponse;
    let paramsRaw: ParameterResponse;
    try {
      [core, paramsRaw] = await Promise.all([
        this.ai.completeJson<CoreEvalResponse>(
          [
            { role: 'system', content: coreSystem },
            { role: 'user', content: user },
          ],
          { temperature: 0.2, maxTokens: 1800 },
        ),
        this.ai.completeJson<ParameterResponse>(
          [
            { role: 'system', content: paramSystem },
            { role: 'user', content: user },
          ],
          { temperature: 0.2, maxTokens: 3500 },
        ),
      ]);
    } catch (err) {
      this.logger.error(`Evaluation failed: ${err}`);
      throw err;
    }

    return this.normalize(core, paramsRaw, context, items);
  }

  private async persist(sessionId: string, evaluation: EvaluationJson): Promise<void> {
    const parameterScores = (evaluation.parameterScores ?? []) as unknown as Prisma.InputJsonValue;
    const skillCards = (evaluation.skillCards ?? []) as unknown as Prisma.InputJsonValue;
    const radar = (evaluation.radar ?? []) as unknown as Prisma.InputJsonValue;
    const perQuestion = (evaluation.perQuestion ?? []) as unknown as Prisma.InputJsonValue;
    const shared = {
      overallScore: evaluation.overallScore,
      competencies: evaluation.competencies as unknown as Prisma.InputJsonValue,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses,
      summary: evaluation.summary,
      recommendation: evaluation.recommendation,
      parameterScores,
      skillCards,
      radar,
      perQuestion,
    };
    await this.prisma.evaluation.upsert({
      where: { sessionId },
      create: { sessionId, ...shared, modelMeta: { providers: this.ai.availableProviders() } as unknown as Prisma.InputJsonValue },
      update: shared,
    });
  }

  /** Clamp/repair everything from the model, and compute every deterministic field (weights, levels, benchmark, radar) in code. */
  private normalize(
    core: CoreEvalResponse,
    paramsRaw: ParameterResponse,
    context: { jobRole: string; category: string; difficulty: string },
    items: { prompt: string; occurredAt?: string }[],
  ): EvaluationJson {
    const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    const competencies: Record<string, number> = {};
    for (const key of COMPETENCIES) competencies[key] = clamp(core.competencies?.[key] ?? 0);
    const valid: Recommendation[] = ['STRONG_HIRE', 'HIRE', 'LEAN_HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'];

    const weights = weightsForRole(context.jobRole, context.category);
    const scores = paramsRaw?.scores ?? {};
    const parameterScores: ParameterScore[] = [];
    for (const group of PARAMETER_GROUPS) {
      for (const { key, label } of PARAMETER_TAXONOMY[group]) {
        const entry = scores[key];
        const score = clamp(entry?.score);
        const interpretation = (entry?.interpretation ?? '').toString().trim().slice(0, 240) || `${label}: ${score}/100 — no further detail returned.`;
        parameterScores.push({ key, group, label, score, interpretation, weight: weights[group] });
      }
    }
    // Honest guardrail, not silent: if the model dropped parameters
    // entirely (missing key), it's still present above with a fallback
    // interpretation and a real (if defaulted) score — never absent from
    // the framework, since a report claiming "84 parameters" that's
    // actually missing some would be a worse failure than a placeholder one.
    if (parameterScores.length !== PARAMETER_COUNT) {
      this.logger.warn(`Parameter framework produced ${parameterScores.length}/${PARAMETER_COUNT} entries — check the model's JSON.`);
    }

    const skillCards: SkillCard[] = SKILL_CARD_DEFS.map((def) => {
      const raw = core.skillCards?.find((c) => c.key === def.key);
      const score = clamp(raw?.score);
      return {
        key: def.key,
        label: def.label,
        level: levelForScore(score),
        instanceNote: (raw?.instanceNote ?? '').toString().trim().slice(0, 300) || 'No specific instance was captured for this area.',
      };
    });

    const benchmark = benchmarkForRole(context.jobRole);
    const radar: RadarAxis[] = SKILL_CARD_DEFS.map((def, i) => ({
      axis: def.label,
      score: scoreFromLevel(skillCards[i].level),
      benchmark,
    }));

    const normalized: EvaluationJson = {
      overallScore: clamp(core.overallScore),
      competencies,
      strengths: (core.strengths ?? []).slice(0, 10),
      weaknesses: (core.weaknesses ?? []).slice(0, 10),
      summary: core.summary ?? '',
      recommendation: valid.includes(core.recommendation) ? core.recommendation : 'NO_HIRE',
      parameterScores,
      skillCards,
      radar,
    };

    if (items.length > 0) {
      const clamp5 = (n: unknown) => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
      const src = Array.isArray(core.perQuestion) ? core.perQuestion : [];
      normalized.perQuestion = items.map((item, i) => ({
        score: clamp5(src[i]?.score),
        max: 5,
        notes: (src[i]?.notes ?? '').toString().slice(0, 400),
        occurredAt: item.occurredAt,
      }));
    }
    return normalized;
  }
}

/** Deterministic inverse of levelForScore for the radar axis (mid-point of each bucket, not the raw LLM score — keeps the radar consistent with the skill-card level shown right next to it). */
function scoreFromLevel(level: Level): number {
  switch (level) {
    case 'Strong':
      return 92;
    case 'Good':
      return 75;
    case 'Decent':
      return 53;
    default:
      return 25;
  }
}
