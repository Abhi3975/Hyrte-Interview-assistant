'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { useHyrteNav } from '@/lib/hyrte-nav';
import { ActivityCenter } from '@/components/hyrte/activity-center';
import { api, ApiError } from '@/lib/api';
import { COMPANY_STATE_LABELS, HeroTaskWorkspace } from '@/lib/hyrte-types';

/** Long enough that typing isn't interrupted, short enough that nothing meaningful is ever lost. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

/**
 * Refinements doc §10 and the Tasks appendix — "For HYRTE, the task should open
 * an actual role workspace where the candidate performs the work. My Tasks
 * tells you WHAT needs to be done. Opening the task gives you the actual tools
 * to DO it."
 *
 * Founder feedback (WhatsApp, 7 Sep): "Simulation kaafi review and approve type
 * hori thi instead of working on real tasks disguised in the simulation."
 *
 * Three workspace shapes, resolved from the role task template server-side:
 *  - DELIVERABLE — a structured document written section by section (PRD,
 *    campaign brief, debug report, analysis…).
 *  - DECISION — the doc's own Launch Room shape: recommendation, reasoning,
 *    risks, mitigation, backed by real evidence from this company.
 *  - PRIORITIZATION — the doc's own roadmap board: rank the real competing asks
 *    into Now / Next / Later / Not planned and justify each placement.
 *
 * Everything the candidate writes autosaves, and submitting sends it to a real
 * colleague who can hand it back.
 */
