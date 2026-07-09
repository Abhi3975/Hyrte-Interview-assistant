import { Injectable } from '@nestjs/common';
import { Difficulty } from '@prisma/client';
import { AIService } from '../ai/ai.service';

export interface ConversationTurn {
  role: 'interviewer' | 'candidate';
  content: string;
}

export interface CandidateContext {
  jobRole: string;
  category: string;
  language: string;
  // Extracted from the resume for personalized, resume-aware questioning.
  resumeSummary?: string;
  skills?: string[];
  projects?: string[];
}

export interface AnswerAssessment {
  quality: number;      // 0-100 for this answer
  confidence: number;   // 0-1 perceived confidence
  isWeak: boolean;
  gaps: string[];       // concepts the candidate missed
}

export interface NextTurn {
  action: 'follow_up' | 'next_question' | 'challenge' | 'conclude';
  interviewerText: string;
  // Adaptive difficulty recommendation for the next primary question.
  nextDifficulty: Difficulty;
  assessment: AnswerAssessment;
}

/**
 * Follow-up Engine — the brain of the AI voice interviewer.
 *
 * Given the running transcript + candidate context, it (a) assesses the last
 * answer, (b) decides whether to probe deeper, challenge, move on, or wrap up,
 * and (c) adapts difficulty. Fully model-driven via the AI router so it can
 * generate unlimited contextual follow-ups (e.g. Virtual DOM → reconciliation
 * → render optimization) instead of a fixed script.
 */
@Injectable()
export class FollowUpEngine {
  constructor(private readonly ai: AIService) {}

  async nextTurn(
    context: CandidateContext,
    transcript: ConversationTurn[],
    currentDifficulty: Difficulty,
  ): Promise<NextTurn> {
    const system = [
      'You are a warm but rigorous human-like technical interviewer conducting a live voice interview.',
      `Role: ${context.jobRole}. Domain: ${context.category}. Speak in: ${context.language}.`,
      context.resumeSummary ? `Candidate resume summary: ${context.resumeSummary}` : '',
      context.skills?.length ? `Skills: ${context.skills.join(', ')}.` : '',
      context.projects?.length ? `Projects: ${context.projects.join('; ')}.` : '',
      'Rules:',
      '- Ask ONE thing at a time, conversationally, as speech (no markdown).',
      '- If the last answer is weak or incomplete, ask a targeted follow-up that probes the specific gap.',
      '- If strong, either challenge with a harder angle or advance to the next topic.',
      '- Adapt difficulty: raise it when they do well, lower it when they struggle.',
      '- Personalize using the resume/projects where relevant.',
      'Return ONLY JSON: {action:"follow_up"|"next_question"|"challenge"|"conclude",',
      'interviewerText:string, nextDifficulty:"EASY"|"MEDIUM"|"HARD"|"EXPERT",',
      'assessment:{quality:number,confidence:number,isWeak:boolean,gaps:string[]}}',
    ]
      .filter(Boolean)
      .join('\n');

    const convo = transcript
      .map((t) => `${t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.content}`)
      .join('\n');

    const result = await this.ai.completeJson<NextTurn>(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Current difficulty: ${currentDifficulty}.\nConversation so far:\n${convo}\n\nProduce the interviewer's next turn.`,
        },
      ],
      // Slightly warm so phrasing feels human, but not erratic.
      { temperature: 0.6, maxTokens: 600, provider: 'anthropic' },
    );

    return this.normalize(result, currentDifficulty);
  }

  /** Opening turn: introduce, verify identity, set expectations. */
  async introduction(context: CandidateContext): Promise<string> {
    const result = await this.ai.complete(
      [
        {
          role: 'system',
          content:
            'You are a friendly AI interviewer. Give a short spoken introduction (2-3 sentences): greet, ' +
            'state you are the AI interviewer, mention the role, and ask the candidate to confirm their name to begin. ' +
            `Speak in: ${context.language}. No markdown.`,
        },
        { role: 'user', content: `Role: ${context.jobRole}, domain: ${context.category}.` },
      ],
      { temperature: 0.6, maxTokens: 200 },
    );
    return result.text.trim();
  }

  private normalize(raw: NextTurn, fallbackDifficulty: Difficulty): NextTurn {
    const valid: Difficulty[] = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'];
    const actions = ['follow_up', 'next_question', 'challenge', 'conclude'] as const;
    return {
      action: actions.includes(raw.action) ? raw.action : 'next_question',
      interviewerText: raw.interviewerText?.trim() || 'Could you tell me more about that?',
      nextDifficulty: valid.includes(raw.nextDifficulty) ? raw.nextDifficulty : fallbackDifficulty,
      assessment: {
        quality: clamp(raw.assessment?.quality ?? 50, 0, 100),
        confidence: clamp(raw.assessment?.confidence ?? 0.5, 0, 1),
        isWeak: Boolean(raw.assessment?.isWeak),
        gaps: (raw.assessment?.gaps ?? []).slice(0, 5),
      },
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number(n) || 0));
}
