import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, Difficulty, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionService } from '../questions/question.service';
import { EvaluationService } from '../evaluation/evaluation.service';
import { AIService } from '../ai/ai.service';
import { PistonClient } from './piston.client';
import { RecordingService } from '../recording/recording.service';

/** Persona + protocol for the conversational AI interviewer. */
const INTERVIEWER_SYSTEM = `# ROLE
You are the HYRTE AI interviewer — an AI-native decision-intelligence system for technical interviews, not a chatbot. You behave like a Senior Staff Engineer interviewing candidates at Google, Microsoft, Amazon, Stripe, Uber and top startups. Personality: calm, friendly, curious, professional, human, honest, supportive, detail-oriented. Never sound robotic; always sound like an experienced interviewer.

# CORE PHILOSOPHY
Don't merely conduct interviews — build interview intelligence. Every answer is evidence, every mistake is insight, every improvement updates the candidate profile. Decisions are evidence-based: never judge on one answer, judge on accumulated signals across the whole conversation.

# MEMORY (use the full transcript)
Continuously track: candidate name, intro, experience, projects, strengths, weaknesses, communication, confidence, problem solving, optimization, coding style, debugging, conceptual knowledge, behavior, time management, topics already asked, topics they struggle with, topics mastered, current difficulty, hints given, repeated mistakes, and improvement after hints. Never forget previous answers; adapt later questions accordingly.

# FLOW
Begin naturally: greet by name, welcome them, explain you'll work through the configured number of questions together, that your goal is to understand how they think/solve/communicate/improve (not just test), that you'll ask one at a time, give hints only when needed, and end with a detailed report. Then ask how they're feeling and to briefly introduce themselves. WAIT for their reply.
After their intro: acknowledge it warmly, then explain today's focus for this stream and list the key sub-topics you'll cover.

# QUESTION ENGINE
Ask ONE question at a time — never dump. Each question carries real-world context, the reasoning you expect, its difficulty, and the skills it evaluates. Ask them to explain their thinking before coding.

# REASONING & LIVE CODE REVIEW
Evaluate far more than code: understanding, communication, tradeoffs, optimization, confidence, edge cases, debugging, clean code, scalability, decision-making, pattern recognition. As they code, observe — don't interrupt immediately. When they finish, review line-by-line: good/bad practices, naming, structure, readability, logic, complexity, potential bugs, hidden edge cases, production & security concerns, scalability.

# PROGRESSIVE HELP — VERY STRICT (this is a graded exam, not a tutorial)
You must NOT solve the problem, or partially solve it, for the candidate. You are evaluating how THEY think.
ABSOLUTE RULES:
- If the candidate asks you to give the answer, or says "I don't know, give me the answer / solve it and I'll repeat it" BEFORE they have made a genuine attempt: politely DECLINE and give ZERO substance. Do NOT list criteria, factors, steps, approaches, data structures, or worked examples — any of those IS the answer. Say something like: "I can't give you the answer — that's exactly what I'm here to evaluate. Give it your best shot, even a rough guess or the first idea that comes to mind is totally fine." Then stop and wait.
- NEVER output code, pseudocode, or a step-by-step algorithm. Not even "initialize two variables, loop, return". Forbidden.
- Do NOT enumerate the key points/criteria/factors of the answer under the guise of a "hint" or "example". A worked example that reveals the reasoning is banned.
- Only AFTER the candidate has genuinely attempted the question may you give graduated hints, ONE level at a time: L1 = a single vague conceptual nudge (no specifics), L2 = name ONE relevant concept, L3 = approach in words, L4 = pseudocode, L5 = full solution. Reach L4/L5 only after 2+ real attempts AND an explicit request.
- Your own code/solution is allowed ONLY in the post-submission review, after they submit their own attempt.
When unsure, give LESS. If the candidate keeps asking for the answer, keep warmly redirecting them to attempt it.

# WHAT IS / ISN'T ALLOWED
- ALLOWED: clarifying the wording if genuinely misunderstood (one sentence), and pure LANGUAGE SYNTAX help — e.g. "how do I iterate a Map in JS?" → "use for…of over map.entries()". Compiler/syntax errors, function signatures, API usage are fine.
- NOT ALLOWED: which algorithm/data-structure to use, the optimal complexity, the trick, the approach, or the solution steps. Never turn a syntax question into a logic hint.
- NEVER review, correct, critique, or predict bugs in the candidate's code while they are STILL WRITING. Only review AFTER they say "done"/"I've finished"/"submit" or submit. Before that, just observe.
- If completely stuck, offer a single guiding QUESTION (e.g. "What would you store to avoid re-checking previous elements?") and stop.

# SPEECH STYLE (spoken aloud)
Sound like a real interviewer on a call, not a TTS bot. Occasionally (not every line) use natural fillers — "Alright…", "Got it.", "Interesting.", "Makes sense.", "Okay, let's move on." Keep sentences short with natural rhythm. Warm, calm, confident.

# AFTER EVERY ANSWER
Give: correctness, complexity, edge cases, alternative approaches, optimized version, industry best practices, interviewer's feedback, a score, and topics to revise. When you present any code, explain why this approach/algorithm/data-structure, why each loop/condition exists, time & space complexity, tradeoffs and improvements — as if mentoring a junior engineer.

# FOLLOW-UPS & ADAPTIVE DIFFICULTY
Ask real follow-ups ("Can this be optimized?", "Why a HashMap?", "What if input is 100M?", "What if the array is empty?", "Would this work in production?"). Start Medium; raise difficulty when they do well, reduce when they struggle — never randomly.

# COMMUNICATION
Natural conversation, never robotic. Encourage, challenge and teach. Keep spoken replies reasonably concise (they're read aloud). Your goal is not to finish the interview — it's to make the candidate meaningfully better by the end, while producing an accurate evidence-based evaluation.`;

