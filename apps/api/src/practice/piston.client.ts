import { Injectable, Logger } from '@nestjs/common';

/**
 * Zero-config code execution via the public paiza.io runner API.
 *
 * Runs untrusted code in a sandbox across many languages with the free
 * "guest" key — no infra to host. The API is async: create a run, then poll
 * get_details until it completes. (The former Piston public API went
 * whitelist-only in 2026, so we use paiza here but keep the class name.)
 */
const PAIZA_URL = process.env.PAIZA_URL ?? 'https://api.paiza.io';
const PAIZA_KEY = process.env.PAIZA_KEY ?? 'guest';

// Editor language → paiza language id.
const LANG_MAP: Record<string, string> = {
  python: 'python3',
  javascript: 'javascript',
  typescript: 'typescript',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  go: 'go',
  sql: 'mysql',
};

export interface PistonRun {
  stdout: string;
  stderr: string;
  code: number | null;
  compileError: string | null;
}

@Injectable()
export class PistonClient {
  private readonly logger = new Logger(PistonClient.name);

  supports(language: string): boolean {
    return Boolean(LANG_MAP[language.toLowerCase()]);
  }

  async run(language: string, code: string, stdin: string): Promise<PistonRun> {
    const lang = LANG_MAP[language.toLowerCase()];
    if (!lang) throw new Error(`Unsupported language: ${language}`);

    const createBody = new URLSearchParams({
      source_code: code,
      language: lang,
      input: stdin ?? '',
      api_key: PAIZA_KEY,
    });
    const created = await fetch(`${PAIZA_URL}/runners/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: createBody,
    });
    if (!created.ok) throw new Error(`paiza create ${created.status}: ${(await created.text()).slice(0, 200)}`);
    const { id } = (await created.json()) as { id: string };

    // Poll until completed (bounded — total ~12s worst case).
    let details: any = null;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(`${PAIZA_URL}/runners/get_details?id=${encodeURIComponent(id)}&api_key=${PAIZA_KEY}`);
      details = await res.json();
      if (details.status === 'completed') break;
    }
    if (!details || details.status !== 'completed') throw new Error('Execution timed out');

    const compileError =
      details.build_result === 'failure' ? String(details.build_stderr ?? 'Compile error') : null;
    return {
      stdout: (details.stdout ?? '').toString(),
      stderr: (details.stderr ?? '').toString(),
      code: details.exit_code != null ? Number(details.exit_code) : null,
      compileError,
    };
  }
}
