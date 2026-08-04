import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Difficulty, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { EvidenceGraphService } from '../dig/evidence-graph.service';
import { getBaseTone, getCompanyVoice, matchOffScript, requestsBossModeExit } from './interviewer-persona';
import { isRepetitive } from './repetition-detector';
import { DecisionCouncilService } from '../council/decision-council.service';
import { ReportIntelligenceService } from '../evaluation/report-intelligence.service';

const BASELINE = 50; // every stakeholder relationship field starts here (see HyrteStakeholder defaults)
const MAX_EVIDENCE_IN_BRIEF = 20;
/** §5.4 — inserted probabilistically, never every turn. */
const MICRO_ACK_PROBABILITY = 0.3;
/** §5.9 Boss Level — hard cap enforced in code, never left to the LLM's own judgment. */
const MAX_JABS = 6;

/** §5.5 Difficulty tiers — round length scales with the session's own difficulty. */
function getTurnRange(difficulty: Difficulty): { min: number; max: number } {
  switch (difficulty) {
    case 'EASY':
      return { min: 4, max: 6 };
    case 'MEDIUM':
      return { min: 5, max: 8 };
    case 'HARD':
      return { min: 6, max: 9 };
    case 'EXPERT':
      return { min: 7, max: 10 };
  }
}

