'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { api, ApiError } from '@/lib/api';

interface SimulationRequestPreview {
  id: string;
  code: string;
  status: string;
  role: string;
  coreOutcomes: string[];
  experienceLevel: string;
  industry: string;
  companyType: string;
  difficulty: string;
  culture: string;
}

function useHydratedAuth() {
  const { user } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return { user, hydrated };
}

/**
 * Upgrade §1 — the candidate side of a recruiter-shared simulation link.
 * Works pre-login (the preview below is public) so a candidate can see what
 * they're about to enter before deciding to sign up. Launching requires auth.
 */
export default function HyrteStartPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { user, hydrated } = useHydratedAuth();
  const [preview, setPreview] = useState<SimulationRequestPreview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    api
      .get<SimulationRequestPreview>(`/hyrte/simulation-requests/by-code/${params.code}`)
      .then(setPreview)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'This simulation link is invalid'))
      .finally(() => setLoading(false));
  }, [params.code]);

  async function enter() {
    if (!hydrated) return;
    if (!user) {
      router.push(`/signup?next=${encodeURIComponent(`/hyrte/start/${params.code}`)}`);
      return;
    }
    // The launch endpoint is CANDIDATE-only server-side (recruiters preview/
    // create links but don't take them). Catch that case here with a real
    // explanation instead of ever surfacing the backend guard's raw
    // "Requires role: CANDIDATE" text — this is a signed-in recruiter/admin
    // testing their own link, not an actual authorization failure worth
    // alarming them over.
    if (user.role !== 'CANDIDATE') {
      setError(
        `This link launches a candidate's simulation, and you're signed in as ${user.role.toLowerCase()}. ` +
          `Sign out and open the link again with a candidate account to try it yourself, or just send this link to the candidate.`,
      );
      return;
    }
    setLaunching(true);
    setError('');
    try {
      const session = await api.post<{ id: string }>(`/hyrte/simulation-requests/by-code/${params.code}/launch`);
      router.push(`/hyrte/session/${session.id}/mission-brief`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the simulation');
      setLaunching(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div className="text-lg font-bold">
          Interview<span className="text-brand-500">AI</span> · HYRTE
        </div>
        <ThemeToggle />
      </div>

      {loading && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}
      {error && <p className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

      {preview && (
        <div className="card space-y-5">
          <div>
            <h1 className="text-xl font-bold">{preview.role}</h1>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              {preview.experienceLevel} · {preview.industry} · {preview.companyType} · {preview.culture}
            </p>
          </div>
          <p className="text-sm text-black/60 dark:text-white/60">
            You&apos;ll be dropped into a live workplace built from a real job description — inbox, Slack,
            tasks, calendar, and stakeholders all populate for you, grounded in what this role actually
            needs to accomplish.
          </p>
          {preview.coreOutcomes.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
                What you&apos;ll be evaluated on
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {preview.coreOutcomes.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}
          <button className="btn-primary w-full" disabled={launching || !hydrated} onClick={enter}>
            {launching
              ? 'Building your workplace…'
              : !user
                ? 'Sign in to enter the workplace'
                : user.role === 'CANDIDATE'
                  ? 'Enter the workplace'
                  : `Preview only — signed in as ${user.role.toLowerCase()}`}
          </button>
          {user && user.role !== 'CANDIDATE' && (
            <p className="text-xs text-black/40 dark:text-white/40">
              This launches for candidates only. Share this link, or open it in a private window signed
              in as a candidate to try it yourself.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
