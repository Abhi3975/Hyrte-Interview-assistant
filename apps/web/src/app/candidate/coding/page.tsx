'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { CheckIcon, XIcon, AlertIcon } from '@/components/icons';

const LANGUAGES = ['javascript', 'typescript', 'python', 'java', 'cpp', 'go'];

const STARTER: Record<string, string> = {
  javascript: '// Read stdin, write stdout\nconst lines = require("fs").readFileSync(0,"utf8").split("\\n");\n\n',
  python: '# Read stdin, print stdout\nimport sys\ndata = sys.stdin.read().split()\n\n',
};

interface CaseResult {
  ordinal: number;
  passed: boolean;
  hidden: boolean;
  status: string;
  timeMs: number | null;
  expected?: string;
  actual?: string | null;
}
interface GradeResult {
  status: string;
  passed: number;
  total: number;
  results: CaseResult[];
  runtimeMs: number | null;
  similarity?: number | null;
}

function CodingInner() {
  const params = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const questionId = params.get('questionId') ?? '';

  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(STARTER.javascript);
  const [result, setResult] = useState<GradeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  async function execute(submit: boolean) {
    setError('');
    setRunning(true);
    setResult(null);
    try {
      const res = await api.post<GradeResult>('/coding/run', {
        sessionId,
        questionId,
        language,
        code,
        submit,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <DashboardShell area="candidate" title="Coding Assessment" requiredRoles={['CANDIDATE']}>
      {!sessionId || !questionId ? (
        <div className="card text-sm text-black/60 dark:text-white/60">
          Open this page from an active interview to load a question (missing sessionId/questionId).
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="card p-0">
            <div className="flex items-center justify-between border-b border-black/5 p-3 dark:border-white/10">
              <select
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setCode(STARTER[e.target.value] ?? '');
                }}
                className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15"
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => execute(false)} disabled={running} className="btn-ghost text-sm">
                  {running ? 'Running…' : 'Run samples'}
                </button>
                <button onClick={() => execute(true)} disabled={running} className="btn-primary text-sm">
                  Submit
                </button>
              </div>
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              className="h-[420px] w-full resize-none bg-transparent p-4 font-mono text-sm outline-none"
            />
          </div>

          <div className="card">
            <h3 className="font-semibold">Results</h3>
            {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
            {!result ? (
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">Run your code to see test results.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${result.passed === result.total ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {result.status}
                  </span>
                  <span className="text-sm tabular-nums">{result.passed}/{result.total} passed</span>
                </div>
                {typeof result.similarity === 'number' && result.similarity >= 0.85 && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600">
                    <AlertIcon width={14} height={14} className="shrink-0" />
                    High similarity to another submission ({Math.round(result.similarity * 100)}%) — flagged for review.
                  </div>
                )}
                <div className="space-y-1">
                  {result.results.map((r) => (
                    <div key={r.ordinal} className="flex items-center justify-between text-sm">
                      <span>{r.hidden ? `Hidden #${r.ordinal + 1}` : `Sample #${r.ordinal + 1}`}</span>
                      <span className={`inline-flex items-center gap-1 ${r.passed ? 'text-emerald-500' : 'text-red-500'}`}>
                        {r.passed ? <CheckIcon width={14} height={14} /> : <XIcon width={14} height={14} />} {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

export default function CodingPage() {
  return (
    <Suspense fallback={null}>
      <CodingInner />
    </Suspense>
  );
}
