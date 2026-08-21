'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { HyrteInboxMessage, HyrteStakeholder, HyrteWorldEvent } from '@/lib/hyrte-types';

/**
 * Part E2 — "ignored high-priority threads visually escalate (normal → amber
 * → red edge) on the ENGINE's trigger clock." Driven entirely by real,
 * persisted HyrteWorldEvent rows (the actual escalation-check the backend
 * scheduled), never a client-side countdown guessing at the engine's timing.
 */
function escalationEdge(message: HyrteInboxMessage, allMessages: HyrteInboxMessage[], worldEvents: HyrteWorldEvent[] | undefined): string {
  const hasEscalated = allMessages.some((m) => m.escalatesMessageId === message.id);
  if (hasEscalated) return 'border-l-4 border-l-red-500';
  const onTheClock = (worldEvents ?? []).some(
    (e) => e.status === 'PENDING' && e.triggerCondition === `message_unread:${message.id}`,
  );
  if (onTheClock && !message.readAt) return 'border-l-4 border-l-amber-500';
  return '';
}

const REMINDER_OPTIONS = [
  { label: 'in 5 min', ms: 5 * 60_000 },
  { label: 'in 15 min', ms: 15 * 60_000 },
  { label: 'in 1 hour', ms: 60 * 60_000 },
];

