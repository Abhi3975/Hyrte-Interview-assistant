import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
  ProviderName,
} from './provider.interface';

/**
 * OpenAI-compatible chat-completions adapter.
 *
 * OpenAI, DeepSeek, and Groq all expose the same `/chat/completions` shape,
 * so they share this implementation — only base URL, key, and default model
 * differ. This keeps the provider layer DRY.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    readonly name: ProviderName,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly defaultModel: string,
  ) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.apiKey) throw new Error(`${this.name} is not configured`);
    const model = options.model ?? this.defaultModel;

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 1024,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${this.name} error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as any;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      provider: this.name,
      model,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
      },
    };
  }
}
