import { Injectable, Logger } from '@nestjs/common';
import { AIService } from '../../ai/ai.service';
import { EvidenceGraphService } from './evidence-graph.service';
import { CandidateIntelligenceCardService } from './candidate-intelligence-card.service';

interface ExtractedClaim {
  rawText: string;
  needsInvestigation?: boolean;
  probeCandidates?: string[];
}

interface ClaimExtractionResponse {
  claims?: ExtractedClaim[];
}

interface GitHubProfile {
  login: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  topRepos: { name: string; description: string | null; language: string | null; stars: number; pushedAt: string }[];
}

const MAX_CLAIMS = 8;
const MAX_REPOS = 5;

/**
 * §0/§3.1 intake pipeline — the "Resume + LinkedIn/GitHub" half of the
 * architecture diagram that feeds the Shared Candidate Brain (Candidate
 * Evidence Graph). Previously nothing external fed the graph at all — every
 * EvidenceObject came from inside a HYRTE session (simulation actions,
 * interview statements). This writes candidate-level evidence (no
 * `hyrteSessionId`), so it's available to any future HYRTE session for that
 * candidate, not scoped to one.
 *
 * LinkedIn note: there is no scrape/OAuth integration — LinkedIn's real API
 * requires Partner Program approval, not achievable here. This ingests a
 * self-reported LinkedIn summary the candidate pastes themselves, parsed
 * into evidence the same way a resume is — genuinely still LINKEDIN-sourced
 * evidence per the schema, just not live-scraped. GitHub, by contrast, is
 * real public API ingestion — no auth needed for public profile data.
 */
@Injectable()
export class ProfileIngestionService {
  private readonly logger = new Logger(ProfileIngestionService.name);

  constructor(
    private readonly ai: AIService,
    private readonly evidence: EvidenceGraphService,
    private readonly intelligenceCard: CandidateIntelligenceCardService,
  ) {}

  async ingestResume(candidateId: string, resumeText: string): Promise<{ ingested: number }> {
    const claims = await this.extractClaims(
      resumeText,
      'resume',
      'Example: "Improved conversion by 35%" is one claim, not a summary sentence.',
    );
    return this.writeAndRefresh(candidateId, claims, 'RESUME', 'RESUME_CLAIM');
  }

  async ingestLinkedIn(candidateId: string, linkedinSummary: string): Promise<{ ingested: number }> {
    const claims = await this.extractClaims(
      linkedinSummary,
      'LinkedIn profile summary (self-reported by the candidate, not scraped)',
      'Treat it exactly like a resume for claim extraction — headline achievements, scope claims, metrics.',
    );
    return this.writeAndRefresh(candidateId, claims, 'LINKEDIN', 'LINKEDIN_SIGNAL');
  }

  async ingestGitHub(candidateId: string, username: string): Promise<{ ingested: number }> {
    const profile = await this.fetchGitHubProfile(username);
    if (!profile) return { ingested: 0 };
    const claims = await this.synthesizeGitHubSignals(profile);
    return this.writeAndRefresh(candidateId, claims, 'GITHUB', 'SKILL_DEMONSTRATION');
  }

  private async extractClaims(text: string, sourceLabel: string, extraGuidance: string): Promise<ExtractedClaim[]> {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const result = await this.ai.completeJson<ClaimExtractionResponse>(
      [
        {
          role: 'system',
          content:
            `Decompose this ${sourceLabel} into individual, checkable claims (§3.1) — not a summary. ` +
            `${extraGuidance} Skip generic filler (objective statements, soft-skill adjectives with nothing ` +
            'concrete attached) and skip purely factual lines (a job title, a date range) that need no ' +
            'investigation. For every claim that includes a metric, an outcome, or a scope-of-responsibility ' +
            'claim, set "needsInvestigation": true and 1-3 "probeCandidates" — concrete follow-up questions ' +
            'that would verify it (e.g. "What was the baseline?", "What was your personal contribution vs the ' +
            `team's?", "How was it measured?"). Return ONLY JSON: {"claims": [{"rawText": string, ` +
            `"needsInvestigation": boolean, "probeCandidates": string[]}] (max ${MAX_CLAIMS})}.`,
        },
        { role: 'user', content: trimmed.slice(0, 6000) },
      ],
      { temperature: 0.3, maxTokens: 1200 },
    );
    return (result.claims ?? []).filter((c) => c.rawText?.trim()).slice(0, MAX_CLAIMS);
  }

