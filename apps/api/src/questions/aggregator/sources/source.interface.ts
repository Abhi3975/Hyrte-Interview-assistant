import { Category, Difficulty, QuestionType } from '@prisma/client';

/** A raw, un-normalized question pulled from an external source. */
export interface RawQuestion {
  externalId?: string;
  title: string;
  prompt: string;
  category?: Category;
  topic?: string;
  difficulty?: Difficulty;
  type?: QuestionType;
  expectedAnswer?: string;
  tags?: string[];
  testCases?: { input: string; output: string }[];
  // License provenance travels with every raw item.
  rawLicense?: string;
  sourceName: string;
  sourceUrl?: string;
  attribution?: string;
}

export interface QuestionSourceAdapter {
  readonly name: string;
  /** True only if the adapter has the credentials/config it needs. */
  isAvailable(): boolean;
  /** Pull up to `limit` raw questions for a category. */
  fetch(category: Category, limit: number): Promise<RawQuestion[]>;
}
