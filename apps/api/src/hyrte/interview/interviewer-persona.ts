import type { Difficulty } from '@prisma/client';

/**
 * §5.6 Interviewer personalities. HYRTE's reflection interview has no
 * separate personality-selection UI (unlike the main product's practice
 * room), so the base tone is derived from the session's own difficulty —
 * EASY/MEDIUM map to the supportive end, HARD/EXPERT to the demanding end —
 * and the "Company Culture Injection" voice (§5.6 NEW) layers on top from
 * `companyType`, matching the doc's startup/enterprise/consulting examples.
 */
export function getBaseTone(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'EASY':
      return 'PERSONALITY: Friendly & Supportive. Warm, encouraging, patient — put the candidate at ease.';
    case 'MEDIUM':
      return 'PERSONALITY: Professional & Polite. Neutral, precise, structured, minimal small talk.';
    case 'HARD':
      return 'PERSONALITY: Strict & High-pressure. Rigorous, push for specifics and rigor, concise, high standards (never rude).';
    case 'EXPERT':
      return 'PERSONALITY: Strict & High-pressure, senior-bar-raiser register. Expect strong, evidence-backed reasoning; push back on vague answers.';
  }
}

/** §5.6 NEW — same underlying question, phrased in the company's actual voice. */
export function getCompanyVoice(companyType: string): string {
  switch (companyType) {
    case 'Startup':
      return "COMPANY VOICE: You work at a fast-moving startup. You're less interested in perfection than in how quickly the candidate learns and adapts — say so in your own words when it fits.";
    case 'Enterprise':
      return 'COMPANY VOICE: You work at a large enterprise. You care about process, governance, and how decisions get made across stakeholders — ask about that when it fits.';
    case 'SME':
      return 'COMPANY VOICE: You work at a mid-sized, resource-constrained company. You care about pragmatic trade-offs and doing more with less — frame questions that way when it fits.';
    case 'Consulting':
      return "COMPANY VOICE: You work in a consulting-style environment. You're structured and analytical — phrases like \"walk me through your assumptions\" fit your voice.";
    case 'Government':
      return 'COMPANY VOICE: You work in a government/public-sector context. You care about documentation, policy compliance, and defensible process — reflect that in tone.';
    default:
      return '';
  }
}

/** §5.7 Off-script handling — at least 10 templates across common out-of-scope categories. */
const OFF_SCRIPT_PATTERNS: { pattern: RegExp; responses: string[] }[] = [
  {
    pattern: /salary|compensation|pay\s*range|how much.*(pay|earn)/i,
    responses: [
      "That's a great question for the actual hiring conversation — for this reflection interview, let's stay focused on how you approached the simulation.",
      "Compensation isn't something I have visibility into for this exercise — happy to keep going on the simulation itself.",
    ],
  },
  {
    pattern: /are you (a |an )?(real|human|ai|a bot|chatgpt|robot)/i,
    responses: [
      "I'm an AI interviewer built for this platform — but the evaluation is very real. Let's get back to it.",
      "Good question — I'm an AI, and I'm here to understand your thinking, not catch you out.",
    ],
  },
  {
    pattern: /can we (skip|end|finish|wrap up) (this|early|now)|are we (almost )?done/i,
    responses: [
      "We're close — a couple more questions and we'll wrap up naturally.",
      "I hear you — let's get through a couple more and then we'll close out.",
    ],
  },
  {
    pattern: /how (am i|did i) do(ing)?|what'?s my score|am i (passing|failing)/i,
    responses: [
      "I'll have a full report for you once we're done — I don't want to bias how you answer the rest by scoring you mid-way.",
      "You'll see the full picture in your report at the end — let's keep going.",
    ],
  },
  {
    pattern: /remote|work from home|\bwfh\b|office days|hybrid policy/i,
    responses: [
      "That's more of a policy question for the actual recruiting team — outside what I can speak to here.",
      "I don't have details on that logistics side — let's stay with the simulation.",
    ],
  },
];

/** Returns a random matching off-script response, or null if the message is genuinely on-topic. */
export function matchOffScript(message: string): string | null {
  for (const { pattern, responses } of OFF_SCRIPT_PATTERNS) {
    if (pattern.test(message)) return responses[Math.floor(Math.random() * responses.length)];
  }
  return null;
}

/**
 * §5.9 Boss Level guardrails — distress/opt-out detection is a hard, code-
 * level override, never left to the LLM's own judgment about when to soften.
 */
const DISTRESS_OPT_OUT_PATTERN =
  /please stop|this is too much|i'?m uncomfortable|can we change (the )?tone|i don'?t like this|(feeling|too) stressed|overwhelmed|this feels (harsh|mean|unfair)/i;

export function requestsBossModeExit(message: string): boolean {
  return DISTRESS_OPT_OUT_PATTERN.test(message);
}