export default function HyrteInbox({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { inboxVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [ccIds, setCcIds] = useState<Set<string>>(new Set());
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardTo, setForwardTo] = useState('');
  const [forwardNote, setForwardNote] = useState('');
  const [noteDraft, setNoteDraft] = useState('');

  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', id, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${id}/inbox`),
  });
  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
  });
  // No dedicated websocket event for the escalation clock ticking — it's a
  // silent backend timer until it fires or cancels — so this one query polls.
  const { data: worldEvents } = useQuery({
    queryKey: ['hyrte', 'world-events', id],
    queryFn: () => api.get<HyrteWorldEvent[]>(`/hyrte/sessions/${id}/world-events`),
    refetchInterval: 15_000,
  });

  const visible = (inbox ?? []).filter((m) => (showArchived ? !!m.archivedAt : !m.archivedAt));

  function invalidateInbox() {
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'inbox', id] });
  }

  async function openMessageId(m: HyrteInboxMessage) {
    const next = openId === m.id ? null : m.id;
    setOpenId(next);
    setCcOpen(false);
    setCcIds(new Set());
    setForwardOpen(false);
    setForwardTo('');
    setForwardNote('');
    setNoteDraft('');
    if (next && !m.readAt) {
      await api.patch(`/hyrte/sessions/${id}/inbox/${m.id}/read`, { read: true });
      invalidateInbox();
    }
  }

  async function sendReply(messageId: string) {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/reply`, {
        body: reply,
        ...(ccIds.size ? { ccStakeholderIds: Array.from(ccIds) } : {}),
      });
      setReply('');
      setOpenId(null);
      invalidateInbox();
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    } finally {
      setSending(false);
    }
  }

  async function markUnread(messageId: string) {
    await api.patch(`/hyrte/sessions/${id}/inbox/${messageId}/read`, { read: false });
    invalidateInbox();
  }

  async function toggleFlag(m: HyrteInboxMessage) {
    await api.patch(`/hyrte/sessions/${id}/inbox/${m.id}/flag`, { flagged: !m.flagged });
    invalidateInbox();
  }

  async function toggleArchive(m: HyrteInboxMessage) {
    await api.patch(`/hyrte/sessions/${id}/inbox/${m.id}/archive`, { archived: !m.archivedAt });
    if (openId === m.id) setOpenId(null);
    invalidateInbox();
  }

  async function convertToTask(messageId: string) {
    await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/convert-to-task`, {});
    invalidateInbox();
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'tasks', id] });
  }

  async function scheduleReminder(messageId: string, ms: number) {
    const remindAt = new Date(Date.now() + ms).toISOString();
    await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/reminder`, { remindAt });
    invalidateInbox();
  }

  async function sendForward(messageId: string) {
    if (!forwardTo) return;
    await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/forward`, { toStakeholderId: forwardTo, note: forwardNote || undefined });
    setForwardOpen(false);
    setForwardTo('');
    setForwardNote('');
    invalidateInbox();
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
  }

  async function addNote(messageId: string) {
    if (!noteDraft.trim()) return;
    await api.post(`/hyrte/sessions/${id}/inbox/${messageId}/notes`, { text: noteDraft });
    setNoteDraft('');
    invalidateInbox();
  }

  function toggleCc(sid: string) {
    setCcIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Inbox"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="mb-3 flex justify-end">
        <button
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${showArchived ? 'bg-brand-500/15 text-brand-600' : 'text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/5'}`}
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Showing archived' : 'Show archived'}
        </button>
      </div>

      <div className="space-y-3">
        {visible.map((m) => (
          <div key={m.id} className={`card ${escalationEdge(m, inbox ?? [], worldEvents)}`}>
            <div className="flex w-full items-start justify-between">
              <button className="flex-1 text-left" onClick={() => openMessageId(m)}>
                <div className="flex items-center gap-2">
                  {!m.readAt && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                  {m.urgent && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600">Urgent</span>}
                  {m.escalatesMessageId && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600">Follow-up</span>}
                  {m.convertedToWorkItemId && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600">Task created</span>}
                  <span className="font-medium">{m.subject}</span>
                </div>
                <div className="mt-0.5 text-xs text-black/50 dark:text-white/50">
                  from {m.fromStakeholder?.name ?? 'Unknown'} · {m.fromStakeholder?.role}
                </div>
              </button>
              <div className="flex items-center gap-1">
                <button
                  title={m.flagged ? 'Unflag' : 'Flag'}
                  onClick={() => toggleFlag(m)}
                  className={`rounded-md p-1.5 text-xs ${m.flagged ? 'text-amber-500' : 'text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60'}`}
                >
                  ⚑
                </button>
                <button
                  title={m.archivedAt ? 'Unarchive' : 'Archive'}
                  onClick={() => toggleArchive(m)}
                  className="rounded-md p-1.5 text-xs text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
                >
                  {m.archivedAt ? '↩' : '🗄'}
                </button>
                <span className="ml-1 text-xs text-black/40 dark:text-white/40">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
            </div>

            {openId === m.id && (
              <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
                <p className="whitespace-pre-wrap text-sm text-black/80 dark:text-white/80">{m.body}</p>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => markUnread(m.id)}>
                    Mark unread
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setForwardOpen((v) => !v)}>
                    Forward
                  </button>
                  <button className="btn-ghost !px-2 !py-1 text-xs" disabled={!!m.convertedToWorkItemId} onClick={() => convertToTask(m.id)}>
                    {m.convertedToWorkItemId ? 'Task created ✓' : 'Convert to task'}
                  </button>
                  {REMINDER_OPTIONS.map((r) => (
                    <button key={r.label} className="btn-ghost !px-2 !py-1 text-xs" onClick={() => scheduleReminder(m.id, r.ms)}>
                      Remind me {r.label}
                    </button>
                  ))}
                  {m.reminderAt && new Date(m.reminderAt) > new Date() && (
                    <span className="rounded-full bg-black/5 px-2 py-1 text-black/50 dark:bg-white/10 dark:text-white/50">
                      Reminder set for {new Date(m.reminderAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                {forwardOpen && (
                  <div className="mt-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">Forward to</div>
                    <select
                      className="mb-2 w-full rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-sm dark:border-white/10"
                      value={forwardTo}
                      onChange={(e) => setForwardTo(e.target.value)}
                    >
                      <option value="">Select a person…</option>
                      {stakeholders?.filter((s) => s.id !== m.fromStakeholder?.id).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {s.role}
                        </option>
                      ))}
                    </select>
                    <textarea
                      className="w-full rounded-lg border border-black/10 bg-transparent p-2 text-sm dark:border-white/10"
                      rows={2}
                      placeholder="Add a note (optional)…"
                      value={forwardNote}
                      onChange={(e) => setForwardNote(e.target.value)}
                    />
                    <button className="btn-primary mt-2 !px-3 !py-1.5 text-xs" disabled={!forwardTo} onClick={() => sendForward(m.id)}>
                      Send forward
                    </button>
                  </div>
                )}

                <textarea
                  className="mt-3 w-full rounded-lg border border-black/10 bg-transparent p-2 text-sm dark:border-white/10"
                  rows={3}
                  placeholder="Write your reply…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                />
                <button className="mt-1 text-xs text-brand-600 hover:underline" onClick={() => setCcOpen((v) => !v)}>
                  {ccOpen ? 'Hide CC' : `+ CC${ccIds.size ? ` (${ccIds.size})` : ''}`}
                </button>
                {ccOpen && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {stakeholders?.filter((s) => s.id !== m.fromStakeholder?.id).map((s) => (
                      <label key={s.id} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2 py-1 text-xs dark:border-white/10">
                        <input type="checkbox" checked={ccIds.has(s.id)} onChange={() => toggleCc(s.id)} />
                        {s.name}
                      </label>
                    ))}
                  </div>
                )}
                <div>
                  <button className="btn-primary mt-2" disabled={sending} onClick={() => sendReply(m.id)}>
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                </div>

                <div className="mt-4 border-t border-black/5 pt-3 dark:border-white/10">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                    Internal notes (private — never sent)
                  </div>
                  {m.internalNotes.map((n, i) => (
                    <div key={i} className="mb-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-black/70 dark:text-white/70">
                      {n.text}
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-black/10 bg-transparent px-2 py-1.5 text-xs dark:border-white/10"
                      placeholder="Jot a private note to yourself…"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addNote(m.id)}
                    />
                    <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => addNote(m.id)}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
        {!visible.length && (
          <p className="text-sm text-black/50 dark:text-white/50">{showArchived ? 'No archived messages.' : 'No messages yet.'}</p>
        )}
      </div>
    </DashboardShell>
  );
}