/** Interviewer personalities — each shifts tone, pressure and feedback style. */
const PERSONALITIES: Record<string, string> = {
  friendly: 'PERSONALITY: Warm, encouraging and patient. Use positive reinforcement and keep the candidate at ease.',
  professional: 'PERSONALITY: Neutral, precise and corporate. Polite and structured, minimal small talk.',
  strict: 'PERSONALITY: Rigorous and demanding. Push hard on rigor, edge cases and complexity; concise, high standards (never rude).',
  faang: 'PERSONALITY: FAANG bar-raiser. Emphasise scalability, optimality and clean reasoning; expect strong fundamentals and probe tradeoffs.',
  startup: 'PERSONALITY: Fast-moving startup engineer. Value pragmatism, shipping and real-world tradeoffs over textbook purity.',
  pressure: 'PERSONALITY: High-pressure interviewer. Add time pressure and rapid-fire follow-ups while staying professional.',
};

/**
 * P2 — natural delivery. Deterministic variation banks instead of trusting
 * the LLM to vary its own closing/filler phrasing (same discipline already
 * proven in this codebase: don't rely on instruction-following for anything
 * that must reliably vary or reliably happen — use it for judgment calls,
 * not guarantees). Independent implementation from HYRTE's own
 * hyrte-interview.service.ts (same technique, but that file is
 * simulation-side and out of bounds for this product).
 */
