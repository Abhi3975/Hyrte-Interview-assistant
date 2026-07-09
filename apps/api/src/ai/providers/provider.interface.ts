export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'groq';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // When true, ask the provider for strict JSON output.
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  provider: ProviderName;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * Common contract every AI provider adapter implements. Adapters talk to
 * their vendor's REST API directly so we avoid pinning heavy SDKs and can
 * swap models freely.
 */
export interface AIProvider {
  readonly name: ProviderName;
  /** True only when the provider has credentials configured. */
  isAvailable(): boolean;
  readonly defaultModel: string;
  complete(messages: ChatMessage[], options?: CompletionOptions): Promise<CompletionResult>;
}
