import { Category } from '@prisma/client';
import { QuestionSourceAdapter, RawQuestion } from './source.interface';
import { LicenseValidator } from '../license-validator';

/**
 * GitHub permissively-licensed repository adapter.
 *
 * Before pulling content it checks the repo's license via the GitHub API and
 * skips anything that isn't in the permissive allowlist. This prevents
 * accidental ingestion of copyleft or all-rights-reserved material.
 */
interface RepoConfig {
  owner: string;
  repo: string;
  path: string; // markdown file or directory of questions
  categories: Category[];
}

const REPOS: RepoConfig[] = [
  // Example: a hypothetical permissive open-source interview-prep repo.
  { owner: 'public-interview-prep', repo: 'open-questions', path: 'questions', categories: ['DSA', 'SYSTEM_DESIGN'] },
];

export class GitHubSource implements QuestionSourceAdapter {
  private readonly licenseValidator = new LicenseValidator();
  readonly name = 'github';

  isAvailable(): boolean {
    return true; // unauthenticated works at low rate limits
  }

  async fetch(category: Category, limit: number): Promise<RawQuestion[]> {
    const repos = REPOS.filter((r) => r.categories.includes(category));
    const out: RawQuestion[] = [];

    for (const cfg of repos) {
      if (out.length >= limit) break;
      const license = await this.getRepoLicense(cfg.owner, cfg.repo);
      // Gate at the source: unknown/non-permissive license → skip entirely.
      const decision = this.licenseValidator.validate({
        rawLicense: license ?? undefined,
        sourceUrl: `https://github.com/${cfg.owner}/${cfg.repo}`,
      });
      if (!decision.allowed) continue;

      const items = await this.getMarkdownQuestions(cfg, category, limit - out.length, license);
      out.push(...items);
    }

    return out.slice(0, limit);
  }

  private async getRepoLicense(owner: string, repo: string): Promise<string | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/license`, {
        headers: this.headers(),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      return data.license?.spdx_id ?? null;
    } catch {
      return null;
    }
  }

  private async getMarkdownQuestions(
    cfg: RepoConfig,
    category: Category,
    limit: number,
    license: string | null,
  ): Promise<RawQuestion[]> {
    // Placeholder parser: real implementation would walk the tree and parse
    // structured markdown. Kept resilient so a missing repo returns [].
    try {
      const res = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`,
        { headers: this.headers() },
      );
      if (!res.ok) return [];
      const files = (await res.json()) as any[];
      const out: RawQuestion[] = [];
      for (const file of files.slice(0, limit)) {
        if (!file.name?.endsWith('.md')) continue;
        out.push({
          externalId: file.sha,
          title: file.name.replace(/\.md$/, ''),
          prompt: `See ${file.html_url}`,
          category,
          rawLicense: license ?? undefined,
          sourceName: `GitHub: ${cfg.owner}/${cfg.repo}`,
          sourceUrl: file.html_url,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    return h;
  }
}