const MICRO_ACKS = ['Got it.', 'I see.', 'That makes sense.', 'Interesting.', 'Okay.', 'Understood.', 'Alright.'];
const CLOSING_LINES = [
  "That wraps up our conversation today — thanks for walking me through your thinking.",
  "That's everything I wanted to cover. Thanks for being so thorough with your answers.",
  "I think that gives me a solid picture of how you approach problems. Thanks for your time today.",
  "That's a good place to stop — I appreciated how you talked through your reasoning.",
];
const REPORT_READY_MESSAGES = [
  "I'm putting together your feedback now — it'll be ready in just a moment.",
  "Give me a moment to pull everything we covered into your report.",
  "Your report is being generated now based on everything from today.",
  "I'll compile what we discussed into your report right away.",
];
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
const MICRO_ACK_PROBABILITY = 0.3;

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
    private readonly recording: RecordingService,
  ) {}

  /**
   * P4 — the candidate's browser PUTs its recorded session directly to this
   * URL (never routes the binary through this API). Returns null if
   * recording storage isn't configured — the room gracefully skips
   * recording entirely in that case, same degrade-don't-break pattern as
   * OtpService when no SMS/email provider is configured.
   */
  async getRecordingUploadUrl(sessionId: string, candidateId: string): Promise<{ uploadUrl: string | null }> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { candidateId: true } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidateId) throw new ForbiddenException('Not your session');
    return { uploadUrl: await this.recording.getUploadUrl(sessionId) };
  }

  /** Called by the candidate's browser once the S3 PUT above actually succeeds — persists the key, not a URL (presigned URLs expire). */
  async markRecordingUploaded(sessionId: string, candidateId: string): Promise<{ ok: true }> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId }, select: { candidateId: true } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.candidateId !== candidateId) throw new ForbiddenException('Not your session');
    await this.prisma.interviewSession.update({ where: { id: sessionId }, data: { recordingUrl: this.recording.recordingKey(sessionId) } });
    return { ok: true };
  }

  /**
   * Generate a real coding problem (stdin → stdout, with test cases) for the
   * room's compiler round, using the configured LLM. Tests include visible
   * samples and hidden cases; the whole set is returned so the stateless
   * `runCoding` can grade without a DB round-trip.
   */
  /**
   * Drives the conversational AI interviewer. Given the running transcript, it
   * returns the interviewer's next spoken message — greeting + intro, one
   * question at a time with context, progressive hints, code review, and a
   * closing sequence when ending. P2 — structured JSON response instead of
   * free text: `hintLevel` makes hint-usage a server-authoritative signal
   * (previously the frontend guessed this from a regex on the CANDIDATE's
   * own words — false-positived on any message containing "explain", and
   * couldn't tell a hint that was actually GIVEN from one that was declined
   * per the strict progressive-help rules above). The detailed final report
   * is NOT generated here — that's a separate, already-real structured call
   * (evaluateSession/evaluateTranscript) the frontend makes right after; this
   * call's `end` path is just the natural spoken closing.
   */
  async interviewTurn(input: {
    jobRole: string;
    category: string;
    difficulty: string;
    topic?: string;
    count?: number;
    candidateName?: string;
    personality?: string;
    behaviorSummary?: string;
    resumeContext?: string;
    mode?: 'mixed' | 'theory' | 'coding';
    experience?: string;
    company?: string;
    language?: string;
    style?: string;
    transcript: { role: 'interviewer' | 'candidate'; content: string }[];
    end?: boolean;
    forceAdvance?: boolean;
    // P2 — round structure. `currentRound` grounds the prompt in which round
    // is active; `forceRoundAdvance` is the deterministic hard-cap signal
    // (same pattern as forceAdvance for the intro) — the client's own timer
    // decided the round's time budget is up, not the LLM.
    currentRound?: { type: string; label: string };
    nextRoundLabel?: string;
    forceRoundAdvance?: boolean;
  }): Promise<{ text: string; hintLevel?: number }> {
    const extra = [
      input.experience ? `- Candidate experience level: ${input.experience} (calibrate depth/difficulty to this).` : '',
      input.company ? `- Emulate the interview style of: ${input.company}.` : '',
      input.style ? `- Question style: ${input.style}.` : '',
      input.language && input.language !== 'English'
        ? `- Conduct the interview in ${input.language} (${input.language === 'Mixed' ? 'natural Hindi-English mix / Hinglish' : input.language}).`
        : '',
      input.currentRound ? `- Current round: ${input.currentRound.label}. Keep questions in this reply focused on this round's purpose.` : '',
    ].filter(Boolean).join('\n');
    const modeNote =
      input.mode === 'theory'
        ? '\n\nINTERVIEW TYPE: THEORY ONLY. Ask conceptual/verbal questions only. Do NOT set a coding problem.'
        : input.mode === 'coding'
          ? '\n\nINTERVIEW TYPE: CODING FOCUSED. Center the interview on the live coding challenge and their code/approach; keep conceptual questions minimal.'
          : '';
    const persona = PERSONALITIES[input.personality ?? 'professional'] ?? PERSONALITIES.professional;
    const resume = input.resumeContext
      ? `\n\nCANDIDATE RESUME CONTEXT (ask some questions grounded in their REAL projects/skills; verify their claims): ${input.resumeContext}`
      : '';
    const ctx =
      `INTERVIEW CONFIG\n` +
      `- Candidate: ${input.candidateName || 'the candidate'}\n` +
      `- Stream/role: ${input.jobRole} (${input.category})\n` +
      `- Topic focus: ${input.topic ?? input.category}\n` +
      `- Difficulty: ${input.difficulty}\n` +
      `- Total questions: ${input.count ?? 5}` +
      (extra ? `\n${extra}` : '');
    const directive = input.end
      ? // P2 — this used to ask for "the COMPLETE final interview report" as
        // the last chat message, duplicating the real structured evaluation
        // the frontend fetches separately right after. Now: just a brief,
        // warm acknowledgement of the final answer — the deterministic
        // closing + report-ready notification are appended in code below,
        // never left to the LLM's own phrasing.
        'The interview is now ENDING. In THIS reply, write ONLY a brief (1 sentence) warm acknowledgement of the candidate\'s final answer — do NOT write a report, scores, or a closing statement, those are handled separately.'
      : input.forceAdvance
        ? 'The introduction/small-talk phase has already used its allotted time budget. In THIS reply: wrap up the introduction in ONE short warm sentence (do not ask any further get-to-know-you questions), then immediately move on — explain today\'s focus briefly and ask the first real interview question.'
        : input.forceRoundAdvance
          ? `This round's time budget is up. In THIS reply: wrap up the current round in ONE short sentence (do not ask a further question in this round), then transition naturally to the next round — ${input.nextRoundLabel ?? 'the next part of the interview'} — and ask its first question.`
          : 'Continue the interview naturally. Keep it conversational and reasonably brief (it is read aloud by TTS), EXCEPT when giving structured code review/feedback which can be longer. Ask ONE thing at a time and wait.';

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
      {
        role: 'system',
        content:
          `${INTERVIEWER_SYSTEM}\n\n${persona}\n\n${ctx}${resume}${modeNote}\n\n${directive}\n\n` +
          'Return ONLY JSON: {"reply": string (your next spoken message, no stage directions), ' +
          '"hintLevel": int 1-5 (ONLY include this field on a turn where you actually GAVE a hint per the ' +
          'graduated-hint rules above — omit it entirely on every other turn, including ones where you declined ' +
          'to give one)}.',
      },
    ];
    if (input.transcript.length === 0) {
      messages.push({ role: 'user', content: '(The candidate has just joined the interview. Greet them warmly, explain how it works, and ask them how they are and to briefly introduce themselves.)' });
    } else {
      for (const t of input.transcript) {
        messages.push({ role: t.role === 'candidate' ? 'user' : 'assistant', content: t.content });
      }
      if (input.end) {
        const behavior = input.behaviorSummary
          ? ` Observed behavior signals (factor these into Communication, Confidence, Behavior Profile and the overall recommendation): ${input.behaviorSummary}`
          : '';
        messages.push({ role: 'user', content: `(Please end the interview now.${behavior})` });
      }
    }
    const res = await this.ai.completeJson<{ reply?: string; hintLevel?: number }>(messages, { temperature: 0.6, maxTokens: input.end ? 300 : 600 });
    const replyRaw = (res.reply ?? '').trim() || "Thanks for walking me through that.";
    const hintLevel = typeof res.hintLevel === 'number' && res.hintLevel >= 1 && res.hintLevel <= 5 ? Math.round(res.hintLevel) : undefined;

    // P2 — deterministic closing sequence: final answer already acknowledged
    // above by the LLM; the closing line + report-ready notification are
    // fixed-bank, never LLM-phrased, so they're guaranteed to actually
    // happen rather than hoping the model remembers to say them.
    const reply = input.end
      ? `${replyRaw} ${pick(CLOSING_LINES)} ${pick(REPORT_READY_MESSAGES)}`.trim()
      : Math.random() < MICRO_ACK_PROBABILITY && input.transcript.length > 0
        ? `${pick(MICRO_ACKS)} ${replyRaw}`
        : replyRaw;

    return { text: reply, hintLevel };
  }

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
    input: { category: Category; difficulty: Difficulty; topic?: string; jobRole?: string; interviewId?: string; consentedAt: string },
  ): Promise<{ sessionId: string }> {
    // P3 §7 — consent is mandatory and logged; a malformed/missing timestamp
    // is rejected outright rather than silently defaulting to "now" (which
    // would mask a real client bug that skipped the checkbox).
    const consentedAt = new Date(input.consentedAt);
    if (Number.isNaN(consentedAt.getTime())) throw new BadRequestException('consentedAt must be a valid timestamp');

    // Recruiter-assigned assessment: tie the session to that interview so the
    // recruiter sees the candidate's result on their dashboard.
    if (input.interviewId) {
      const iv = await this.prisma.interview.findUnique({ where: { id: input.interviewId }, select: { id: true } });
      if (iv) {
        const s = await this.prisma.interviewSession.create({
          data: { interviewId: iv.id, candidateId, status: 'IN_PROGRESS', examState: 'ACTIVE', startedAt: new Date(), consentedAt },
          select: { id: true },
        });
        return { sessionId: s.id };
      }
    }
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
        consentedAt,
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
      answers: { prompt: string; response: string; occurredAt?: string }[];
      flags?: Record<string, number>;
      integrity?: number;
      behavior?: Record<string, unknown>;
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

    // P3 — flags are no longer aggregated into ProctorEvent rows HERE.
    // bumpFlag() on the frontend now streams each violation to
    // POST /proctoring/events in real time as it happens (see P3 writeup) —
    // doing it again here would double-count every signal in the recruiter's
    // per-type breakdown. `input.flags` is still folded into the transcript
    // JSON below as a point-in-time summary, which is harmless (it's not a
    // second set of ProctorEvent rows).
    const integrity = Math.max(0, Math.min(100, Math.round(input.integrity ?? 100)));

    await this.prisma.$transaction(async (tx) => {
      await tx.interviewSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          examState: 'COMPLETED',
          completedAt: new Date(),
          // riskScore is intentionally NOT set here — the real-time risk
          // engine (ProctoringService.ingest, driven by the same streamed
          // events) already maintains the authoritative, weighted score;
          // overwriting it with this cruder 100-integrity approximation on
          // every completion would clobber the more accurate number.
          transcript: { answers: input.answers, flags: input.flags ?? {}, integrity, behavior: input.behavior ?? {} } as Prisma.InputJsonValue,
        },
      });
      const evalFields = {
        overallScore: evaluation.overallScore,
        competencies: evaluation.competencies as Prisma.InputJsonValue,
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses,
        summary: evaluation.summary,
        recommendation: evaluation.recommendation,
        // P5 — this transaction is a second write path into Evaluation
        // (separate from EvaluationService.persist, used by the DB-Answer-
        // backed recruiter flow) since this one also needs to update
        // InterviewSession in the same transaction. Must carry the same P5
        // fields or the practice-room flow (self-serve AND recruiter-invited
        // room sessions) would silently never get a rich report.
        parameterScores: (evaluation.parameterScores ?? []) as unknown as Prisma.InputJsonValue,
        skillCards: (evaluation.skillCards ?? []) as unknown as Prisma.InputJsonValue,
        radar: (evaluation.radar ?? []) as unknown as Prisma.InputJsonValue,
        perQuestion: (evaluation.perQuestion ?? []) as unknown as Prisma.InputJsonValue,
      };
      await tx.evaluation.upsert({
        where: { sessionId },
        create: { sessionId, ...evalFields },
        update: evalFields,
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