export default function HyrteTaskWorkspace({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = use(params);
  const nav = useHyrteNav(id);
  const queryClient = useQueryClient();

  const { data: task } = useQuery({
    queryKey: ['hyrte', 'my-task', id, taskId],
    queryFn: () => api.get<HeroTaskWorkspace>(`/hyrte/sessions/${id}/my-tasks/${taskId}`),
  });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hydrated = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Patches ACCUMULATE between flushes rather than replacing each other. With a
  // single shared debounce timer, ranking an item and then typing its rationale
  // within the debounce window used to cancel the pending placement save and
  // send only the rationale — the board looked ranked on screen but persisted
  // an empty placement. Caught live.
  const pending = useRef<{ draft?: Record<string, string>; placement?: Record<string, string>; rationale?: Record<string, string> }>({});

  // Hydrate once from the server so a reload picks up exactly where they left
  // off, but never again — re-hydrating on refetch would clobber live typing.
  useEffect(() => {
    if (!task || hydrated.current) return;
    hydrated.current = true;
    setDraft(task.deliverable.draft ?? {});
    setPlacement(task.deliverable.placement ?? {});
    setRationale(task.deliverable.rationale ?? {});
    setSavedAt(task.deliverable.lastSavedAt ?? null);
  }, [task]);

  const persist = useCallback(
    (patch: { draft?: Record<string, string>; placement?: Record<string, string>; rationale?: Record<string, string> }) => {
      pending.current = { ...pending.current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const body = pending.current;
        pending.current = {};
        api
          .patch<{ savedAt: string }>(`/hyrte/sessions/${id}/my-tasks/${taskId}/draft`, body)
          .then((res) => setSavedAt(res.savedAt))
          // Nothing is lost on a failed save — the next keystroke re-sends the
          // full local state, and Submit flushes everything explicitly.
          .catch(() => {});
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [id, taskId],
  );

  function updateSection(sectionId: string, value: string) {
    const next = { ...draft, [sectionId]: value };
    setDraft(next);
    persist({ draft: next });
  }

  function place(itemId: string, bucket: string) {
    const next = { ...placement, [itemId]: bucket };
    setPlacement(next);
    persist({ placement: next });
  }

  function updateRationale(itemId: string, value: string) {
    const next = { ...rationale, [itemId]: value };
    setRationale(next);
    persist({ rationale: next });
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    // Flush any pending autosave first, so the reviewer reads what is actually
    // on screen rather than the state from a second and a half ago.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await api.patch(`/hyrte/sessions/${id}/my-tasks/${taskId}/draft`, { draft, placement, rationale });
      await api.post(`/hyrte/sessions/${id}/my-tasks/${taskId}/submit`, {});
      await queryClient.invalidateQueries({ queryKey: ['hyrte', 'my-task', id, taskId] });
      await queryClient.invalidateQueries({ queryKey: ['hyrte', 'my-tasks', id] });
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : 'Could not submit — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const latestReview = task?.reviewFeedback?.[task.reviewFeedback.length - 1];
  const done = task?.state === 'COMPLETED';
  const metrics = useMemo(() => Object.entries(task?.resources.metrics ?? {}), [task?.resources.metrics]);

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title={task?.title ?? 'Task'}
      requiredRoles={['CANDIDATE']}
      navOverride={nav}
      headerExtra={<ActivityCenter sessionId={id} />}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref={`/hyrte/session/${id}/my-tasks`}
      backLabel="My Tasks"
    >
      {!task && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}

      {task && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            <div className="card">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{task.title}</h2>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium dark:bg-white/10">{task.stateLabel}</span>
              </div>
              <p className="mt-2 text-sm text-black/70 dark:text-white/70">{task.brief.objective}</p>
              {task.brief.context && <p className="mt-2 text-sm text-black/55 dark:text-white/55">{task.brief.context}</p>}
              {!!task.brief.successCriteria.length && (
                <div className="mt-4 rounded-lg border border-black/5 p-3 dark:border-white/10">
                  <div className="text-xs font-medium uppercase tracking-wide text-black/40 dark:text-white/40">What good looks like</div>
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-black/65 dark:text-white/65">
                    {task.brief.successCriteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* A real colleague read this and responded — the Tasks appendix's
                "Engineering agent reviews the PRD... the candidate can revise it." */}
            {latestReview && (
              <div
                className={`card border-l-4 ${
                  latestReview.verdict === 'approved' ? 'border-l-emerald-500' : 'border-l-red-500'
                }`}
              >
                <div className="text-sm font-medium">
                  {latestReview.stakeholderName} · {latestReview.verdict === 'approved' ? 'Approved' : 'Requested changes'}
                </div>
                <p className="mt-1 text-sm text-black/70 dark:text-white/70">{latestReview.notes}</p>
              </div>
            )}

            {task.workspaceKind === 'PRIORITIZATION' ? (
              <div className="card">
                <h3 className="font-semibold">Rank the work</h3>
                <p className="mt-1 text-sm text-black/55 dark:text-white/55">
                  Put every ask where you actually think it belongs, and say why. People will push back on this.
                </p>
                <div className="mt-4 space-y-3">
                  {(task.deliverable.items ?? []).map((item) => (
                    <div key={item.id} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
                      <div className="text-sm font-medium">{item.label}</div>
                      {item.evidence && <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">{item.evidence}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(task.deliverable.buckets ?? []).map((bucket) => (
                          <button
                            key={bucket}
                            disabled={done}
                            onClick={() => place(item.id, bucket)}
                            className={`rounded-full px-2.5 py-1 text-xs transition disabled:opacity-50 ${
                              placement[item.id] === bucket
                                ? 'bg-brand-500 text-white'
                                : 'bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/20'
                            }`}
                          >
                            {bucket}
                          </button>
                        ))}
                      </div>
                      <textarea
                        disabled={done}
                        value={rationale[item.id] ?? ''}
                        onChange={(e) => updateRationale(item.id, e.target.value)}
                        placeholder="Why here? What are you trading off?"
                        className="mt-2 w-full resize-y rounded-lg border border-black/10 bg-transparent p-2 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
                        rows={2}
                      />
                    </div>
                  ))}
                  {(task.deliverable.items ?? []).length === 0 && (
                    <p className="text-sm text-black/50 dark:text-white/50">No competing asks were generated for this board.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="card">
                <div className="space-y-5">
                  {(task.deliverable.sections ?? []).map((section) => (
                    <div key={section.id}>
                      <label className="flex items-center gap-1.5 text-sm font-medium">
                        {section.label}
                        {section.required && <span className="text-red-500">*</span>}
                      </label>
                      <textarea
                        disabled={done}
                        value={draft[section.id] ?? ''}
                        onChange={(e) => updateSection(section.id, e.target.value)}
                        placeholder={section.hint}
                        rows={section.long ? 5 : 2}
                        className="mt-1.5 w-full resize-y rounded-lg border border-black/10 bg-transparent p-3 text-sm outline-none focus:border-brand-500 disabled:opacity-60 dark:border-white/10"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" disabled={submitting || done} onClick={submit}>
                {done ? 'Completed' : submitting ? 'Sending for review…' : task.submissionCount > 0 ? 'Resubmit' : 'Submit for review'}
              </button>
              <span className="text-xs text-black/40 dark:text-white/40">
                {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not saved yet'}
              </span>
              {submitError && <span className="text-xs text-red-500">{submitError}</span>}
            </div>
          </div>

          {/* The Tasks appendix's "what happens around it" — the candidate pulls
              evidence from the same world everything else lives in. */}
          <aside className="space-y-4">
            {!!metrics.length && (
              <div className="card">
                <h3 className="text-sm font-semibold">Live company metrics</h3>
                <dl className="mt-3 space-y-1.5">
                  {metrics.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <dt className="text-black/55 dark:text-white/55">{COMPANY_STATE_LABELS[key as keyof typeof COMPANY_STATE_LABELS] ?? key}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
                <Link href={`/hyrte/session/${id}/analytics`} className="mt-3 inline-block text-xs font-medium text-brand-600 dark:text-brand-400">
                  Open Analytics →
                </Link>
              </div>
            )}

            <div className="card">
              <h3 className="text-sm font-semibold">Talk to your team</h3>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">They know things that are not written down anywhere.</p>
              <ul className="mt-3 space-y-2">
                {task.resources.people.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/hyrte/session/${id}/slack?channel=${encodeURIComponent(p.dmChannel)}`}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-black/45 dark:text-white/45">{p.role}</span>
                      </span>
                      <span className="shrink-0 text-xs text-brand-600 dark:text-brand-400">Chat</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold">Context & resources</h3>
              <ul className="mt-3 space-y-1.5">
                {task.resources.knowledgeDocs.map((d) => (
                  <li key={d.id}>
                    <Link
                      href={`/hyrte/session/${id}/knowledge-base?doc=${d.id}`}
                      className="block truncate rounded px-1 py-0.5 text-sm text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/5"
                    >
                      {d.title}
                      <span className="text-black/35 dark:text-white/35"> · {d.category}</span>
                    </Link>
                  </li>
                ))}
                {task.resources.knowledgeDocs.length === 0 && <li className="text-sm text-black/40 dark:text-white/40">Nothing filed yet.</li>}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </DashboardShell>
  );
}
