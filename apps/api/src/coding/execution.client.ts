import { Injectable, Logger } from '@nestjs/common';

/**
 * Thin client for a self-hosted Judge0 execution sandbox.
 *
 * Judge0 runs untrusted candidate code in isolated cgroups with CPU/memory/
 * wall-time limits — the safe way to execute submissions at scale. We submit
 * synchronously (wait=true) per test case; a queue-based mode is used for
 * heavy load (see docs). If Judge0 isn't configured the client reports
 * unavailable and the caller degrades gracefully.
 */

// Common Judge0 language IDs. Extend as needed.
export const JUDGE0_LANGUAGES: Record<string, number> = {
  javascript: 63, // Node.js
  typescript: 74,
  python: 71,
  java: 62,
  cpp: 54,
  c: 50,
  go: 60,
  rust: 73,
};

export interface ExecResult {
  status: string;      // e.g. "Accepted", "Wrong Answer", "Runtime Error"
  stdout: string | null;
  stderr: string | null;
  compileOutput: string | null;
  timeMs: number | null;
  memoryKb: number | null;
}

@Injectable()
export class ExecutionClient {
  private readonly logger = new Logger(ExecutionClient.name);
  private readonly baseUrl = process.env.CODE_EXEC_URL;
  private readonly token = process.env.CODE_EXEC_TOKEN;

  isAvailable(): boolean {
    return Boolean(this.baseUrl);
  }

  languageId(language: string): number | null {
    return JUDGE0_LANGUAGES[language.toLowerCase()] ?? null;
  }

  async run(params: {
    language: string;
    source: string;
    stdin: string;
    expectedOutput?: string;
    cpuTimeLimitSec?: number;
    memoryLimitKb?: number;
  }): Promise<ExecResult> {
    if (!this.baseUrl) throw new Error('Code execution engine not configured');
    const langId = this.languageId(params.language);
    if (!langId) throw new Error(`Unsupported language: ${params.language}`);

    const res = await fetch(`${this.baseUrl}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { 'X-Auth-Token': this.token } : {}),
      },
      body: JSON.stringify({
        language_id: langId,
        source_code: params.source,
        stdin: params.stdin,
        expected_output: params.expectedOutput,
        cpu_time_limit: params.cpuTimeLimitSec ?? 5,
        memory_limit: params.memoryLimitKb ?? 256_000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Judge0 error ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as any;
    return {
      status: data.status?.description ?? 'Unknown',
      stdout: data.stdout ?? null,
      stderr: data.stderr ?? null,
      compileOutput: data.compile_output ?? null,
      timeMs: data.time ? Math.round(Number(data.time) * 1000) : null,
      memoryKb: data.memory ?? null,
    };
  }
}
