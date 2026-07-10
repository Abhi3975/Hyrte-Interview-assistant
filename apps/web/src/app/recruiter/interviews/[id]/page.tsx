'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Detail {
  interview: { id: string; title: string; jobRole: string; category: string; difficulty: string; durationMins: number; status: string };
  questions: { id: string; ordinal: number; question: { id: string; title: string; prompt: string; type: string; difficulty: string } }[];
  sessions: { id: string; status: string; examState: string; completedAt?: string; riskScore?: number; candidate: { fullName: string; email: string }; evaluation?: { overallScore: number; recommendation: string } }[];
  invites: { code: string; name: string; email?: string; expiresAt: string }[];
}

export default function AssessmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['assessment', id], queryFn: () => api.get<Detail>(`/interviews/${id}`) });

  const [count, setCount] = useState(5);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [lastLink, setLastLink] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = useMutation({
    mutationFn: () => api.post(`/interviews/${id}/generate-questions`, { count }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', id] }),
  });
  const publish = useMutation({
    mutationFn: () => api.post(`/interviews/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assessment', id] }),
  });
  const invite = useMutation({
    mutationFn: () => api.post<{ path: string }>(`/interviews/${id}/invite-link`, { name: inviteName, email: inviteEmail || undefined }),
    onSuccess: (res) => {
      setLastLink(`${window.location.origin}${res.path}`);
      setInviteName(''); setInviteEmail('');
      qc.invalidateQueries({ queryKey: ['assessment', id] });
    },
  });

  const iv = data?.interview;

  return (
    <DashboardShell area="recruiter" title={iv?.title ?? 'Assessment'} requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      {isLoading || !iv ? (
        <p className="text-sm text-black/50">Loading…</p>
      ) : (
        <div className="space-y-5">
          <div className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{iv.title}</div>
              <div className="text-sm text-black/60 dark:text-white/60">{iv.jobRole} · {iv.category} · {iv.difficulty} · {iv.durationMins} min</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${iv.status === 'SCHEDULED' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-black/5 dark:bg-white/10'}`}>{iv.status === 'SCHEDULED' ? 'LIVE' : iv.status}</span>
              {iv.status !== 'SCHEDULED' && (
                <button onClick={() => publish.mutate()} disabled={publish.isPending} className="btn-primary text-sm">{publish.isPending ? 'Publishing…' : 'Publish (go live)'}</button>
              )}
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Questions */}
            <div className="card">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Questions ({data.questions.length})</h3>
                <div className="flex items-center gap-2">
                  <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="rounded-lg border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/15">
                    {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button onClick={() => generate.mutate()} disabled={generate.isPending} className="btn-primary text-sm">{generate.isPending ? 'Generating…' : '✨ Generate with AI'}</button>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {data.questions.length === 0 ? (
                  <p className="text-sm text-black/60 dark:text-white/60">No questions yet — generate some with AI.</p>
                ) : data.questions.map((q, i) => (
                  <div key={q.id} className="rounded-lg border border-black/5 p-2 text-sm dark:border-white/10">
                    <div className="flex justify-between"><span className="font-medium">Q{i + 1}. {q.question.title}</span><span className="text-xs text-black/40">{q.question.difficulty}</span></div>
                    <p className="mt-0.5 text-xs text-black/60 dark:text-white/60">{q.question.prompt}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Invite */}
            <div className="card">
              <h3 className="font-semibold">Invite a candidate</h3>
              <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">Generates a secure link — the candidate opens it and takes the interview, no recruiter interaction needed.</p>
              <div className="mt-3 space-y-2">
                <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Candidate name" className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email (optional)" className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/15" />
                <button onClick={() => invite.mutate()} disabled={invite.isPending || !inviteName.trim()} className="btn-primary w-full text-sm disabled:opacity-50">{invite.isPending ? 'Creating…' : 'Create interview link'}</button>
              </div>
              {lastLink && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 p-2 text-xs">
                  <code className="flex-1 truncate text-emerald-700">{lastLink}</code>
                  <button onClick={() => { navigator.clipboard.writeText(lastLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="rounded bg-emerald-600 px-2 py-1 font-medium text-white">{copied ? 'Copied' : 'Copy'}</button>
                </div>
              )}
              {data.invites.length > 0 && (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-black/50 dark:text-white/50">Sent invites</div>
                  <div className="mt-1 space-y-1 text-xs">
                    {data.invites.map((inv) => (
                      <div key={inv.code} className="flex items-center justify-between">
                        <span>{inv.name}{inv.email ? ` · ${inv.email}` : ''}</span>
                        <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/interview/${inv.code}`); }} className="text-brand-500 underline">copy link</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Candidates / results */}
          <div className="card">
            <h3 className="font-semibold">Candidates ({data.sessions.length})</h3>
            {data.sessions.length === 0 ? (
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">No candidates have taken this assessment yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-black/50 dark:text-white/50">
                    <th className="py-1 pr-3 font-medium">Candidate</th><th className="py-1 pr-3 font-medium">Status</th><th className="py-1 pr-3 font-medium">Score</th><th className="py-1 pr-3 font-medium">Recommendation</th><th className="py-1 font-medium">Integrity</th>
                  </tr></thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id} className="border-t border-black/5 dark:border-white/10">
                        <td className="py-2 pr-3"><div className="font-medium">{s.candidate.fullName}</div><div className="text-xs text-black/40">{s.candidate.email}</div></td>
                        <td className="py-2 pr-3">{s.examState === 'COMPLETED' ? 'Completed' : 'In progress'}</td>
                        <td className="py-2 pr-3 tabular-nums">{s.evaluation ? `${s.evaluation.overallScore}/100` : '—'}</td>
                        <td className="py-2 pr-3">{s.evaluation ? <span className={s.evaluation.recommendation.includes('NO') ? 'text-red-600' : s.evaluation.recommendation.includes('HIRE') ? 'text-emerald-600' : 'text-amber-600'}>{s.evaluation.recommendation.replace('_', ' ')}</span> : '—'}</td>
                        <td className="py-2 tabular-nums">{typeof s.riskScore === 'number' ? `${Math.max(0, 100 - Math.round(s.riskScore))}/100` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
