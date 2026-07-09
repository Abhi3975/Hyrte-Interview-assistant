import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from './provider.interface';

/**
 * Anthropic (Claude) adapter. The Messages API separates the system prompt
 * from the conversation turns, so we split those out here.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic' as const;
  readonly defaultModel = 'claude-sonnet-5';

  constructor(private readonly apiKey: string | undefined) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.apiKey) throw new Error('anthropic is not configured');
    const model = options.model ?? this.defaultModel;

    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: system || undefined,
        messages: turns,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.7,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`anthropic error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as any;
    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    return {
      text,
      provider: this.name,
      model,
      usage: {
        promptTokens: data.usage?.input_tokens,
        completionTokens: data.usage?.output_tokens,
      },
    };
  }
}
