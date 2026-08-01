'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { api, ApiError } from '@/lib/api';
import { HyrteSession } from '@/lib/hyrte-types';

const MIN_REASONING_LENGTH = 20;

/** UX flow §8 step 2 — a quick warm-up before the workspace unlocks. */
export default function HyrteBaselineChallenge({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [optionId, setOptionId] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState('');

  const { data: session, isLoading } = useQuery({
    queryKey: ['hyrte', 'session', id],
    queryFn: () => api.get<HyrteSession>(`/hyrte/sessions/${id}`),
  });

  const submitMutation = useMutation({
    mutationFn: () => api.post(`/hyrte/sessions/${id}/baseline-challenge/submit`, { optionId, reasoning }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'session', id] });
      router.push(`/hyrte/session/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not submit your answer'),
  });

  const challenge = session?.baselineChallenge;
  const canSubmit = optionId && reasoning.trim().length >= MIN_REASONING_LENGTH;

  return (
    <DashboardShell
      area="hyrte"
      title="Quick Warm-Up"
      requiredRoles={['CANDIDATE']}
      navOverride={[]}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="mx-auto max-w-2xl py-6">
        {isLoading && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}
        {challenge && (
          <div className="space-y-5">
            <p className="text-sm text-black/60 dark:text-white/60">
              One quick scenario before you enter the workplace. There&apos;s no single correct answer — we&apos;re
              interested in your reasoning.
            </p>

            <div className="card">
              <p className="text-sm">{challenge.scenario}</p>
            </div>

            <div className="space-y-2">
              {challenge.options.map((o) => (
                <label
                  key={o.id}
                  className={`block cursor-pointer rounded-lg border p-3 text-sm transition ${
                    optionId === o.id
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5'
                  }`}
                >
                  <input
                    type="radio"
                    name="option"
                    className="mr-2"
                    checked={optionId === o.id}
                    onChange={() => setOptionId(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Why?</label>
              <textarea
                className="w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
                rows={4}
                placeholder="Explain your reasoning…"
                value={reasoning}
                onChange={(e) => setReasoning(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              className="btn-primary w-full"
              disabled={!canSubmit || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              {submitMutation.isPending ? 'Entering the workplace…' : 'Submit and enter the workplace'}
            </button>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
