import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  ProviderName,
} from './providers/provider.interface';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';

export interface RouteOptions extends CompletionOptions {
  /** Pin a specific provider; otherwise the default + fallback chain is used. */
  provider?: ProviderName;
}

/**
 * AI Router.
 *
 * Registers every configured provider and routes completion requests with an
 * ordered fallback chain, so one vendor outage never takes the platform down.
 * A per-request `provider` pin skips the chain when a specific model is needed
 * (e.g. always Claude for nuanced behavioral evaluation).
 */
@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly providers = new Map<ProviderName, AIProvider>();
  private readonly fallbackOrder: ProviderName[];

  constructor() {
    const register = (p: AIProvider) => this.providers.set(p.name, p);

    register(
      new OpenAICompatibleProvider(
        'openai',
        'https://api.openai.com/v1',
        process.env.OPENAI_API_KEY,
        'gpt-4o-mini',
      ),
    );
    register(new AnthropicProvider(process.env.ANTHROPIC_API_KEY));
    register(new GeminiProvider(process.env.GEMINI_API_KEY));
    register(
      new OpenAICompatibleProvider(
        'deepseek',
        'https://api.deepseek.com/v1',
        process.env.DEEPSEEK_API_KEY,
        'deepseek-chat',
      ),
    );
    register(
      new OpenAICompatibleProvider(
        'groq',
        'https://api.groq.com/openai/v1',
        process.env.GROQ_API_KEY,
        'llama-3.3-70b-versatile',
      ),
    );

    const preferred = (process.env.AI_DEFAULT_PROVIDER as ProviderName) ?? 'openai';
    // Preferred first, then the rest, deduped.
    this.fallbackOrder = [
      preferred,
      ...(['openai', 'anthropic', 'gemini', 'groq', 'deepseek'] as ProviderName[]).filter(
        (p) => p !== preferred,
      ),
    ];
  }

  availableProviders(): ProviderName[] {
    return [...this.providers.values()].filter((p) => p.isAvailable()).map((p) => p.name);
  }

  async complete(messages: ChatMessage[], options: RouteOptions = {}): Promise<CompletionResult> {
    // A pinned provider is a *preference*: try it first, then fall back to the
    // rest of the chain so an unconfigured pin (e.g. Claude for voice when only
    // OpenAI is set) never takes the feature down.
    const chain = options.provider
      ? [options.provider, ...this.fallbackOrder.filter((p) => p !== options.provider)]
      : this.fallbackOrder;
    const errors: string[] = [];

    for (const name of chain) {
      const provider = this.providers.get(name);
      if (!provider?.isAvailable()) continue;
      try {
        return await provider.complete(messages, options);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Provider ${name} failed, trying next: ${msg}`);
        errors.push(`${name}: ${msg}`);
      }
    }

    throw new ServiceUnavailableException(
      `No AI provider could serve the request. ${errors.join(' | ') || 'None configured.'}`,
    );
  }

  /**
   * Convenience helper: request strict JSON and parse it, retrying once on a
   * malformed response by asking the model to repair its own output.
   */
  async completeJson<T>(messages: ChatMessage[], options: RouteOptions = {}): Promise<T> {
    const result = await this.complete(messages, { ...options, json: true });
    try {
      return JSON.parse(extractJson(result.text)) as T;
    } catch {
      const repair = await this.complete(
        [
          ...messages,
          { role: 'assistant', content: result.text },
          {
            role: 'user',
            content: 'Your previous message was not valid JSON. Reply with ONLY valid JSON.',
          },
        ],
        { ...options, json: true },
      );
      return JSON.parse(extractJson(repair.text)) as T;
    }
  }
}

/** Strip markdown fences / prose that some models wrap around JSON. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const arrStart = text.indexOf('[');
  const first = [start, arrStart].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return text.trim();
  const lastObj = text.lastIndexOf('}');
  const lastArr = text.lastIndexOf(']');
  const last = Math.max(lastObj, lastArr);
  return text.slice(first, last + 1).trim();
}
