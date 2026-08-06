'use client';

import { useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';

// ── shapes returned by GET /evaluation/sessions/:id/report and
// GET /evaluation/shared/:token — both wrap { evaluation, session }. ──
export interface ParameterScore { key: string; group: string; label: string; score: number; interpretation: string; weight: number }
export interface SkillCard { key: string; label: string; level: 'Weak' | 'Decent' | 'Good' | 'Strong'; instanceNote: string }
export interface RadarAxis { axis: string; score: number; benchmark: number }
export interface PerQuestionScore { score: number; max: number; notes: string; occurredAt?: string }
export interface ReportEvaluation {
  id: string;
  overallScore: number;
  competencies: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  summary: string;
  recommendation: string;
  createdAt: string;
  parameterScores: ParameterScore[];
  skillCards: SkillCard[];
  radar: RadarAxis[];
  perQuestion: PerQuestionScore[];
  shareToken?: string | null;
  shareTokenExpiresAt?: string | null;
}
export interface ReportSession {
  startedAt: string | null;
  completedAt: string | null;
  candidate: { fullName: string } | null;
  interview: { jobRole: string; title: string } | null;
}

const GROUP_LABELS: Record<string, string> = {
  communication: 'Communication', technical: 'Technical / Role Competency', behavioral: 'Behavioral',
  confidence: 'Confidence & Delivery', cognitive: 'Cognitive', risk: 'Risk Detection', hiring_readiness: 'Hiring Readiness',
};
const LEVEL_COLOR: Record<string, string> = {
  Strong: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', Good: 'bg-brand-500/15 text-brand-600 dark:text-brand-400',
  Decent: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', Weak: 'bg-red-500/15 text-red-600 dark:text-red-400',
};
const REC_LABEL: Record<string, string> = {
  STRONG_HIRE: 'Strong Hire', HIRE: 'Hire', LEAN_HIRE: 'Lean Hire', NO_HIRE: 'No Hire', STRONG_NO_HIRE: 'Strong No Hire',
};
const REC_COLOR: Record<string, string> = {
  STRONG_HIRE: 'bg-emerald-500 text-white', HIRE: 'bg-emerald-500/70 text-white', LEAN_HIRE: 'bg-amber-500 text-white',
  NO_HIRE: 'bg-red-500/80 text-white', STRONG_NO_HIRE: 'bg-red-600 text-white',
};

function scoreColor(v: number) { return v >= 75 ? '#10b981' : v >= 50 ? '#f59e0b' : '#ef4444'; }

function Gauge({ value }: { value: number }) {
  const angle = (Math.min(100, Math.max(0, value)) / 100) * 180;
  const r = 52, cx = 60, cy = 60; const rad = (d: number) => (d - 180) * (Math.PI / 180);
  const x = cx + r * Math.cos(rad(angle)); const y = cy + r * Math.sin(rad(angle));
  return (
    <svg viewBox="0 0 120 70" className="mx-auto w-40">
      <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="currentColor" strokeWidth="8" className="text-black/10 dark:text-white/10" strokeLinecap="round" />
      <path d={`M8 60 A52 52 0 0 1 ${x} ${y}`} fill="none" stroke={scoreColor(value)} strokeWidth="8" strokeLinecap="round" />
      <text x="60" y="52" textAnchor="middle" className="fill-current text-[20px] font-bold">{Math.round(value)}</text>
    </svg>
  );
}

/** Radar with a per-axis benchmark (P5) — each axis carries its own target bar, not one shared constant. */
function ReportRadar({ axes }: { axes: RadarAxis[] }) {
  const n = axes.length;
  if (!n) return null;
  const cx = 90, cy = 90, R = 60;
  const point = (i: number, value: number) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const rr = (Math.min(100, Math.max(0, value)) / 100) * R; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const; };
  const poly = (fn: (i: number) => readonly [number, number]) => axes.map((_, i) => fn(i).join(',')).join(' ');
  return (
    <svg viewBox="0 0 180 180" className="mx-auto mt-3 w-full max-w-[220px]">
      {[0.33, 0.66, 1].map((f) => <polygon key={f} points={poly((i) => point(i, f * 100))} fill="none" stroke="currentColor" className="text-black/10 dark:text-white/15" strokeWidth="0.8" />)}
      <polygon points={poly((i) => point(i, axes[i].benchmark))} fill="none" stroke="currentColor" className="text-black/30 dark:text-white/30" strokeWidth="1.2" strokeDasharray="3 2" />
      <polygon points={poly((i) => point(i, axes[i].score))} fill="rgb(249 115 22 / 0.2)" stroke="#f97316" strokeWidth="1.6" />
      {axes.map((ax, i) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const lx = cx + (R + 20) * Math.cos(a); const ly = cy + (R + 20) * Math.sin(a); return <text key={ax.axis} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[7px] text-black/50 dark:text-white/50">{ax.axis}</text>; })}
    </svg>
  );
}

function ParamBar({ p }: { p: ParameterScore }) {
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-black/70 dark:text-white/70">{p.label}</span>
        <span className="tabular-nums font-medium" style={{ color: scoreColor(p.score) }}>{p.score}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${p.score}%`, background: scoreColor(p.score) }} />
      </div>
      <p className="mt-0.5 text-[11px] text-black/50 dark:text-white/50">{p.interpretation}</p>
    </div>
  );
}

export interface ReportViewProps {
  evaluation: ReportEvaluation;
  session: ReportSession;
  /** recruiter: can manage the share link + jump per-question into a recording. candidate: read-only, own report. public: read-only, no session/PII beyond what's already in the payload. */
  mode: 'recruiter' | 'candidate' | 'public';
  sessionId?: string;
  /** recruiter only — when the recording exists, per-question rows get a "Jump to recording" control. */
  recordingUrl?: string | null;
}

export function ReportView({ evaluation: ev, session, mode, sessionId, recordingUrl }: ReportViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState('');
  const [share, setShare] = useState<{ token?: string | null; expiresAt?: string | null }>({ token: ev.shareToken, expiresAt: ev.shareTokenExpiresAt });
  const grouped = useMemo(() => {
    const byGroup: Record<string, ParameterScore[]> = {};
    for (const p of ev.parameterScores ?? []) (byGroup[p.group] ??= []).push(p);
    return byGroup;
  }, [ev.parameterScores]);
  const groupOrder = ['communication', 'technical', 'behavioral', 'confidence', 'cognitive', 'risk', 'hiring_readiness'];

  function jumpTo(occurredAt?: string) {
    const v = videoRef.current;
    if (!v || !occurredAt || !session.startedAt) return;
    const offsetSec = (new Date(occurredAt).getTime() - new Date(session.startedAt).getTime()) / 1000;
    if (offsetSec < 0 || !Number.isFinite(offsetSec)) return;
    v.currentTime = offsetSec;
    v.play().catch(() => {});
  }

  async function mintShareLink() {
    if (!sessionId) return;
    setShareBusy(true); setShareErr('');
    try {
      const res = await api.post<{ token: string; expiresAt: string }>(`/evaluation/sessions/${sessionId}/share`, {});
      setShare(res);
    } catch (e) { setShareErr(e instanceof ApiError ? e.message : 'Could not create share link.'); }
    finally { setShareBusy(false); }
  }
  async function revokeShareLink() {
    if (!sessionId) return;
    setShareBusy(true); setShareErr('');
    try { await api.delete(`/evaluation/sessions/${sessionId}/share`); setShare({ token: null, expiresAt: null }); }
    catch (e) { setShareErr(e instanceof ApiError ? e.message : 'Could not revoke share link.'); }
    finally { setShareBusy(false); }
  }

  const shareUrl = share.token && typeof window !== 'undefined' ? `${window.location.origin}/report/${share.token}` : null;

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Evaluation Report</h1>
          {session.candidate && <p className="text-sm text-black/50 dark:text-white/50">{session.candidate.fullName} · {session.interview?.jobRole ?? session.interview?.title ?? ''}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="btn-ghost text-sm">Export PDF</button>
        </div>
      </div>

      {mode === 'recruiter' && sessionId && (
        <div className="no-print card">
          <h3 className="font-semibold">Shareable link</h3>
          <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">Anyone with this link can view this report — no login required. Revoke any time.</p>
          {shareErr && <p className="mt-2 text-xs text-red-500">{shareErr}</p>}
          {shareUrl ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-black/5 px-2 py-1.5 text-xs dark:bg-white/10">{shareUrl}</code>
              <button onClick={() => navigator.clipboard?.writeText(shareUrl)} className="btn-ghost text-xs">Copy</button>
              <button onClick={revokeShareLink} disabled={shareBusy} className="btn-ghost text-xs text-red-500">Revoke</button>
            </div>
          ) : (
            <button onClick={mintShareLink} disabled={shareBusy} className="btn-primary mt-2 text-xs">{shareBusy ? 'Creating…' : 'Create share link'}</button>
          )}
          {share.expiresAt && <p className="mt-1 text-[11px] text-black/40">Expires {new Date(share.expiresAt).toLocaleDateString()}</p>}
        </div>
      )}

      {mode === 'recruiter' && recordingUrl && (
        <div className="card">
          <h3 className="font-semibold">Session recording</h3>
          <video ref={videoRef} src={recordingUrl} controls className="mt-2 max-h-[420px] w-full rounded-lg bg-black" />
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[220px_1fr]">
        <div className="card text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Overall score</div>
          <Gauge value={ev.overallScore} />
          <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${REC_COLOR[ev.recommendation] ?? 'bg-black/10'}`}>{REC_LABEL[ev.recommendation] ?? ev.recommendation}</span>
        </div>
        <div className="card">
          <h3 className="font-semibold">Summary</h3>
          <p className="mt-1 text-sm text-black/70 dark:text-white/70">{ev.summary}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Strengths</div>
              <ul className="mt-1 space-y-0.5 text-xs text-black/70 dark:text-white/70">{ev.strengths.map((s, i) => <li key={i}>· {s}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold text-red-500">Areas to probe</div>
              <ul className="mt-1 space-y-0.5 text-xs text-black/70 dark:text-white/70">{ev.weaknesses.map((s, i) => <li key={i}>· {s}</li>)}</ul>
            </div>
          </div>
        </div>
      </div>

      {ev.skillCards?.length > 0 && (
        <div className="print-break card">
          <h3 className="font-semibold">Skill cards</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ev.skillCards.map((c) => (
              <div key={c.key} className="rounded-lg border border-black/5 p-3 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{c.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEVEL_COLOR[c.level]}`}>{c.level}</span>
                </div>
                <p className="mt-1 text-[11px] text-black/50 dark:text-white/50">{c.instanceNote}</p>
              </div>
            ))}
          </div>
          {ev.radar?.length > 0 && <ReportRadar axes={ev.radar} />}
          {ev.radar?.length > 0 && <p className="text-center text-[10px] text-black/40">Dashed line = target bar for this role/level, not a population average.</p>}
        </div>
      )}

      {ev.parameterScores?.length > 0 && (
        <div className="print-break card">
          <h3 className="font-semibold">Parameter framework ({ev.parameterScores.length} parameters)</h3>
          <div className="mt-3 grid gap-5 md:grid-cols-2">
            {groupOrder.filter((g) => grouped[g]?.length).map((g) => (
              <div key={g}>
                <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">{GROUP_LABELS[g] ?? g}</div>
                <div className="divide-y divide-black/5 dark:divide-white/10">{grouped[g].map((p) => <ParamBar key={p.key} p={p} />)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {ev.perQuestion?.length > 0 && (
        <div className="print-break card">
          <h3 className="font-semibold">Per-question scorecard</h3>
          <ol className="mt-2 space-y-2">
            {ev.perQuestion.map((q, i) => (
              <li key={i} className="rounded-lg border border-black/5 p-3 text-sm dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Q{i + 1}</span>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-xs" style={{ color: scoreColor((q.score / q.max) * 100) }}>{q.score}/{q.max}</span>
                    {mode === 'recruiter' && recordingUrl && q.occurredAt && (
                      <button onClick={() => jumpTo(q.occurredAt)} className="no-print text-[11px] text-brand-500 underline decoration-dotted underline-offset-2 hover:opacity-70">Jump to recording</button>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-xs text-black/60 dark:text-white/60">{q.notes}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
