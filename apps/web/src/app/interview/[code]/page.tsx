'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { ShieldIcon } from '@/components/icons';

interface Config {
  interviewId: string; title: string; jobRole: string; category: string;
  difficulty: string; durationMins: number; candidateName: string; candidateEmail?: string; resumeContext?: string;
}

export default function TakeByLink({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const { user } = useAuthStore();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  useEffect(() => {
    api.get<Config>(`/interviews/invite/${code}`).then(setCfg).catch((e) => setError(e?.message ?? 'Invalid link'));
  }, [code]);

  function begin() {
    if (!cfg) return;
    // Resume context can be large — stash it in sessionStorage for the room.
    try {
      if (cfg.resumeContext) sessionStorage.setItem(`resume:${cfg.interviewId}`, cfg.resumeContext);
      else sessionStorage.removeItem(`resume:${cfg.interviewId}`);
    } catch {}
    const q = new URLSearchParams({
      assessment: cfg.interviewId, cat: cfg.category, role: cfg.jobRole,
      diff: cfg.difficulty, dur: String(cfg.durationMins),
    });
    router.push(`/candidate/interview?${q.toString()}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
      <div className="w-full max-w-md rounded-2xl bg-white/5 p-6">
        <div className="text-lg font-bold">Interview<span className="text-brand-500">AI</span></div>
        {error ? (
          <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p>
        ) : !cfg ? (
          <p className="mt-4 text-sm text-white/60">Loading your interview…</p>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-bold">{cfg.title}</h1>
            <p className="mt-1 text-sm text-white/60">Hi {cfg.candidateName}, you&apos;ve been invited to a live AI interview.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <Info label="Role" value={cfg.jobRole} />
              <Info label="Focus" value={cfg.category} />
              <Info label="Difficulty" value={cfg.difficulty} />
              <Info label="Duration" value={`${cfg.durationMins} min`} />
            </div>
            <div className="mt-4 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-400">
              <ShieldIcon width={12} height={12} /> Camera, mic & screen focus are monitored for integrity.
            </div>
            {!hydrated ? null : user ? (
              <button onClick={begin} className="btn-primary mt-5 w-full justify-center">Start interview</button>
            ) : (
              <Link href={`/signup?next=${encodeURIComponent(`/interview/${code}`)}`} className="btn-primary mt-5 flex w-full justify-center">Sign in to start</Link>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white/5 p-2"><div className="text-[10px] uppercase tracking-wide text-white/40">{label}</div><div className="mt-0.5 font-medium">{value}</div></div>;
}
