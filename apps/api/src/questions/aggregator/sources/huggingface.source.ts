import { Category } from '@prisma/client';
import { QuestionSourceAdapter, RawQuestion } from './source.interface';

/**
 * HuggingFace datasets adapter.
 *
 * Uses the public datasets-server `rows` endpoint. Each configured dataset is
 * paired with its known license so the LicenseValidator can gate ingestion.
 * Only permissively-licensed datasets are listed here.
 */
interface HFDatasetConfig {
  repo: string;
  config: string;
  split: string;
  license: string; // must pass the allowlist
  categories: Category[];
  map: (row: Record<string, any>) => Partial<RawQuestion> | null;
}

const DATASETS: HFDatasetConfig[] = [
  {
    repo: 'openai/openai_humaneval',
    config: 'openai_humaneval',
    split: 'test',
    license: 'mit',
    categories: ['DSA', 'BACKEND'],
    map: (row) => ({
      title: row.task_id ?? 'HumanEval task',
      prompt: row.prompt ?? '',
      expectedAnswer: row.canonical_solution,
    }),
  },
  {
    repo: 'mbpp',
    config: 'full',
    split: 'test',
    license: 'cc-by-4.0',
    categories: ['DSA'],
    map: (row) => ({
      title: `MBPP #${row.task_id}`,
      prompt: row.text ?? row.prompt ?? '',
      expectedAnswer: row.code,
      attribution: 'Google Research — MBPP (CC-BY-4.0)',
    }),
  },
];

export class HuggingFaceSource implements QuestionSourceAdapter {
  readonly name = 'huggingface';

  isAvailable(): boolean {
    // Public datasets work without a token; a token just raises rate limits.
    return true;
  }

  async fetch(category: Category, limit: number): Promise<RawQuestion[]> {
    const configs = DATASETS.filter((d) => d.categories.includes(category));
    const out: RawQuestion[] = [];

    for (const cfg of configs) {
      if (out.length >= limit) break;
      const url = new URL('https://datasets-server.huggingface.co/rows');
      url.searchParams.set('dataset', cfg.repo);
      url.searchParams.set('config', cfg.config);
      url.searchParams.set('split', cfg.split);
      url.searchParams.set('offset', '0');
      url.searchParams.set('length', String(Math.min(limit - out.length, 100)));

      const headers: Record<string, string> = {};
      if (process.env.HUGGINGFACE_TOKEN) {
        headers.authorization = `Bearer ${process.env.HUGGINGFACE_TOKEN}`;
      }

      try {
        const res = await fetch(url, { headers });
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        for (const item of data.rows ?? []) {
          const mapped = cfg.map(item.row ?? {});
          if (!mapped?.prompt) continue;
          out.push({
            title: mapped.title ?? 'Untitled',
            prompt: mapped.prompt,
            expectedAnswer: mapped.expectedAnswer,
            category,
            rawLicense: cfg.license,
            sourceName: `HuggingFace: ${cfg.repo}`,
            sourceUrl: `https://huggingface.co/datasets/${cfg.repo}`,
            attribution: mapped.attribution,
          });
        }
      } catch {
        // A single dataset failing must not abort the whole run.
        continue;
      }
    }

    return out.slice(0, limit);
  }
}
