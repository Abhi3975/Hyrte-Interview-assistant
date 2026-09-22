'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { HeroTaskList, HyrteActivityFeed, HyrteSession } from '@/lib/hyrte-types';

/**
 * Refinements doc §14 — "The onboarding must be MUCH slower. I agree with your
 * observation: 'I felt lost.' That's a product failure for a simulation. The
 * first 5–10 minutes should be guided… Don't throw the user into a world and
 * expect them to figure out the UI."
 *
 * The doc's seven steps are split across two screens by design, not by
 * omission. Steps 1–4 (your company / your role / the current company state /
 * your objective) are the Mission Brief, which the candidate has just read;
 * repeating them here would be the padding §14 is reacting against. This
 * covers 5–7 — where information lives, what needs your attention, your first
 * task — which are the ones that were genuinely missing, because they are
 * about the workspace rather than the fiction.
 *
 * Every step is populated from the REAL session: the actual unread count, the
 * actual top attention item, the actual first hero task. A tour of a UI is
 * forgettable; being walked through your own situation is orientation.
 */

interface Step {
  title: string;
  body: string;
  /** Where this step points, when there is somewhere real to go. */
  href?: string;
  hrefLabel?: string;
}

function buildSteps(sessionId: string, activity: HyrteActivityFeed | undefined, tasks: HeroTaskList | undefined): Step[] {
  const base = `/hyrte/session/${sessionId}`;
  const unread = activity?.counts.total ?? 0;
  const top = activity?.entries.find((e) => e.unread);
  const firstTask = tasks?.tasks[0];

  return [
    {
      title: 'Where the information lives',
      body:
        'Everything you need is somewhere in here, and some of it nobody will hand you. Email and Slack are how ' +
        'people reach you. The Knowledge Base holds the company documents — including a few that stay closed ' +
        'until you go and find them. Analytics is the live state of the business.',
      href: `${base}/knowledge-base`,
      hrefLabel: 'Open the Knowledge Base',
    },
    {
      title: 'What needs you right now',
      body: top
        ? `${unread} thing${unread === 1 ? '' : 's'} are waiting on you. The most pressing is from ${
            top.personName ?? 'your team'
          }: "${top.title}". Ignoring something urgent here has consequences — people follow up, and it escalates.`
        : 'Nothing is waiting on you yet. When it is, it appears in the bell at the top and on the sidebar — you ' +
          'will not have to go looking for it.',
      href: top?.href ?? `${base}/inbox`,
      hrefLabel: top ? 'Go to it' : 'Open your inbox',
    },
    {
      title: 'Your first task',
      body: firstTask
        ? `You have ${tasks!.tasks.length} real ${tasks!.tasks.length === 1 ? 'task' : 'tasks'}. Start with "${
            firstTask.title
          }" — ${firstTask.summary} Opening it gives you somewhere to actually do the work, not a box to tick.`
        : 'Your tasks live under My Tasks. Each one opens a real workspace where you do the work.',
      href: firstTask ? `${base}/my-tasks/${firstTask.id}` : `${base}/my-tasks`,
      hrefLabel: firstTask ? 'Open it' : 'Open My Tasks',
    },
  ];
}

export function GuidedOnboarding({
  session,
  activity,
  tasks,
}: {
  session: HyrteSession;
  activity: HyrteActivityFeed | undefined;
  tasks: HeroTaskList | undefined;
}) {
  const [index, setIndex] = useState(0);
  const queryClient = useQueryClient();

  const finish = useMutation({
    mutationFn: () => api.post(`/hyrte/sessions/${session.id}/onboarding/complete`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hyrte', 'session', session.id] }),
  });

  // Runs once per session, and never for a session already past it.
  if (session.onboardingDoneAt) return null;

  const steps = buildSteps(session.id, activity, tasks);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  return (
    <div className="mb-4 rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
          Getting you oriented · {index + 1} of {steps.length}
        </div>
        <button
          className="text-xs text-black/45 hover:text-black/70 dark:text-white/45 dark:hover:text-white/70"
          onClick={() => finish.mutate()}
        >
          Skip — I&apos;ll find my way
        </button>
      </div>

      <h3 className="mt-2 text-base font-semibold">{step.title}</h3>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-black/70 dark:text-white/70">{step.body}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {step.href && (
          <Link href={step.href} className="text-sm font-medium text-brand-600 dark:text-brand-400">
            {step.hrefLabel} →
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          {index > 0 && (
            <button className="btn-ghost text-sm" onClick={() => setIndex((i) => i - 1)}>
              Back
            </button>
          )}
          <button
            className="btn-primary text-sm"
            disabled={finish.isPending}
            onClick={() => (isLast ? finish.mutate() : setIndex((i) => i + 1))}
          >
            {isLast ? 'Start working' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