/** §5.3 Real-time adaptation — a cheap proxy for confidence/hesitancy from reply length + hedging language. */
function computeCandidateSignal(transcript: TranscriptTurn[]): string {
  const replies = transcript.filter((t) => t.role === 'candidate').map((t) => t.content);
  if (replies.length === 0) return '';
  const avgWords = replies.reduce((sum, c) => sum + c.trim().split(/\s+/).length, 0) / replies.length;
  const hedgeCount = replies.filter((c) => /\b(not sure|maybe|i think|i guess|possibly|i don'?t know)\b/i.test(c)).length;
  if (avgWords < 12 || hedgeCount >= 2) {
    return 'CANDIDATE SIGNAL: their answers have been short/hesitant so far — use simpler, more encouraging follow-ups and give them room to think.';
  }
  if (avgWords > 40 && hedgeCount === 0) {
    return 'CANDIDATE SIGNAL: their answers have been detailed and confident — you can go deeper and probe harder.';
  }
  return '';
}

const BOSS_MODE_EXIT_RESPONSES = [
  "Understood — I'm dropping the harder tone right away. Let's continue at a normal, supportive pace.",
  'Got it, switching back to a calmer conversation now. Take your time.',
  "That's fair — no more of that. Let's keep going, more relaxed from here.",
];

export interface TranscriptTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

interface OpeningResponse {
  question?: string;
}

interface TurnResponse {
  reply?: string;
  done?: boolean;
  /** §5.2 — evidence-graph-aware questioning: which prior evidence (by "EVn" label) this turn's candidate statement contradicts, if any. */
  contradictsEvidenceRef?: string;
  contradictionNote?: string;
  /** §5.9 Boss Level — set true only when this reply included a pointed/sarcastic jab. */
  wasJab?: boolean;
  /** §3.1 — true when the candidate's statement is an unverified claim worth probing further, not something the evidence brief already confirms or contradicts. */
  needsInvestigation?: boolean;
  /** §3.1 probe_candidates — concrete follow-up questions that would verify the claim (e.g. "What was the baseline?"), only when needsInvestigation is true. */
  probeCandidates?: string[];
}

interface ReportResponse {
  strengths?: string[];
  developmentAreas?: string[];
  contradictions?: { claimedInInterview: string; evidenceFromSimulation: string }[];
  recommendation?: string;
  summary?: string;
  evidenceTrail?: { action: string; interviewProbe: string; interpretation: string }[];
}

/** §5.4 Reduce roboticness — variation banks, not single strings. */
const CLOSING_LINES = [
  "That's really helpful context, thank you.",
  "I think that gives me a clear picture — appreciate you walking me through it.",
  "Good, that's exactly the kind of detail I was looking for.",
  "Thanks for being candid about that.",
  "That helps a lot, I appreciate the honesty.",
  "Alright, I think I've got what I need.",
  "That's a solid place to wrap up — thanks for talking it through with me.",
  "I appreciate you thinking that through out loud.",
  "Good context, thank you for that.",
  "That's helpful — I think we've covered the key ground here.",
  "Thanks, that gives me a much clearer sense of your thinking.",
];
const REPORT_READY_MESSAGES = [
  "I'm putting together your report now — it'll be ready in just a moment.",
  'Give me a moment to pull everything we covered into your report.',
  'Your report is being generated now based on everything from today.',
  "I'll compile what we discussed into your report right away.",
  'One moment while I finalize your report.',
  "I'm wrapping this up into your full report now.",
];
const MICRO_ACKS = ['Got it.', 'I see.', 'That makes sense.', 'Interesting.', 'Okay.', 'Understood.'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * "EVn" labels are an internal reference scheme for the LLM to cite evidence
 * by — they must never reach the candidate. Prompted against, but stripped
 * here too as a safety net rather than trusting instruction-following alone
 * (same discipline as the hiddenIntention omission elsewhere in HYRTE).
 */
function stripEvidenceLabels(text: string): string {
  return text.replace(/\s*\(?EV\d+\)?/g, '').replace(/\s{2,}/g, ' ').trim();
}

const MIN_CALLBACK_WORDS = 8;

/**
 * §5.8 Conversation Memory — picks the most substantive earlier candidate
 * answer to call back to (longest by word count, above a floor so a short
 * "yes"/"okay" never gets quoted back), trimmed to a short quotable snippet.
 * Returns null when nothing earlier is substantive enough yet.
 */
function pickCallbackSnippet(priorAnswers: string[]): string | null {
  const candidates = priorAnswers.filter((a) => a.trim().split(/\s+/).length >= MIN_CALLBACK_WORDS);
  if (candidates.length === 0) return null;
  const longest = candidates.reduce((a, b) => (b.length > a.length ? b : a));
  // Drop a leading "earlier ..." clause from the answer itself so the quoted
  // snippet doesn't read as "Earlier you mentioned 'Earlier ...'".
  const trimmed = longest.replace(/^\s*earlier[^,]*,\s*/i, '').trim() || longest;
  const words = trimmed.split(/\s+/);
  const snippet = words.slice(0, 12).join(' ');
  return words.length > 12 ? `${snippet}...` : snippet;
}

/**
 * Evidence-based reflection interview (doc §9 / §5). Phase 4 upgrade: the
 * evidence brief now queries the formal Candidate Evidence Graph (§3.1,
 * built in Phase 1, populated by every subsystem since Phase 2) instead of
 * re-deriving a summary from the raw decision log each call — the two used
 * to be independent text summarizations of the same underlying actions.
 * Core distinction preserved: every question probes *why*, never *what* —
 * the evidence already answers "what."
 *
 * §5.2's core upgrade — live cross-examination — is implemented here: each
 * candidate turn is itself written into the graph as INTERVIEW_STATEMENT
 * evidence, and if it plausibly contradicts something the simulation
 * observed, that becomes a real CONTRADICTS edge (via EvidenceGraphService),
 * not just a one-off LLM observation that evaporates after the turn.
 */
@Injectable()
export class HyrteInterviewService {
  private readonly logger = new Logger(HyrteInterviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly evidence: EvidenceGraphService,
    private readonly council: DecisionCouncilService,
    private readonly reportIntelligence: ReportIntelligenceService,
  ) {}

  private async assertOwnership(sessionId: string, candidateId: string) {
    const session = await this.prisma.hyrteSession.findFirst({ where: { id: sessionId, candidateId } });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  /**
   * Builds the evidence brief from the Evidence Graph (not the raw decision
   * log) plus stakeholder relationships and company state as supplementary
   * context. Returns the evidence objects too (capped, most-relevant-first)
   * so callers can resolve an "EVn" label the LLM cites back to a real
   * evidence id for linking a contradiction.
   */
  private async buildEvidenceBrief(sessionId: string): Promise<{ text: string; refs: { label: string; id: string }[] }> {
    const [evidenceObjects, contradictions, stakeholders, companyState] = await Promise.all([
      this.evidence.getForSession(sessionId),
      this.evidence.getContradictions(sessionId),
      this.prisma.hyrteStakeholder.findMany({ where: { sessionId } }),
      this.prisma.hyrteCompanyState.findUnique({ where: { sessionId } }),
    ]);

    // Master Build Prompt Part F9 — "workflow signals (delegation quality,
    // review behavior, follow-through, authority handling)" must actually
    // reach the report, not just exist in the DB. A flat most-recent-only cap
    // let a long, escalation-heavy session (many SIMULATION_ACTION rows from
    // chaos waves/inbox chains) silently crowd out the sparser
    // SIMULATION_DECISION rows (command-bar delegations, work-item review
    // decisions, authority overreach) that carry those specific signals — so
    // decision-type evidence is now guaranteed a slot, filled out to the cap
    // with the most recent of everything else, rather than pure recency.
    const decisionType = evidenceObjects.filter((e) => e.type === 'SIMULATION_DECISION');
    const rest = evidenceObjects.filter((e) => e.type !== 'SIMULATION_DECISION');
    const capped = [...decisionType, ...rest.slice(-Math.max(0, MAX_EVIDENCE_IN_BRIEF - decisionType.length))].slice(-MAX_EVIDENCE_IN_BRIEF);
    const refs = capped.map((e, i) => ({ label: `EV${i + 1}`, id: e.id }));
    const evidenceLines = capped.length
      ? capped
          .map((e, i) => {
            const hasMetadata = e.metadata && typeof e.metadata === 'object' && Object.keys(e.metadata as object).length > 0;
            const metadata = hasMetadata ? ` {${JSON.stringify(e.metadata)}}` : '';
            return `${refs[i].label} [${e.type}${e.behaviorContext ? `/${e.behaviorContext}` : ''}] ${e.rawText}${metadata}`;
          })
          .join('\n')
      : '(no evidence recorded yet)';

    const contradictionLines = contradictions.length
      ? contradictions
          .map((c) => `- "${c.from.rawText}" CONTRADICTS "${c.to.rawText}"${c.note ? ` (${c.note})` : ''}`)
          .join('\n')
      : '(none detected yet)';

    const relationships = stakeholders
      .map((s) => {
        const deltas = (['trust', 'respect', 'cooperation', 'influence'] as const)
          .filter((k) => s[k] !== BASELINE)
          .map((k) => `${k} ${s[k] > BASELINE ? '+' : ''}${s[k] - BASELINE}`)
          .join(', ');
        return `- ${s.name} (${s.role}): ${deltas || 'no change from neutral'}`;
      })
      .join('\n');

    const stateJson = companyState ? JSON.stringify(omitMeta(companyState)) : '{}';

    const text =
      `Evidence recorded so far (each labeled EVn — cite this label if the candidate's next statement ` +
      `contradicts one of these):\n${evidenceLines}\n\n` +
      `Contradictions already confirmed (evidence-vs-evidence, from the simulation itself):\n${contradictionLines}\n\n` +
      `Stakeholder relationship outcomes (all start neutral at ${BASELINE}/100):\n${relationships || '(none)'}\n\n` +
      `Current company state: ${stateJson}`;

    return { text, refs };
  }

  /**
   * §4.15 Multi-Day Memory — candidate-practice mode only. Hard-gated on
   * `sessionType` at the top of this method, not behind a conditional deeper
   * in a shared code path: an ASSESSMENT session can never reach the
   * cross-session query at all, by construction, not just by convention.
   * This is a scoped interpretation of 4.15's fuller vision (the same
   * company/stakeholders persisting and evolving across sessions) — that
   * would mean not regenerating a fresh company per session for practice
   * mode, a materially larger change to the fixture-per-session model this
   * build has used since Phase 2. What's built here is real continuity
   * within the interview experience (the interviewer can reference a
   * candidate's history), not full company-state persistence.
   */
  private async getPracticeContinuityContext(candidateId: string, currentSessionId: string, sessionType: string): Promise<string> {
    if (sessionType !== 'PRACTICE') return '';

    const [priorReport] = await this.prisma.hyrteInterviewReport.findMany({
      where: { session: { candidateId, sessionType: 'PRACTICE', id: { not: currentSessionId } } },
      orderBy: { generatedAt: 'desc' },
      take: 1,
      select: { recommendation: true, decisionDNA: true, generatedAt: true },
    });
    if (!priorReport) return '';

    const dna = priorReport.decisionDNA as unknown as { traits?: string[] } | null;
    return (
      `CAREER CONTINUITY (practice mode only — this candidate has done this before): a prior practice ` +
      `session on ${new Date(priorReport.generatedAt).toDateString()} ended with recommendation ` +
      `"${priorReport.recommendation}"${dna?.traits?.length ? ` and a Decision DNA of ${dna.traits.join(', ')}` : ''}. ` +
      'You may reference this naturally if it fits (e.g. "last time you leaned toward X — curious whether ' +
      'that holds here"), but never treat it as evidence of what happened in THIS session.'
    );
  }

  async startInterview(sessionId: string, candidateId: string, bossMode = false) {
    const session = await this.assertOwnership(sessionId, candidateId);
    const { text: brief } = await this.buildEvidenceBrief(sessionId);
    const tone = getBaseTone(session.difficulty);
    const continuity = await this.getPracticeContinuityContext(candidateId, sessionId, session.sessionType);

    const result = await this.ai.completeJson<OpeningResponse>(
      [
        {
          role: 'system',
          content:
            'You are the HYRTE reflection interviewer for a workplace-simulation hiring platform. ' +
            `${tone} ${continuity} ` +
            'You have full evidence of what this candidate actually did in the simulation — never ask ' +
            'what they did, you already know. Open the interview by citing ONE specific, interesting ' +
            'thing they actually did (or notably did not do) and asking them to explain their thinking. ' +
            'Never say "tell me about yourself." Return ONLY JSON: {"question": string}.',
        },
        { role: 'user', content: `Company: ${session.companyName}, role: ${session.role}.\n\n${brief}` },
      ],
      { temperature: 0.7, maxTokens: 300 },
    );

    const question = stripEvidenceLabels(result.question ?? "Let's start — walk me through how you approached this simulation.");
    const transcript: TranscriptTurn[] = [{ role: 'interviewer', content: question }];

    await this.prisma.hyrteSession.update({
      where: { id: sessionId },
      data: {
        phase: 'INTERVIEW',
        interviewTranscript: transcript as unknown as Prisma.InputJsonValue,
        // §5.9 — explicit opt-in only; reset the jab counter in case a prior
        // interview attempt on this session left a stale count.
        interviewBossMode: bossMode,
        interviewJabCount: 0,
      },
    });

    return { question, done: false, bossMode };
  }

  async turn(sessionId: string, candidateId: string, message: string) {
    const session = await this.assertOwnership(sessionId, candidateId);
    const transcript = ((session.interviewTranscript as unknown as TranscriptTurn[]) ?? []).slice();
    transcript.push({ role: 'candidate', content: message });

    // §5.9 Boss Level safety override — checked before anything else, and
    // enforced in code, not left to the LLM to decide whether to comply.
    if (session.interviewBossMode && requestsBossModeExit(message)) {
      const reply = pick(BOSS_MODE_EXIT_RESPONSES);
      transcript.push({ role: 'interviewer', content: reply });
      await this.prisma.hyrteSession.update({
        where: { id: sessionId },
        data: { interviewTranscript: transcript as unknown as Prisma.InputJsonValue, interviewBossMode: false },
      });
      return { reply, done: false };
    }

    // §5.7 Off-script handling — canned, deterministic, no LLM call and no
    // evidence written for it. It still occupies a slot in the transcript
    // (and so counts toward the turn budget on subsequent turns) — going
    // off-topic uses up interview time the same way a real answer would.
    const offScript = matchOffScript(message);
    if (offScript) {
      transcript.push({ role: 'interviewer', content: offScript });
      await this.prisma.hyrteSession.update({
        where: { id: sessionId },
        data: { interviewTranscript: transcript as unknown as Prisma.InputJsonValue },
      });
      return { reply: offScript, done: false };
    }

    const { text: brief, refs } = await this.buildEvidenceBrief(sessionId);
    const candidateAnswers = transcript.filter((t) => t.role === 'candidate').map((t) => t.content);
    const candidateTurns = candidateAnswers.length;
    const transcriptText = transcript.map((t) => `${t.role === 'candidate' ? 'Candidate' : 'Interviewer'}: ${t.content}`).join('\n');
    const { min: targetMin, max: targetMax } = getTurnRange(session.difficulty);
    const willEnd = candidateTurns >= targetMax; // pre-computed so the prompt's own "done" logic can align with it

    // §8 Anti-gaming — a code-level guarantee, not reliance on the LLM
    // noticing on its own that this answer near-duplicates an earlier one.
    const isRepeat = isRepetitive(message, candidateAnswers.slice(0, -1));
    const repetitionNote = isRepeat
      ? 'ANTI-GAMING FLAG: the candidate\'s latest answer is a near-duplicate of something they already said. ' +
        'Call this out directly and press for genuinely new information — do not accept it at face value.'
      : '';

    // §5.8 Conversation Memory — distinct from evidence-graph-aware
    // questioning (5.2, which cross-references simulation behavior): this is
    // remembering something the candidate said earlier in THIS interview and
    // calling back to it naturally, the way a human interviewer does, even
    // when it's not a contradiction. The full transcript was already visible
    // to every turn, but nothing forced this specific behavior, so it rarely
    // happened in practice — this makes it an explicit, checkable directive.
    const priorInterviewerText = transcript.filter((t) => t.role === 'interviewer').map((t) => t.content).join(' ');
    const alreadyCalledBack = /earlier (in (this|our) conversation|you (mentioned|said))/i.test(priorInterviewerText);
    // A prompt instruction alone was tried here and proved unreliable (this
    // system prompt already carries tone/company-voice/candidate-signal/
    // boss-mode/repetition/contradiction directives, and the callback
    // instruction consistently lost out to the others in testing) — same
    // "don't trust instruction-following alone" lesson already applied to
    // hiddenIntention, EVn labels, and repetition detection elsewhere in
    // this file. The callback is injected deterministically below instead,
    // once the reply is known.
    const priorCandidateAnswers = candidateAnswers.slice(0, -1);
    const callbackSnippet =
      !alreadyCalledBack && candidateTurns >= 2 ? pickCallbackSnippet(priorCandidateAnswers) : null;

    const tone = getBaseTone(session.difficulty);
    const companyVoice = getCompanyVoice(session.companyType);
    const candidateSignal = computeCandidateSignal(transcript);
    const jabCount = session.interviewJabCount;
    const bossModeActive = session.interviewBossMode && jabCount < MAX_JABS;
    const bossModeDirective = bossModeActive
      ? `ADVERSARIAL MODE ("Boss Level") IS ACTIVE — the candidate explicitly opted in. Push back sharply ` +
        'on weak reasoning; blunt/sarcastic style is fine. HARD RULE, never violated: mock the CHOICE or ' +
        'CLAIM, never the person — never target identity, appearance, or anything personal. If this reply ' +
        'includes a pointed/sarcastic jab, set "wasJab": true AND include one short constructive, ' +
        'supportive sentence immediately after the jab in the same reply — never leave a jab unaddressed. ' +
        `Jabs used so far this session: ${jabCount}/${MAX_JABS}.`
      : session.interviewBossMode
        ? "Boss Level's jab budget is used up for this session — stay calm, supportive, and constructive for the rest."
        : '';

    const result = await this.ai.completeJson<TurnResponse>(
      [
        {
          role: 'system',
          content:
            'You are the HYRTE reflection interviewer. ' +
            `${tone} ${companyVoice} ${candidateSignal} ${bossModeDirective} ${repetitionNote} ` +
            'You have full evidence of what this candidate ' +
            'actually did in the simulation (below, each item labeled EVn) — always ask WHY, never WHAT ' +
            '(you already know what happened). Prefer evidence-grounded follow-ups over generic ones — ' +
            'e.g. instead of "why did you do that?", reference the SPECIFIC action/timing/outcome from the ' +
            'evidence. If the candidate\'s LATEST statement contradicts a specific EVn (e.g. they claim to ' +
            'have done something the evidence shows they did not, or describe themselves in a way a specific ' +
            'action undercuts), challenge it directly but professionally AND set "contradictsEvidenceRef" to ' +
            'that EVn label with a one-sentence "contradictionNote" explaining the conflict — do not invent a ' +
            'contradiction if there genuinely isn\'t one. NEVER mention an "EVn" label, or the word ' +
            '"evidence graph", inside "reply" itself — describe what happened in plain language instead ' +
            '(the EVn label goes ONLY in the separate contradictsEvidenceRef field). Keep questions concise ' +
            '(1-3 sentences). Separately, if the candidate\'s LATEST statement is a claim not already ' +
            'confirmed or contradicted by the evidence above (e.g. a general self-description, a claimed ' +
            'habit, or a plan for the future) — set "needsInvestigation": true and "probeCandidates": 1-3 ' +
            'short concrete follow-up questions that would verify it (e.g. "What specifically would you ' +
            'check first?", "How would you know that worked?") — these are for the record, not necessarily ' +
            'ones you ask right now. Omit both fields (or set needsInvestigation false) when the statement ' +
            'is already fully backed or already contradicted. This ' +
            `conversation has had ${candidateTurns} candidate replies so far; once you've covered ` +
            `${targetMin}-${targetMax} exchanges and have enough to assess judgment, set ` +
            '"done": true. When done, reply with ONLY a brief (1 sentence) acknowledgement of their final ' +
            'answer — do NOT write your own closing statement or mention a report, that is handled ' +
            'separately. Return ONLY JSON: {"reply": string, "done": boolean, "contradictsEvidenceRef": ' +
            'string (optional), "contradictionNote": string (optional), "wasJab": boolean (optional), ' +
            '"needsInvestigation": boolean (optional), "probeCandidates": string[] (optional)}.',
        },
        { role: 'user', content: `${brief}\n\nConversation so far:\n${transcriptText}` },
      ],
      { temperature: 0.7, maxTokens: 350 },
    );

    const llmReplyRaw = stripEvidenceLabels(result.reply ?? 'Thanks for walking me through that.');
    const done = Boolean(result.done) || willEnd;

    // §5.8 Conversation Memory — deterministic callback to a specific earlier
    // (non-contradictory) detail, injected once per interview rather than
    // hoping the LLM volunteers it (see note above on why the prompt-only
    // version didn't hold up). Never on the closing turn, which has its own
    // fixed acknowledgement-only shape.
    const llmReply =
      callbackSnippet && !done ? `Earlier you mentioned "${callbackSnippet}" — ${llmReplyRaw}` : llmReplyRaw;

    // §5.4 — deterministic variation banks instead of trusting the LLM to
    // vary its own closing/filler phrasing, which tends to converge on the
    // same few templates over many sessions.
    const reply = done
      ? `${llmReply} ${pick(CLOSING_LINES)} ${pick(REPORT_READY_MESSAGES)}`.trim()
      : Math.random() < MICRO_ACK_PROBABILITY
        ? `${pick(MICRO_ACKS)} ${llmReply}`
        : llmReply;

    transcript.push({ role: 'interviewer', content: reply });

    // §5.2 — the candidate's statement becomes graph evidence, and a
    // confirmed contradiction becomes a real edge (which also recomputes
    // confidence scores on both sides via EvidenceGraphService).
    const statementEvidence = await this.evidence.createEvidence({
      hyrteSessionId: sessionId,
      candidateId,
      source: 'INTERVIEW',
      type: 'INTERVIEW_STATEMENT',
      rawText: message,
      needsInvestigation: Boolean(result.needsInvestigation),
      probeCandidates: result.needsInvestigation ? (result.probeCandidates ?? []).slice(0, 3) : [],
      metadata: isRepeat ? { antiGamingFlag: 'repetitive_answer' } : undefined,
    });
    const contradictedRef = result.contradictsEvidenceRef && refs.find((r) => r.label === result.contradictsEvidenceRef);
    if (contradictedRef) {
      this.evidence
        .linkEvidence(statementEvidence.id, contradictedRef.id, 'CONTRADICTS', result.contradictionNote)
        .catch((e) => this.logger.warn(`linkEvidence failed (session ${sessionId}): ${errMsg(e)}`));
    }

    await this.prisma.hyrteSession.update({
      where: { id: sessionId },
      data: {
        interviewTranscript: transcript as unknown as Prisma.InputJsonValue,
        ...(bossModeActive && result.wasJab ? { interviewJabCount: jabCount + 1 } : {}),
        ...(done ? { phase: 'REPORT' } : {}),
      },
    });

    if (done) {
      this.generateReport(sessionId).catch((e) => this.logger.warn(`generateReport failed: ${errMsg(e)}`));
    }

    return { reply, done };
  }

  async generateReport(sessionId: string): Promise<void> {
    const session = await this.prisma.hyrteSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const transcript = (session.interviewTranscript as unknown as TranscriptTurn[]) ?? [];
    const { text: brief, refs: evidenceRefs } = await this.buildEvidenceBrief(sessionId);
    const transcriptText = transcript.map((t) => `${t.role === 'candidate' ? 'Candidate' : 'Interviewer'}: ${t.content}`).join('\n');

    const result = await this.ai.completeJson<ReportResponse>(
      [
        {
          role: 'system',
          content:
            'You are synthesizing a Decision Intelligence Report for a hiring platform. Cross-reference ' +
            "what the candidate actually did in the simulation against what they said in the interview. " +
            'The evidence brief already lists confirmed contradictions detected during the simulation and ' +
            'interview — treat those as ground truth and include them; do not invent additional ones. ' +
            'Return ONLY JSON: {"strengths": string[] (2-4 named strengths), "developmentAreas": string[] ' +
            '(1-3), "contradictions": [{"claimedInInterview": string, "evidenceFromSimulation": string}] ' +
            '(empty array if none found — do not invent contradictions), "recommendation": one of ' +
            '"Strong Fit" | "Fit" | "Weak Fit" | "Not a Fit", "summary": string (3-5 sentences), ' +
            '"evidenceTrail": [{"action": string, "interviewProbe": string, "interpretation": string}] ' +
            '(2-4 entries linking a specific logged action to how it came up in the interview). Every ' +
            'field must be a short, plain-English sentence a non-technical reader can follow — never raw ' +
            'log lines, code, JSON, evidence labels like "EV3", or field names like "actionType".',
        },
        { role: 'user', content: `${brief}\n\nFull interview transcript:\n${transcriptText}` },
      ],
      { temperature: 0.5, maxTokens: 1200 },
    );

    await this.prisma.hyrteInterviewReport.upsert({
      where: { sessionId },
      create: {
        sessionId,
        strengths: result.strengths ?? [],
        developmentAreas: result.developmentAreas ?? [],
        contradictions: (result.contradictions ?? []) as unknown as Prisma.InputJsonValue,
        recommendation: result.recommendation ?? 'Fit',
        summary: result.summary ?? '',
        evidenceTrail: (result.evidenceTrail ?? []) as unknown as Prisma.InputJsonValue,
      },
      update: {
        strengths: result.strengths ?? [],
        developmentAreas: result.developmentAreas ?? [],
        contradictions: (result.contradictions ?? []) as unknown as Prisma.InputJsonValue,
        recommendation: result.recommendation ?? 'Fit',
        summary: result.summary ?? '',
        evidenceTrail: (result.evidenceTrail ?? []) as unknown as Prisma.InputJsonValue,
      },
    });

    // §7 Phase 7 — Decision DNA, Recovery Score, Counterfactual Analysis, the
    // Prediction Engine, and the shared metrics framework. Runs BEFORE the
    // Council (reordered from the original Phase 6→7 sequence) specifically
    // so the Prediction Engine's output exists in time for Decision Cortex to
    // consume it (§6.4, resolved) rather than estimating independently.
    const { predictions } = await this.reportIntelligence
      .compute(sessionId, brief, transcriptText)
      .catch((e) => {
        this.logger.warn(`reportIntelligence.compute failed (session ${sessionId}): ${errMsg(e)}`);
        return { predictions: [] };
      });

    // §6 Decision Council — computes `recommendation` from an actual 9-agent
    // vote tally (overwriting the single-LLM-guess value just upserted) plus
    // the recruiter-facing individual reports, discussion transcript, and
    // Decision Cortex fields (now grounded in the Prediction Engine above).
    // Failure here must not block the candidate from seeing their report.
    await this.council
      .convene(sessionId, brief, transcriptText, predictions, evidenceRefs)
      .catch((e) => this.logger.warn(`council.convene failed (session ${sessionId}): ${errMsg(e)}`));

    await this.prisma.hyrteSession.update({ where: { id: sessionId }, data: { phase: 'COMPLETED' } });
  }

  async getReport(sessionId: string, candidateId: string) {
    await this.assertOwnership(sessionId, candidateId);
    const report = await this.prisma.hyrteInterviewReport.findUnique({ where: { sessionId } });
    if (!report) throw new NotFoundException('Report not generated yet');
    return report;
  }

  async getTranscript(sessionId: string, candidateId: string) {
    const session = await this.assertOwnership(sessionId, candidateId);
    return {
      phase: session.phase,
      transcript: (session.interviewTranscript as unknown as TranscriptTurn[]) ?? [],
    };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function omitMeta(state: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _sessionId, updatedAt: _updatedAt, ...rest } = state;
  return rest;
}
