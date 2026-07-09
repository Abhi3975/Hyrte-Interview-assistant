import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  Category,
  Difficulty,
  LicenseType,
  QuestionSource,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIService } from '../../ai/ai.service';
import { LicenseValidator } from './license-validator';
import { QuestionSourceAdapter, RawQuestion } from './sources/source.interface';
import { HuggingFaceSource } from './sources/huggingface.source';
import { GitHubSource } from './sources/github.source';

interface AggregateOptions {
  category: Category;
  limit?: number;
  generateVariations?: boolean;
  organizationId?: string | null;
}

export interface AggregateReport {
  fetched: number;
  licenseRejected: number;
  duplicates: number;
  stored: number;
  variationsStored: number;
}

/**
 * Question Aggregator Service.
 *
 * Pipeline (per the Question Sources Policy):
 *   Fetch → Validate License → Normalize → Deduplicate →
 *   Categorize → Generate Variations → Store
 *
 * Every stage is independently testable. Nothing is stored until it clears the
 * license gate, so the corpus is compliant by construction.
 */
@Injectable()
export class AggregatorService {
  private readonly logger = new Logger(AggregatorService.name);
  private readonly licenseValidator = new LicenseValidator();
  private readonly sources: QuestionSourceAdapter[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
  ) {
    this.sources = [new HuggingFaceSource(), new GitHubSource()];
  }

  async run(opts: AggregateOptions): Promise<AggregateReport> {
    const limit = opts.limit ?? 50;
    const report: AggregateReport = {
      fetched: 0,
      licenseRejected: 0,
      duplicates: 0,
      stored: 0,
      variationsStored: 0,
    };

    // ── 1. Fetch ──
    const raw: RawQuestion[] = [];
    for (const source of this.sources) {
      if (!source.isAvailable()) continue;
      try {
        const items = await source.fetch(opts.category, limit);
        raw.push(...items);
      } catch (err) {
        this.logger.warn(`Source ${source.name} failed: ${err}`);
      }
    }
    report.fetched = raw.length;

    const seenHashes = new Set<string>();
    for (const item of raw) {
      // ── 2. Validate License ──
      const decision = this.licenseValidator.validate({
        rawLicense: item.rawLicense,
        sourceUrl: item.sourceUrl,
        attribution: item.attribution,
      });
      if (!decision.allowed || !decision.licenseType) {
        report.licenseRejected++;
        this.logger.debug(`Rejected "${item.title}": ${decision.reason}`);
        continue;
      }

      // ── 3. Normalize ──
      const normalized = this.normalize(item, opts.category);

      // ── 4. Deduplicate (in-batch + persisted) ──
      if (seenHashes.has(normalized.contentHash)) {
        report.duplicates++;
        continue;
      }
      seenHashes.add(normalized.contentHash);
      const exists = await this.prisma.question.findFirst({
        where: { contentHash: normalized.contentHash },
        select: { id: true },
      });
      if (exists) {
        report.duplicates++;
        continue;
      }

      // ── 5. Categorize (+ difficulty inference) ──
      const enriched = await this.categorize(normalized, opts.category);

      // ── 6. Store the source question ──
      const stored = await this.store(enriched, {
        source: this.mapSource(item.sourceName),
        licenseType: decision.licenseType,
        licenseMeta: {
          sourceName: item.sourceName,
          sourceUrl: item.sourceUrl,
          attribution: item.attribution,
          requiresAttribution: decision.requiresAttribution,
        },
        organizationId: opts.organizationId ?? null,
      });
      report.stored++;

      // ── 7. Generate Variations (optional, AI-authored → AI_GENERATED license) ──
      if (opts.generateVariations) {
        const variations = await this.generateVariations(enriched, 2);
        for (const v of variations) {
          if (seenHashes.has(v.contentHash)) continue;
          seenHashes.add(v.contentHash);
          await this.store(v, {
            source: 'AI_GENERATED',
            licenseType: 'AI_GENERATED',
            licenseMeta: { sourceName: 'InterviewAI variation engine' },
            organizationId: opts.organizationId ?? null,
            parentId: stored.id,
          });
          report.variationsStored++;
        }
      }
    }

    this.logger.log(
      `Aggregation [${opts.category}] fetched=${report.fetched} stored=${report.stored} ` +
        `variations=${report.variationsStored} rejected=${report.licenseRejected} dupes=${report.duplicates}`,
    );
    return report;
  }

  // ── stage helpers ──

  private normalize(item: RawQuestion, category: Category): NormalizedQuestion {
    const prompt = item.prompt.replace(/\s+/g, ' ').trim();
    const title = item.title.trim().slice(0, 200);
    return {
      title,
      prompt,
      category: item.category ?? category,
      topic: item.topic ?? category.toString(),
      difficulty: item.difficulty ?? 'MEDIUM',
      type: item.type ?? inferType(category),
      expectedAnswer: item.expectedAnswer?.trim(),
      tags: dedupeStrings(item.tags ?? []),
      testCases: item.testCases ?? [],
      contentHash: contentHash(prompt),
    };
  }

