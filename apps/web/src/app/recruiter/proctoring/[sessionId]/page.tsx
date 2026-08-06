'use client';

import { use, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Timeline {
  events: { id: string; type: string; severity: string; payload: Record<string, unknown>; occurredAt: string; provider: string }[];
  warnings: { id: string; reason?: string; createdAt: string }[];
  risk: { score?: number; probability?: number } | null;
  // P4
  session: { startedAt: string | null; completedAt: string | null; hasRecording: boolean };
  recordingUrl: string | null;
  signalSummary: { type: string; count: number; percent: number }[];
}

const SEV_COLOR: Record<string, string> = {
  CRITICAL: 'text-red-600', HIGH: 'text-red-500', MEDIUM: 'text-amber-500', LOW: 'text-black/60 dark:text-white/60', INFO: 'text-black/40 dark:text-white/40',
};

export default function ProctoringTimeline({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['timeline', sessionId],
    queryFn: () => api.get<Timeline>(`/proctoring/sessions/${sessionId}/timeline`),
  });

  // P4 — click a flag, jump to that moment: offset from the session's own
  // startedAt (recording begins right when the room goes live), not from
  // the video's own file timestamps (there aren't any).
  function jumpTo(occurredAt: string) {
    const v = videoRef.current;
    const startedAt = data?.session.startedAt;
    if (!v || !startedAt) return;
    const offsetSec = (new Date(occurredAt).getTime() - new Date(startedAt).getTime()) / 1000;
    if (offsetSec < 0 || !Number.isFinite(offsetSec)) return;
    v.currentTime = offsetSec;
    v.play().catch(() => {});
  }

  return (
    <DashboardShell area="recruiter" title="Proctoring Timeline" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <Link href="/recruiter/proctoring" className="text-sm text-brand-500">← Back to live proctoring</Link>

      {isLoading ? (
        <p className="mt-4 text-sm text-black/50">Loading timeline…</p>
      ) : error ? (
        <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">Could not load this session&apos;s timeline.</p>
      ) : (
        <div className="mt-4 space-y-5">
          {/* P4 — recording + click-a-flag-to-jump. */}
          <div className="card">
            <h3 className="font-semibold">Session recording</h3>
            {data?.recordingUrl ? (
              <video ref={videoRef} src={data.recordingUrl} controls className="mt-2 max-h-[480px] w-full rounded-lg bg-black" />
            ) : (
              <p className="mt-2 text-sm text-black/60 dark:text-white/60">
                {data?.session.hasRecording ? 'Recording exists but could not be loaded.' : 'No recording available for this session — either recording storage wasn’t configured when it ran, or the candidate’s browser didn’t support it.'}
              </p>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-[1fr_260px]">
            <div className="card">
              <h3 className="font-semibold">Evidence timeline ({data?.events.length ?? 0})</h3>
              <p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                Chronological signals captured during the interview. Evidence, not accusations.
                {data?.recordingUrl && ' Click any signal to jump the recording to that moment.'}
              </p>
              {!data?.events.length ? (
                <p className="mt-3 text-sm text-black/60 dark:text-white/60">No proctoring events recorded — clean session.</p>
              ) : (
                <ol className="mt-3 space-y-2 border-l border-black/10 pl-4 dark:border-white/10">
                  {data.events.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => jumpTo(e.occurredAt)}
                          disabled={!data.recordingUrl}
                          className={`text-sm font-medium ${SEV_COLOR[e.severity] ?? ''} ${data.recordingUrl ? 'underline decoration-dotted underline-offset-2 hover:opacity-70' : ''}`}
                        >
                          {e.type.replace(/_/g, ' ')}
                        </button>
                        <span className="text-xs text-black/40">{new Date(e.occurredAt).toLocaleTimeString()}</span>
                      </div>
                      {e.payload && Object.keys(e.payload).length > 0 && (
                        <div className="text-xs text-black/50 dark:text-white/50">{Object.entries(e.payload).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</div>
                      )}
                      <div className="text-[10px] uppercase tracking-wide text-black/30 dark:text-white/30">{e.severity} · {e.provider}</div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="space-y-4">
              <div className="card text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Risk score</div>
                <div className="mt-1 text-3xl font-bold">{data?.risk?.score != null ? Math.round(data.risk.score) : 0}<span className="text-sm font-normal text-black/40">/100</span></div>
                {data?.risk?.probability != null && <div className="text-xs text-black/50">{Math.round(data.risk.probability * 100)}% cheating probability</div>}
              </div>
              <div className="card">
                <div className="text-sm font-semibold">Warnings ({data?.warnings.length ?? 0})</div>
                {!data?.warnings.length ? (
                  <p className="mt-1 text-xs text-black/50 dark:text-white/50">No warnings issued.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {data.warnings.map((w) => <li key={w.id} className="text-amber-600">{w.reason ?? 'Warning'} · {new Date(w.createdAt).toLocaleTimeString()}</li>)}
                  </ul>
                )}
              </div>
              {/* P4 — "Integrity summary: per-signal % occurrence and count." */}
              <div className="card">
                <div className="text-sm font-semibold">Signal summary</div>
                {!data?.signalSummary.length ? (
                  <p className="mt-1 text-xs text-black/50 dark:text-white/50">No signals to summarize.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {data.signalSummary.map((s) => (
                      <li key={s.type} className="flex items-center justify-between gap-2">
                        <span className="text-black/70 dark:text-white/70">{s.type.replace(/_/g, ' ')}</span>
                        <span className="tabular-nums text-black/40">{s.count} · {s.percent}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
