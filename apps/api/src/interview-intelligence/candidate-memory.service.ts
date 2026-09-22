import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { questionSimilarity } from '../hyrte/generator/question-variety';

/**
 * AI-interviewer checklist #9 (Memory & Learning System) and the emotionally-
 * adaptive doc's Layer 3:
 *
 *   "Long-term memory: candidate performance history, weak areas, growth over
 *    time. Example: 'Last time you struggled with structuring answers — try
 *    using frameworks here.' This creates continuity across sessions."
 *
 * What already existed was thinner than it looked: a practice-only line in the
 * interview's OPENING prompt carrying the prior recommendation and a Decision
 * DNA trait list, suggested to the model as something it "may reference
 * naturally if it fits". That is a fact about a past session, not a weak area,
 * it was never available during the interview itself, and — as this codebase
 * has learned repeatedly — "you may mention this if it fits" loses to the
 * dozen other directives in the same prompt.
 *
 * This reads the real thing: `developmentAreas` from the candidate's prior
 * reports, ranked by how often the same weakness has come back. A weakness
 * seen twice is a pattern; a weakness seen once is a bad day.
 *
 * Two consumers, doing genuinely different things with it:
 *  - the interviewer, which can name it to the candidate as coaching;
 *  - the live committee, which starts MORE sceptical about a competency this
 *    candidate has repeatedly been marked down on, rather than less.
 */

export interface RecurringWeakness {
  /** The development area as it was actually written in the report. */
  area: string;
  /** How many prior sessions flagged it. 2+ is a pattern worth naming. */
  timesSeen: number;
  lastSeenAt: Date;
}

/** Below this, it is one bad session rather than something to raise. */
const PATTERN_THRESHOLD = 2;

/**
 * How close two development areas must read to count as the same weakness.
 *
 * Deliberately looser than the warm-up de-duplication threshold this borrows
 * its similarity function from, and that difference is the point: warm-up
 * questions are generated against a fixed axis and phrase themselves
 * similarly, whereas a report writes each development area freshly in prose.
 * Caught by test: "Answers lacked a clear structure" and "Struggled to
 * structure answers clearly" are plainly the same finding and score only 0.33,
 * because "clear"/"clearly" and "lacked"/"struggled" share no stem.
 *
 * Distinct weaknesses ("did not quantify business impact" vs "stakeholder
 * management was not evidenced") share no content words at all and score 0, so
 * there is a lot of room below this before anything over-merges.
 */
const SAME_WEAKNESS_THRESHOLD = 0.32;

/** A weakness sentence matched against a short competency label — a different shape again, so its own bar. */
const WEAKNESS_TO_COMPETENCY_THRESHOLD = 0.3;
/** Prior reports to look back over — a candidate's whole history, in practice. */
const HISTORY_LIMIT = 10;

@Injectable()
export class CandidateMemoryService {
  private readonly logger = new Logger(CandidateMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Development areas that have come back across sessions, most persistent
   * first. Near-duplicate wordings are merged — "struggled to structure
   * answers" and "answers lacked structure" are the same weakness, and two
   * reports will rarely phrase it identically.
   */
  async getRecurringWeaknesses(candidateId: string, excludeSessionId?: string): Promise<RecurringWeakness[]> {
    try {
      const reports = await this.prisma.hyrteInterviewReport.findMany({
        where: { session: { candidateId }, ...(excludeSessionId ? { sessionId: { not: excludeSessionId } } : {}) },
        orderBy: { generatedAt: 'desc' },
        take: HISTORY_LIMIT,
        select: { developmentAreas: true, generatedAt: true },
      });

      const clusters: RecurringWeakness[] = [];
      for (const report of reports) {
        for (const raw of report.developmentAreas) {
          const area = raw.trim();
          if (area.length < 8) continue;
          // Reuses the content-word similarity built for warm-up de-duplication
          // — same problem, two phrasings of one idea.
          const existing = clusters.find((c) => questionSimilarity(c.area, area) >= SAME_WEAKNESS_THRESHOLD);
          if (existing) {
            existing.timesSeen += 1;
            // Keep the earliest-seen wording; it is the one the candidate has
            // had longest to act on.
            if (report.generatedAt > existing.lastSeenAt) existing.lastSeenAt = report.generatedAt;
          } else {
            clusters.push({ area, timesSeen: 1, lastSeenAt: report.generatedAt });
          }
        }
      }
      return clusters.sort((a, b) => b.timesSeen - a.timesSeen || b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    } catch (e) {
      this.logger.warn(`Candidate memory lookup failed for ${candidateId}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  /**
   * The line the interviewer actually says, or null when there is nothing
   * honest to say.
   *
   * Composed in code rather than left to the model, for the reason this
   * codebase has hit twice already: an optional "mention this if it fits"
   * instruction competing with a dozen others loses. Given to the prompt as
   * text to deliver, it gets delivered.
   *
   * Deliberately framed as coaching rather than as a charge — the checklist
   * is explicit that this system builds confidence while it evaluates, and
   * "you were bad at this before" does the opposite.
   */
  buildCallback(weaknesses: RecurringWeakness[], targetLabel?: string | null): string | null {
    const pattern = weaknesses.filter((w) => w.timesSeen >= PATTERN_THRESHOLD);
    if (pattern.length === 0) return null;

    // Prefer a weakness that bears on what is being probed right now — a
    // callback that arrives with the relevant question is coaching; the same
    // words dropped at a random moment are just a remark.
    const relevant = targetLabel ? pattern.find((w) => questionSimilarity(w.area, targetLabel) >= WEAKNESS_TO_COMPETENCY_THRESHOLD) : undefined;
    const chosen = relevant ?? pattern[0];

    return (
      `CONTINUITY (say this naturally, once, when it genuinely helps — never as criticism): across ${chosen.timesSeen} ` +
      `previous sessions this candidate has repeatedly been marked down on: "${chosen.area}". If the conversation ` +
      `reaches that ground, acknowledge it as something they have been working on and give them a concrete way to ` +
      `show it differently this time (e.g. suggesting they structure the answer before giving it). Do not open with ` +
      `it, do not list it as a failing, and never mention reports or scores.`
    );
  }

  /**
   * The committee's use of the same memory: a competency this candidate has
   * repeatedly been marked down on needs MORE evidence than usual before it
   * counts as proven, not less. Returns the competency keys to hold to a
   * higher bar.
   */
  matchWeaknessesToCompetencies(weaknesses: RecurringWeakness[], competencies: { key: string; label: string }[]): string[] {
    const pattern = weaknesses.filter((w) => w.timesSeen >= PATTERN_THRESHOLD);
    return competencies
      .filter((c) => pattern.some((w) => questionSimilarity(w.area, c.label) >= WEAKNESS_TO_COMPETENCY_THRESHOLD))
      .map((c) => c.key);
  }
}