  /**
   * Fill in missing difficulty/topic/tags. Uses the AI router when available,
   * otherwise falls back to deterministic defaults so the pipeline never
   * hard-depends on a provider being configured.
   */
  private async categorize(q: NormalizedQuestion, category: Category): Promise<NormalizedQuestion> {
    if (this.ai.availableProviders().length === 0) return q;
    try {
      const result = await this.ai.completeJson<{
        difficulty: Difficulty;
        topic: string;
        tags: string[];
      }>(
        [
          {
            role: 'system',
            content:
              'Classify the interview question. Return JSON {difficulty:"EASY"|"MEDIUM"|"HARD"|"EXPERT", topic:string, tags:string[]}.',
          },
          { role: 'user', content: `Category: ${category}\nQuestion: ${q.prompt}` },
        ],
        { temperature: 0, maxTokens: 200 },
      );
      return {
        ...q,
        difficulty: result.difficulty ?? q.difficulty,
        topic: result.topic ?? q.topic,
        tags: dedupeStrings([...q.tags, ...(result.tags ?? [])]),
      };
    } catch {
      return q;
    }
  }

  private async generateVariations(q: NormalizedQuestion, count: number): Promise<NormalizedQuestion[]> {
    if (this.ai.availableProviders().length === 0) return [];
    try {
      const result = await this.ai.completeJson<{ variations: { title: string; prompt: string }[] }>(
        [
          {
            role: 'system',
            content:
              'Create original variations of the given interview question — same skill/difficulty, different wording and numbers. Return JSON {variations:[{title,prompt}]}.',
          },
          { role: 'user', content: `Make ${count} variations of:\n${q.prompt}` },
        ],
        { temperature: 0.8, maxTokens: 800 },
      );
      return (result.variations ?? []).map((v) => ({
        ...q,
        title: v.title?.slice(0, 200) ?? q.title,
        prompt: v.prompt.replace(/\s+/g, ' ').trim(),
        contentHash: contentHash(v.prompt),
        expectedAnswer: undefined, // regenerate on demand; don't copy source solution
      }));
    } catch {
      return [];
    }
  }

  private async store(
    q: NormalizedQuestion,
    meta: {
      source: QuestionSource;
      licenseType: LicenseType;
      licenseMeta: {
        sourceName: string;
        sourceUrl?: string;
        attribution?: string;
        requiresAttribution?: boolean;
      };
      organizationId: string | null;
      parentId?: string;
    },
  ) {
    const license = await this.prisma.license.create({
      data: {
        type: meta.licenseType,
        sourceName: meta.licenseMeta.sourceName,
        sourceUrl: meta.licenseMeta.sourceUrl,
        attribution: meta.licenseMeta.attribution,
        requiresAttribution: meta.licenseMeta.requiresAttribution ?? false,
      },
    });

    return this.prisma.question.create({
      data: {
        publicId: this.publicId(q.category, q.topic),
        title: q.title,
        prompt: q.prompt,
        category: q.category,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.type,
        tags: q.tags,
        expectedAnswer: q.expectedAnswer,
        source: meta.source,
        licenseId: license.id,
        contentHash: q.contentHash,
        // Aggregated permissive content is auto-approved; it already passed
        // the license gate. User submissions go through manual moderation.
        moderation: 'AUTO_APPROVED',
        organizationId: meta.organizationId,
        parentId: meta.parentId,
        testCases: q.testCases.length
          ? { create: q.testCases.map((t, i) => ({ input: t.input, output: t.output, ordinal: i })) }
          : undefined,
      },
    });
  }

  private mapSource(sourceName: string): QuestionSource {
    const lower = sourceName.toLowerCase();
    if (lower.includes('huggingface')) return 'HUGGINGFACE';
    if (lower.includes('kaggle')) return 'KAGGLE';
    if (lower.includes('github')) return 'GITHUB_PERMISSIVE';
    return 'PUBLIC_DOMAIN';
  }

  private publicId(category: Category, topic: string): string {
    const slug = topic.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'GEN';
    const rand = createHash('sha1').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 6).toUpperCase();
    return `${category}-${slug}-${rand}`;
  }
}

interface NormalizedQuestion {
  title: string;
  prompt: string;
  category: Category;
  topic: string;
  difficulty: Difficulty;
  type: QuestionType;
  expectedAnswer?: string;
  tags: string[];
  testCases: { input: string; output: string }[];
  contentHash: string;
}

// ── pure helpers ──

function contentHash(prompt: string): string {
  // Normalize aggressively so trivial rewrites collide (dedup robustness).
  const canonical = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return createHash('sha256').update(canonical).digest('hex');
}

function dedupeStrings(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

function inferType(category: Category): QuestionType {
  switch (category) {
    case 'DSA':
      return 'CODING';
    case 'SYSTEM_DESIGN':
      return 'SYSTEM_DESIGN';
    case 'HR':
      return 'BEHAVIORAL';
    case 'MBA':
    case 'PRODUCT_MANAGEMENT':
      return 'CASE_STUDY';
    default:
      return 'SHORT_ANSWER';
  }
}