  private async fetchGitHubProfile(username: string): Promise<GitHubProfile | null> {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json', 'user-agent': 'hyrte-app' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    try {
      const [userRes, reposRes] = await Promise.all([
        fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers }),
        fetch(`https://api.github.com/users/${encodeURIComponent(username)}/repos?sort=pushed&per_page=${MAX_REPOS}`, {
          headers,
        }),
      ]);
      if (!userRes.ok) return null;
      const user = (await userRes.json()) as Record<string, unknown>;
      const repos = reposRes.ok ? await reposRes.json() : [];

      return {
        login: user.login as string,
        bio: (user.bio as string) ?? null,
        publicRepos: (user.public_repos as number) ?? 0,
        followers: (user.followers as number) ?? 0,
        topRepos: (Array.isArray(repos) ? repos : []).map((r: Record<string, unknown>) => ({
          name: r.name as string,
          description: (r.description as string) ?? null,
          language: (r.language as string) ?? null,
          stars: (r.stargazers_count as number) ?? 0,
          pushedAt: r.pushed_at as string,
        })),
      };
    } catch (e) {
      this.logger.warn(`GitHub fetch failed for "${username}": ${errMsg(e)}`);
      return null;
    }
  }

  /** Real, observed GitHub activity is itself the evidence — no claim to "verify" the way a resume line needs. */
  private async synthesizeGitHubSignals(profile: GitHubProfile): Promise<ExtractedClaim[]> {
    if (profile.publicRepos === 0 && profile.topRepos.length === 0) return [];
    const result = await this.ai.completeJson<ClaimExtractionResponse>(
      [
        {
          role: 'system',
          content:
            'Given this GitHub profile data, write 1-4 short, factual skill-demonstration statements — what ' +
            'the activity itself shows (languages used, project focus, recency/consistency of contributions). ' +
            'These are OBSERVED signals, not unverified claims — set "needsInvestigation": false for all of ' +
            'them (nothing here needs a follow-up question; it is already directly observable). Never invent ' +
            'anything not present in the data below. Return ONLY JSON: {"claims": [{"rawText": string, ' +
            '"needsInvestigation": false}] (max 4)}.',
        },
        { role: 'user', content: JSON.stringify(profile) },
      ],
      { temperature: 0.3, maxTokens: 500 },
    );
    return (result.claims ?? []).filter((c) => c.rawText?.trim()).slice(0, 4);
  }

  private async writeAndRefresh(
    candidateId: string,
    claims: ExtractedClaim[],
    source: 'RESUME' | 'LINKEDIN' | 'GITHUB',
    type: 'RESUME_CLAIM' | 'LINKEDIN_SIGNAL' | 'SKILL_DEMONSTRATION',
  ): Promise<{ ingested: number }> {
    await Promise.all(
      claims.map((c) =>
        this.evidence
          .createEvidence({
            candidateId,
            source,
            type,
            rawText: c.rawText,
            needsInvestigation: c.needsInvestigation ?? false,
            probeCandidates: c.probeCandidates ?? [],
          })
          .catch((e) => this.logger.warn(errMsg(e))),
      ),
    );
    if (claims.length > 0) {
      await this.intelligenceCard.refresh(candidateId).catch((e) => this.logger.warn(errMsg(e)));
    }
    return { ingested: claims.length };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
