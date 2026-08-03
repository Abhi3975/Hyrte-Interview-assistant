'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { CheckIcon, AlertIcon, XIcon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';
import {
  HyrteInterviewReport,
  HyrteCouncilAgentReport,
  HyrteCouncilDiscussionEntry,
  HyrteCouncilQA,
} from '@/lib/hyrte-types';

const RECOMMENDATION_META: Record<string, { icon: typeof CheckIcon; wrap: string; text: string }> = {
  'Strong Fit': { icon: CheckIcon, wrap: 'border-emerald-500/30 bg-emerald-500/5', text: 'text-emerald-600' },
  Fit: { icon: CheckIcon, wrap: 'border-brand-500/30 bg-brand-500/5', text: 'text-brand-600' },
  'Weak Fit': { icon: AlertIcon, wrap: 'border-amber-500/30 bg-amber-500/5', text: 'text-amber-600' },
  'Not a Fit': { icon: XIcon, wrap: 'border-red-500/30 bg-red-500/5', text: 'text-red-600' },
};
const DEFAULT_META = RECOMMENDATION_META.Fit;

const STANCE_META: Record<string, string> = {
  HIRE: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  LEAN_HIRE: 'bg-brand-500/15 text-brand-700 dark:text-brand-400',
  LEAN_NO_HIRE: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  NO_HIRE: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export default function HyrteCouncilPage() {
  const [sessionId, setSessionId] = useState('');
  const [activeId, setActiveId] = useState('');
  const [question, setQuestion] = useState('');
  const qc = useQueryClient();

  const reportQuery = useQuery({
    queryKey: ['hyrte-council', 'report', activeId],
    queryFn: () => api.get<HyrteInterviewReport>(`/hyrte/sessions/${activeId}/interview/report`),
    enabled: Boolean(activeId),
    retry: false,
  });
  const agentsQuery = useQuery({
    queryKey: ['hyrte-council', 'agents', activeId],
    queryFn: () => api.get<HyrteCouncilAgentReport[]>(`/hyrte/sessions/${activeId}/council/agent-reports`),
    enabled: Boolean(activeId),
    retry: false,
  });
  const discussionQuery = useQuery({
    queryKey: ['hyrte-council', 'discussion', activeId],
    queryFn: () => api.get<HyrteCouncilDiscussionEntry[]>(`/hyrte/sessions/${activeId}/council/discussion`),
    enabled: Boolean(activeId),
    retry: false,
  });
  const qaHistoryQuery = useQuery({
    queryKey: ['hyrte-council', 'qa', activeId],
    queryFn: () => api.get<HyrteCouncilQA[]>(`/hyrte/sessions/${activeId}/council/qa`),
    enabled: Boolean(activeId),
    retry: false,
  });

  const agentByKey = new Map((agentsQuery.data ?? []).map((a) => [a.agentKey, a]));
  const notConvened = agentsQuery.error instanceof ApiError && agentsQuery.error.status === 404;
  const meta = reportQuery.data ? (RECOMMENDATION_META[reportQuery.data.recommendation] ?? DEFAULT_META) : DEFAULT_META;
  const RecIcon = meta.icon;

  async function askCortex() {
    if (!question.trim() || !activeId) return;
    const q = question;
    setQuestion('');
    await api.post(`/hyrte/sessions/${activeId}/council/qa`, { question: q });
    qc.invalidateQueries({ queryKey: ['hyrte-council', 'qa', activeId] });
  }

  return (
    <DashboardShell area="recruiter" title="HYRTE Decision Council" requiredRoles={['RECRUITER', 'ORG_ADMIN', 'SUPER_ADMIN']}>
      <div className="mb-6 card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1 block text-xs font-medium text-black/60 dark:text-white/60">HYRTE session ID</label>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value.trim())}
            placeholder="Paste a session id…"
            className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
          />
        </div>
        <button
          onClick={() => setActiveId(sessionId)}
          disabled={!sessionId}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Load
        </button>
      </div>
      <p className="mb-6 text-xs text-black/50 dark:text-white/50">
        There is no recruiter/candidate assignment model for HYRTE sessions yet, so there is no list to browse —
        paste a session id directly (e.g. one a candidate shared, or from your own test session).
      </p>

      {!activeId && <div className="card text-sm text-black/60 dark:text-white/60">Load a session to see its Decision Council output.</div>}

      {activeId && notConvened && (
        <div className="card text-sm text-black/60 dark:text-white/60">
          The Decision Council hasn&apos;t convened for this session yet — it runs automatically once the candidate
          finishes their reflection interview.
        </div>
      )}

      {activeId && !notConvened && (
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Combined report (§6.3.4) */}
          {reportQuery.data && (
            <div className={`card flex items-start gap-4 border ${meta.wrap}`}>
              <RecIcon className={`h-6 w-6 shrink-0 ${meta.text}`} />
              <div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold ${meta.text}`}>{reportQuery.data.recommendation}</span>
                  {reportQuery.data.confidencePercent !== null && (
                    <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                      {reportQuery.data.confidencePercent}% confidence
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-black/70 dark:text-white/70">{reportQuery.data.summary}</p>
                {reportQuery.data.nextStepRecommendation && (
                  <p className="mt-2 text-xs font-medium text-black/50 dark:text-white/50">
                    Recommended next step: {reportQuery.data.nextStepRecommendation}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Individual agent reports (§6.3.1) */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">
              Committee — 9 individual reports
            </h3>
            <div className="space-y-3">
              {(agentsQuery.data ?? []).map((a) => (
                <div key={a.agentKey} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{a.agentName}</span>
                    {a.stance && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STANCE_META[a.stance] ?? ''}`}>
                        {a.stance.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-black/70 dark:text-white/70">{a.reasoning}</p>
                  {a.citedEvidenceIds.length > 0 && (
                    <p className="mt-1.5 text-xs text-black/40 dark:text-white/40">
                      Cited evidence: {a.citedEvidenceIds.map((id) => id.slice(-6)).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Discussion transcript (§6.3.2) */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Committee discussion</h3>
            <div className="space-y-2">
              {(discussionQuery.data ?? []).map((d, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium">{agentByKey.get(d.agentKey)?.agentName ?? d.agentKey}: </span>
                  <span className="text-black/70 dark:text-white/70">{d.statement}</span>
                  {d.respondingToAgentKey && (
                    <span className="ml-1.5 text-xs text-black/40 dark:text-white/40">
                      (re: {agentByKey.get(d.respondingToAgentKey)?.agentName ?? d.respondingToAgentKey})
                    </span>
                  )}
                </div>
              ))}
              {(discussionQuery.data ?? []).length === 0 && (
                <p className="text-sm text-black/50 dark:text-white/50">No discussion recorded.</p>
              )}
            </div>
          </div>

          {/* Decision Cortex Q&A (§6.3.3) */}
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-black/50 dark:text-white/50">Ask Decision Cortex</h3>
            <div className="mb-3 space-y-3">
              {(qaHistoryQuery.data ?? []).map((qa) => (
                <div key={qa.id} className="text-sm">
                  <p className="font-medium">Q: {qa.question}</p>
                  <p className="mt-0.5 text-black/70 dark:text-white/70">A: {qa.answer}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && askCortex()}
                placeholder="e.g. why does this look like a strong hire?"
                className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
              />
              <button
                onClick={askCortex}
                disabled={!question.trim()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Ask
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
