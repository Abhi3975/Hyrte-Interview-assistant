import {
  AIProvider,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from './provider.interface';

/**
 * Google Gemini adapter (generateContent REST API). Gemini uses a
 * `contents` array with `parts`, and folds the system prompt into
 * `system_instruction`.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini' as const;
  readonly defaultModel = 'gemini-2.0-flash';

  constructor(private readonly apiKey: string | undefined) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<CompletionResult> {
    if (!this.apiKey) throw new Error('gemini is not configured');
    const model = options.model ?? this.defaultModel;

    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 1024,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`gemini error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as any;
    const text =
      data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
    return {
      text,
      provider: this.name,
      model,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      },
    };
  }
}
