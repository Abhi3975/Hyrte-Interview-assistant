import { z } from 'zod';

/**
 * Centralized, validated environment configuration.
 * Fails fast at boot if required variables are missing or malformed.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_REPLICA_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(1_209_600),

  // AI providers — all optional; the router uses whatever is configured.
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  AI_DEFAULT_PROVIDER: z
    .enum(['openai', 'anthropic', 'gemini', 'deepseek', 'groq'])
    .default('openai'),
  AI_DEFAULT_MODEL: z.string().default('gpt-4o-mini'),

  // Aggregator sources
  HUGGINGFACE_TOKEN: z.string().optional(),
  KAGGLE_USERNAME: z.string().optional(),
  KAGGLE_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),

  CODE_EXEC_URL: z.string().optional(),
  CODE_EXEC_TOKEN: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  PROCTOR_WEBHOOK_SECRET: z.string().default('change-me-proctor-secret'),

  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(): AppConfig {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Surface a readable error and stop the process — no half-booted app.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
