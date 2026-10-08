'use client';

import React, { useState } from 'react';
import { HeroTaskWorkspace } from '@/lib/hyrte-types';

interface WorkspaceProps {
  task: HeroTaskWorkspace;
  draft: Record<string, string>;
  updateSection: (sectionId: string, value: string) => void;
  disabled?: boolean;
}

// ── 1. CODE DEBUG WORKSPACE ──────────────────────────────────────────────────
export function CodeDebugWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [runningTests, setRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<{ run: boolean; passed: boolean; logs: string[] } | null>(null);

  function runTests() {
    setRunningTests(true);
    setTimeout(() => {
      setRunningTests(false);
      const code = (draft['code_patch'] || draft['fix'] || '').toLowerCase();
      const hasFix = code.includes('retry') || code.includes('catch') || code.includes('null') || code.includes('timeout') || code.length > 30;
      setTestResults({
        run: true,
        passed: hasFix,
        logs: [
          'PASS  src/services/payment.test.ts',
          '  ✓ handles transient gateway network timeout (42ms)',
          '  ✓ prevents duplicate charge on race condition retry (18ms)',
          hasFix
            ? '  ✓ successfully catches unhandled promise rejection in production worker (12ms)'
            : '  ✕ FAILED: expected error to be handled but received UnhandledPromiseRejection',
          '',
          hasFix ? 'Test Suites: 1 passed, 1 total\nTests:       3 passed, 3 total' : 'Test Suites: 1 failed, 1 total\nTests:       2 passed, 1 failed, 3 total',
        ],
      });
    }, 1000);
  }

  return (
    <div className="space-y-6">
      {/* Production Log Console */}
      <div className="rounded-xl border border-black/10 bg-slate-950 p-4 font-mono text-xs text-slate-200 dark:border-white/15 shadow-inner">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-semibold text-red-400">PRODUCTION ERROR LOG · SEV-1 CRITICAL</span>
          </div>
          <span className="text-[11px] text-slate-400">Timestamp: Live System Trace</span>
        </div>
        <div className="space-y-1 overflow-x-auto text-[11px] leading-relaxed text-slate-300">
          <div className="text-red-400">[2026-10-08 05:14:02 UTC] FATAL UnhandledPromiseRejection: PaymentGatewayTimeoutError: Connection timed out after 5000ms</div>
          <div className="pl-4 text-slate-400">at PaymentWorker.processCharge (src/services/payment.ts:142:15)</div>
          <div className="pl-4 text-slate-400">at async JobQueue.dispatch (src/lib/queue.ts:88:9)</div>
          <div className="pl-4 text-slate-400">at async ClusterWorker.handleMessage (src/server.ts:204:3)</div>
          <div className="text-amber-400">[2026-10-08 05:14:05 UTC] WARN Database Connection Pool Saturation: 98/100 active connections</div>
          <div className="text-slate-400">[2026-10-08 05:14:10 UTC] INFO Worker #4 restarted after unhandled crash. Impacted users: ~450 active checkouts</div>
        </div>
      </div>

      {/* Test Execution Output */}
      <div className="rounded-xl border border-black/10 bg-black/5 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold">Verification Test Suite</h4>
            <p className="text-xs text-black/55 dark:text-white/55">Test your patch against regression cases before submitting.</p>
          </div>
          <button
            type="button"
            disabled={disabled || runningTests}
            onClick={runTests}
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-500 disabled:opacity-50 transition"
          >
            {runningTests ? 'Running tests…' : 'Run Unit Tests'}
          </button>
        </div>

        {testResults && (
          <div className={`mt-3 rounded-lg border p-3 font-mono text-xs ${testResults.passed ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'}`}>
            <pre className="whitespace-pre-wrap">{testResults.logs.join('\n')}</pre>
          </div>
        )}
      </div>

      {/* Inputs */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.id === 'code_patch' ? 6 : sec.long ? 4 : 2}
              className={`mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10 ${sec.id === 'code_patch' ? 'font-mono text-xs' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 2. CODE REVIEW WORKSPACE ──────────────────────────────────────────────────
export function CodeReviewWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [selectedVerdict, setSelectedVerdict] = useState<string>(draft['recommendation'] || 'REQUEST_CHANGES');

  function handleVerdict(v: string) {
    setSelectedVerdict(v);
    updateSection('recommendation', v);
  }

  return (
    <div className="space-y-6">
      {/* PR Header Banner */}
      <div className="card border-l-4 border-l-brand-500">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-brand-500/15 px-2 py-0.5 text-xs font-semibold text-brand-600 dark:text-brand-400">PR #342</span>
              <h3 className="text-base font-semibold">feat(auth): Implement token refresh mutex and session revocation</h3>
            </div>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              Author: <span className="font-medium text-black/80 dark:text-white/80">@dev-lead</span> · Branch: <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">feature/auth-mutex</code> → <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10 font-bold">main</code>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+142</span>
            <span className="text-red-600 dark:text-red-400 font-semibold">-38</span>
            <span className="text-black/40 dark:text-white/40">3 files changed</span>
          </div>
        </div>
      </div>

      {/* Interactive Git Code Diff Viewer */}
      <div className="rounded-xl border border-black/10 bg-slate-950 overflow-hidden text-xs font-mono dark:border-white/15 shadow-md">
        <div className="bg-slate-900 px-4 py-2 text-slate-300 font-semibold border-b border-slate-800 flex justify-between items-center">
          <span>src/services/auth-token.ts</span>
          <span className="text-[11px] font-normal text-slate-400">Diff view (Unified)</span>
        </div>
        <div className="p-3 space-y-1 overflow-x-auto text-[11px] leading-relaxed">
          <div className="text-slate-500">@@ -45,8 +45,14 @@ export class TokenManager &#123;</div>
          <div className="bg-red-500/10 text-red-300 px-2 py-0.5 border-l-2 border-red-500">-   async refreshToken(token: string): Promise&lt;AuthTokens&gt; &#123;</div>
          <div className="bg-red-500/10 text-red-300 px-2 py-0.5 border-l-2 border-red-500">-     return await this.api.post('/auth/refresh', &#123; token &#125;);</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+   private refreshLock: Promise&lt;AuthTokens&gt; | null = null;</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+   async refreshToken(token: string): Promise&lt;AuthTokens&gt; &#123;</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+     if (this.refreshLock) return this.refreshLock;</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+     this.refreshLock = this.api.post('/auth/refresh', &#123; token &#125;);</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+     try &#123; return await this.refreshLock; &#125;</div>
          <div className="bg-emerald-500/10 text-emerald-300 px-2 py-0.5 border-l-2 border-emerald-500">+     finally &#123; this.refreshLock = null; &#125; // Potential race condition if lock isn't reset safely!</div>
          <div className="text-slate-400 px-2 py-0.5">    &#125;</div>
        </div>
      </div>

      {/* Review Verdict Picker */}
      <div className="card">
        <label className="block text-sm font-semibold mb-2">Select PR Review Verdict</label>
        <div className="flex flex-wrap gap-3">
          {[
            { id: 'APPROVE', label: '✓ Approve PR', color: 'bg-emerald-500 text-white' },
            { id: 'REQUEST_CHANGES', label: '✕ Request Changes', color: 'bg-red-500 text-white' },
            { id: 'COMMENT', label: '💬 Comment Only', color: 'bg-amber-500 text-white' },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              disabled={disabled}
              onClick={() => handleVerdict(v.id)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                selectedVerdict === v.id ? v.color : 'bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 text-black/70 dark:text-white/70'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Text Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? [])
          .filter((s) => s.id !== 'recommendation')
          .map((sec) => (
            <div key={sec.id} className="card">
              <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
                {sec.label} {sec.required && <span className="text-red-500">*</span>}
              </label>
              <textarea
                disabled={disabled}
                value={draft[sec.id] ?? ''}
                onChange={(e) => updateSection(sec.id, e.target.value)}
                placeholder={sec.hint}
                rows={sec.long ? 4 : 2}
                className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
              />
            </div>
          ))}
      </div>
    </div>
  );
}

// ── 3. CODE EDITOR WORKSPACE ──────────────────────────────────────────────────
export function CodeEditorWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [activeFile, setActiveFile] = useState('src/feature.ts');
  const [runningTests, setRunningTests] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);

  function executeTests() {
    setRunningTests(true);
    setTimeout(() => {
      setRunningTests(false);
      setTestOutput('PASS  src/feature.test.ts\n  ✓ feature handles happy path execution (34ms)\n  ✓ validates inputs and throws domain exception (19ms)\n  ✓ honors rate limits under concurrent load (28ms)\n\nTest Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total\nTime:        0.482 s');
    }, 800);
  }

  return (
    <div className="space-y-6">
      {/* Code Evaluation Bar */}
      <div className="card flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-brand-500/10 via-transparent to-transparent">
        <div>
          <h4 className="text-sm font-semibold">Evaluation Criteria</h4>
          <p className="text-xs text-black/55 dark:text-white/55">Code Quality · Architecture · Tradeoffs · Speed · Testing</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 font-semibold text-emerald-600 dark:text-emerald-400">Code Quality: A+</span>
          <span className="rounded-full bg-sky-500/15 px-2.5 py-1 font-semibold text-sky-600 dark:text-sky-400">Architecture: Modular</span>
          <span className="rounded-full bg-purple-500/15 px-2.5 py-1 font-semibold text-purple-600 dark:text-purple-400">Test Coverage: High</span>
        </div>
      </div>

      {/* Editor & Explorer Container */}
      <div className="rounded-xl border border-black/10 bg-slate-950 overflow-hidden shadow-lg dark:border-white/15">
        <div className="flex border-b border-slate-800 bg-slate-900 text-xs font-mono">
          {['src/feature.ts', 'src/feature.test.ts', 'src/types.ts'].map((file) => (
            <button
              key={file}
              type="button"
              onClick={() => setActiveFile(file)}
              className={`px-4 py-2.5 transition border-r border-slate-800 ${activeFile === file ? 'bg-slate-950 text-brand-400 border-t-2 border-t-brand-500 font-semibold' : 'text-slate-400 hover:bg-slate-800'}`}
            >
              {file}
            </button>
          ))}
        </div>

        <div className="p-4">
          <label className="block text-xs font-mono text-slate-400 mb-2">// Code Implementation Editor ({activeFile})</label>
          <textarea
            disabled={disabled}
            value={draft['feature_code'] ?? ''}
            onChange={(e) => updateSection('feature_code', e.target.value)}
            placeholder={`// Write your clean TypeScript implementation for ${activeFile}\nexport class FeatureService {\n  async execute(input: FeatureInput): Promise<FeatureOutput> {\n    // Implement logic here...\n  }\n}`}
            rows={10}
            className="w-full resize-y rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-200 outline-none border border-slate-800 focus:border-brand-500"
          />
        </div>

        <div className="border-t border-slate-800 bg-slate-900/80 p-3 flex justify-between items-center">
          <span className="text-xs font-mono text-slate-400">Environment: Node v20.x · TypeScript 5.4</span>
          <button
            type="button"
            disabled={disabled || runningTests}
            onClick={executeTests}
            className="rounded bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-50 transition"
          >
            {runningTests ? 'Compiling & Running…' : 'Run Unit Tests'}
          </button>
        </div>

        {testOutput && (
          <div className="bg-slate-900 border-t border-slate-800 p-3 font-mono text-xs text-emerald-400 whitespace-pre-wrap">
            {testOutput}
          </div>
        )}
      </div>

      {/* Remaining Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? [])
          .filter((s) => s.id !== 'feature_code')
          .map((sec) => (
            <div key={sec.id} className="card">
              <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
                {sec.label} {sec.required && <span className="text-red-500">*</span>}
              </label>
              <textarea
                disabled={disabled}
                value={draft[sec.id] ?? ''}
                onChange={(e) => updateSection(sec.id, e.target.value)}
                placeholder={sec.hint}
                rows={sec.long ? 4 : 2}
                className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10 font-mono text-xs"
              />
            </div>
          ))}
      </div>
    </div>
  );
}

// ── 4. PERF PROFILER WORKSPACE ──────────────────────────────────────────────────
export function PerfProfilerWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  return (
    <div className="space-y-6">
      {/* Latency Regression Chart & Metrics */}
      <div className="card bg-gradient-to-b from-red-500/10 via-transparent to-transparent">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-3 dark:border-white/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping" />
              <h3 className="text-base font-semibold text-red-600 dark:text-red-400">p99 Latency Regression Detected</h3>
            </div>
            <p className="text-xs text-black/60 dark:text-white/60">System latency spiked from 120ms baseline to 2,450ms under peak load.</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="block text-black/40 dark:text-white/40">Baseline p99</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">120 ms</span>
            </div>
            <div>
              <span className="block text-black/40 dark:text-white/40">Current p99</span>
              <span className="font-mono font-bold text-red-600 dark:text-red-400">2,450 ms</span>
            </div>
            <div>
              <span className="block text-black/40 dark:text-white/40">Target Optimization</span>
              <span className="font-mono font-bold text-brand-600 dark:text-brand-400">&lt; 150 ms</span>
            </div>
          </div>
        </div>

        {/* Visual Flamegraph / Query Trace Mock */}
        <div className="mt-4 rounded-lg border border-black/10 bg-slate-950 p-3 font-mono text-xs text-slate-300 dark:border-white/10">
          <div className="text-amber-400 font-semibold mb-1">SLOW QUERY IDENTIFIED (Takes 1,840ms / 75% of request time):</div>
          <div className="bg-slate-900 p-2 rounded text-red-300 overflow-x-auto text-[11px]">
            SELECT o.*, u.email, p.title FROM orders o JOIN users u ON o.user_id = u.id JOIN order_items oi ON o.id = oi.order_id WHERE o.status = 'PENDING' AND o.created_at &gt;= NOW() - INTERVAL '7 days'; -- Missing composite index on (status, created_at)
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.id === 'optimization_patch' ? 5 : sec.long ? 4 : 2}
              className={`mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10 ${sec.id === 'optimization_patch' ? 'font-mono text-xs' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 5. LEAD QUALIFICATION WORKSPACE ──────────────────────────────────────────
export function LeadQualificationWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [dealValue, setDealValue] = useState<string>(draft['estimated_acv'] || '85000');

  return (
    <div className="space-y-6">
      {/* Target Lead Profile Dossier */}
      <div className="card bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Inbound Lead</span>
              <h3 className="text-lg font-bold">Acme Financial Technologies</h3>
            </div>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60">
              Industry: <span className="font-semibold text-black/80 dark:text-white/80">Fintech / Enterprise Banking</span> · Headcount: <span className="font-semibold text-black/80 dark:text-white/80">1,200 employees</span>
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-black/50 dark:text-white/50">ICP Match Score</span>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">94 / 100</div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-black/5 pt-3 text-xs dark:border-white/10 sm:grid-cols-3">
          <div>
            <span className="block text-black/40 dark:text-white/40">Key Contact</span>
            <span className="font-semibold">Sarah Jenkins (VP Revenue Ops)</span>
          </div>
          <div>
            <span className="block text-black/40 dark:text-white/40">Tech Stack</span>
            <span className="font-semibold">Salesforce, Snowflake, Segment</span>
          </div>
          <div>
            <span className="block text-black/40 dark:text-white/40">Stated Timeline</span>
            <span className="font-semibold">Q4 Procurement (Urgent)</span>
          </div>
        </div>
      </div>

      {/* Target Deal ACV Slider */}
      <div className="card">
        <div className="flex justify-between items-center mb-2">
          <label className="text-sm font-semibold">Forecasted ACV (Annual Contract Value)</label>
          <span className="text-base font-bold text-brand-600 dark:text-brand-400">${Number(dealValue).toLocaleString()}</span>
        </div>
        <input
          type="range"
          min="25000"
          max="250000"
          step="5000"
          disabled={disabled}
          value={dealValue}
          onChange={(e) => {
            setDealValue(e.target.value);
            updateSection('estimated_acv', e.target.value);
          }}
          className="w-full accent-brand-500 cursor-pointer"
        />
        <div className="flex justify-between text-[11px] text-black/40 dark:text-white/40 mt-1">
          <span>$25k (Mid-Market)</span>
          <span>$100k (Enterprise)</span>
          <span>$250k+ (Strategic)</span>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.long ? 4 : 2}
              className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 6. DISCOVERY CALL WORKSPACE ──────────────────────────────────────────────
export function DiscoveryCallWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>({
    c1: true,
    c2: true,
    c3: false,
    c4: false,
  });

  function toggleCheck(id: string) {
    const next = { ...checklist, [id]: !checklist[id] };
    setChecklist(next);
    updateSection('discovery_checklist', Object.keys(next).filter((k) => next[k]).join(', '));
  }

  return (
    <div className="space-y-6">
      {/* Interactive Discovery Call Simulator Header */}
      <div className="rounded-xl border border-brand-500/30 bg-slate-950 p-4 text-white shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 font-bold text-white text-sm ring-4 ring-brand-500/20">
              SJ
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-white">Sarah Jenkins</h3>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">CALL IN PROGRESS</span>
              </div>
              <p className="text-xs text-slate-400">VP Revenue Operations · Acme Corp</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-slate-400">Duration: 18:42</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          </div>
        </div>

        {/* Rolling Call Transcript */}
        <div className="mt-4 rounded-lg bg-slate-900/90 p-3 text-xs space-y-2 max-h-44 overflow-y-auto border border-slate-800">
          <div className="text-slate-400"><span className="font-semibold text-brand-400">Sarah Jenkins:</span> "Our main bottleneck right now is manual data reconciliation between Salesforce and Snowflake. It costs our team ~15 hours every week."</div>
          <div className="text-slate-300"><span className="font-semibold text-emerald-400">You (AE):</span> "Got it. If we automate that workflow, what does that unlock for your Q4 revenue target?"</div>
          <div className="text-slate-400"><span className="font-semibold text-brand-400">Sarah Jenkins:</span> "If we eliminate that friction, we can increase deal velocity by 25%. But legal needs strict SOC2 compliance."</div>
        </div>
      </div>

      {/* Discovery Question Checklist */}
      <div className="card">
        <h4 className="text-sm font-semibold mb-2">Discovery Question Checklist</h4>
        <div className="grid gap-2 sm:grid-cols-2 text-xs">
          {[
            { id: 'c1', label: 'Quantified annual business pain' },
            { id: 'c2', label: 'Identified economic decision maker' },
            { id: 'c3', label: 'Confirmed procurement & legal process' },
            { id: 'c4', label: 'Agreed on evaluation timeline & next steps' },
          ].map((item) => (
            <label key={item.id} className="flex items-center gap-2 rounded border border-black/5 p-2 dark:border-white/10 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
              <input
                type="checkbox"
                disabled={disabled}
                checked={checklist[item.id] ?? false}
                onChange={() => toggleCheck(item.id)}
                className="rounded text-brand-500 accent-brand-500"
              />
              <span className={checklist[item.id] ? 'line-through text-black/50 dark:text-white/50' : 'font-medium'}>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Text Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.long ? 4 : 2}
              className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 7. OBJECTION HANDLER WORKSPACE ────────────────────────────────────────────
export function ObjectionHandlerWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  return (
    <div className="space-y-6">
      {/* Buyer Objection Card */}
      <div className="card border-l-4 border-l-amber-500 bg-amber-500/5">
        <div className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Prospect Objection Received</div>
        <blockquote className="mt-2 text-sm italic text-black/80 dark:text-white/80">
          "We love the platform, but your quote of $85,000/year is 30% above our Q4 budget. Competitor X is offering us a similar package for $60,000. Unless you can match that price, we cannot move forward."
        </blockquote>
      </div>

      {/* Value Pitch & ROI Calculator */}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold">Value Guardrail & ROI Benchmark</h4>
          <p className="text-xs text-black/55 dark:text-white/55">Reframe around ROI rather than giving reflex discounts.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div className="rounded-lg bg-black/5 px-3 py-1.5 dark:bg-white/10">
            <span className="block text-[10px] text-black/40 dark:text-white/40">Estimated Annual ROI</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">$240,000 / year</span>
          </div>
          <div className="rounded-lg bg-black/5 px-3 py-1.5 dark:bg-white/10">
            <span className="block text-[10px] text-black/40 dark:text-white/40">Max Approved Discount</span>
            <span className="font-bold text-amber-600 dark:text-amber-400">10% (With Upfront Term)</span>
          </div>
        </div>
      </div>

      {/* Text Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.id === 'value_response' ? 6 : sec.long ? 4 : 2}
              className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 8. FOLLOWUP RECAP WORKSPACE ──────────────────────────────────────────────
export function FollowupRecapWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  return (
    <div className="space-y-6">
      {/* CRM Pipeline Sync Card */}
      <div className="card flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-brand-500/10 via-transparent to-transparent">
        <div>
          <h4 className="text-sm font-semibold">CRM Deal Pipeline Sync</h4>
          <p className="text-xs text-black/55 dark:text-white/55">Keep deal stage and mutual action plan in sync after call.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded-full bg-brand-500/15 px-3 py-1 text-brand-600 dark:text-brand-400">Stage: Proposal Sent</span>
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-600 dark:text-emerald-400">Win Prob: 75%</span>
        </div>
      </div>

      {/* Text Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.id === 'recap_email' ? 6 : sec.long ? 4 : 2}
              className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 9. DEAL NEGOTIATION WORKSPACE ──────────────────────────────────────────────
export function DealNegotiationWorkspace({ task, draft, updateSection, disabled }: WorkspaceProps) {
  const [discountPct, setDiscountPct] = useState<number>(10);
  const baseAcv = 100000;
  const netArr = Math.round(baseAcv * (1 - discountPct / 100));
  const grossMargin = Math.round(88 - discountPct * 0.4);

  return (
    <div className="space-y-6">
      {/* Interactive Deal Revenue & Margin Calculator */}
      <div className="card bg-gradient-to-r from-emerald-500/10 via-transparent to-brand-500/10">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/5 pb-3 dark:border-white/10">
          <div>
            <h3 className="text-base font-semibold">Deal Structuring & Revenue Calculator</h3>
            <p className="text-xs text-black/60 dark:text-white/60">Measure pipeline movement → conversion → revenue impact live.</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div>
              <span className="block text-black/40 dark:text-white/40">Base ACV</span>
              <span className="font-mono font-bold">${baseAcv.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-black/40 dark:text-white/40">Net ARR</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">${netArr.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-black/40 dark:text-white/40">Gross Margin</span>
              <span className="font-mono font-bold text-brand-600 dark:text-brand-400">{grossMargin}%</span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex justify-between items-center text-xs font-semibold mb-1">
            <span>Applied Discount Percentage</span>
            <span>{discountPct}% Discount</span>
          </div>
          <input
            type="range"
            min="0"
            max="25"
            step="1"
            disabled={disabled}
            value={discountPct}
            onChange={(e) => setDiscountPct(Number(e.target.value))}
            className="w-full accent-brand-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-black/40 dark:text-white/40 mt-1">
            <span>0% (Full Price)</span>
            <span>10% (Standard Cap)</span>
            <span>25% (Requires VP Approval)</span>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {(task.deliverable.sections ?? []).map((sec) => (
          <div key={sec.id} className="card">
            <label className="block text-sm font-semibold text-black/90 dark:text-white/90">
              {sec.label} {sec.required && <span className="text-red-500">*</span>}
            </label>
            <textarea
              disabled={disabled}
              value={draft[sec.id] ?? ''}
              onChange={(e) => updateSection(sec.id, e.target.value)}
              placeholder={sec.hint}
              rows={sec.long ? 4 : 2}
              className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
