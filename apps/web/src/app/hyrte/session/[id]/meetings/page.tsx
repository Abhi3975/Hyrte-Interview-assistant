'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { deriveStakeholderStatus, STATUS_DOT, STATUS_LABEL } from '@/lib/hyrte-status';
import { HyrteCalendarEvent, HyrteInboxMessage, HyrteMeetingMessage, HyrteStakeholder } from '@/lib/hyrte-types';

/** Part E2 — "Meetings: join screen + attendee rail with presence/mood as subtle avatar treatment (never numeric labels)."
 * Refinements doc §7 — now also a real live multi-stakeholder discussion the candidate can watch/join, plus
 * persisted notes recalled after the fact (see [id]/meeting.service.ts on the backend). */
export default function HyrteMeetings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { inboxVersion, meetingVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const { data: events } = useQuery({
    queryKey: ['hyrte', 'calendar', id, meetingVersion],
    queryFn: () => api.get<HyrteCalendarEvent[]>(`/hyrte/sessions/${id}/calendar`),
  });
  const { data: stakeholders } = useQuery({
    queryKey: ['hyrte', 'stakeholders', id],
    queryFn: () => api.get<HyrteStakeholder[]>(`/hyrte/sessions/${id}/stakeholders`),
  });
  const { data: inbox } = useQuery({
    queryKey: ['hyrte', 'inbox', id, inboxVersion],
    queryFn: () => api.get<HyrteInboxMessage[]>(`/hyrte/sessions/${id}/inbox`),
  });
  const { data: messages } = useQuery({
    queryKey: ['hyrte', 'meeting-messages', id, joinedId, meetingVersion],
    queryFn: () => api.get<HyrteMeetingMessage[]>(`/hyrte/sessions/${id}/calendar/${joinedId}/messages`),
    enabled: !!joinedId,
  });

  const byId = new Map((stakeholders ?? []).map((s) => [s.id, s]));
  const joinedEvent = events?.find((e) => e.id === joinedId);

  async function join(eventId: string) {
    setJoinedId(eventId);
    await api.post(`/hyrte/sessions/${id}/calendar/${eventId}/attend`);
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'calendar', id] });
  }

  async function speak() {
    if (!draft.trim() || !joinedId) return;
    setSending(true);
    try {
      await api.post(`/hyrte/sessions/${id}/calendar/${joinedId}/messages`, { body: draft });
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['hyrte', 'meeting-messages', id, joinedId] });
    } finally {
      setSending(false);
    }
  }

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Meetings"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="space-y-3">
        {events?.map((e) => {
          const attendees = e.attendeeStakeholderIds.map((sid) => byId.get(sid)).filter((s): s is HyrteStakeholder => !!s);
          const isJoined = joinedId === e.id;
          return (
            <div key={e.id} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{e.title}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {new Date(e.startAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} –{' '}
                    {new Date(e.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {!isJoined ? (
                  <button className="btn-primary" onClick={() => join(e.id)}>
                    {e.notesGeneratedAt ? 'Open' : e.startedAt ? 'Rejoin' : 'Join'}
                  </button>
                ) : (
                  <button className="btn-ghost" onClick={() => setJoinedId(null)}>
                    Leave meeting
                  </button>
                )}
              </div>

              {isJoined && (
                <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--hos-border, rgba(0,0,0,0.05))' }}>
                  {e.agenda && <p className="mb-3 text-sm text-black/70 dark:text-white/70">{e.agenda}</p>}
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                    Attendees
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {attendees.map((s) => {
                      const status = deriveStakeholderStatus(s, inbox);
                      return (
                        <div key={s.id} className="flex items-center gap-2 rounded-lg border border-black/5 px-2.5 py-1.5 dark:border-white/10" title={STATUS_LABEL[status]}>
                          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-[11px] font-semibold dark:bg-white/10">
                            {s.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                            <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-[#0a0f14] ${STATUS_DOT[status]}`} />
                          </span>
                          <div>
                            <div className="text-xs font-medium">{s.name}</div>
                            <div className="text-[11px] text-black/50 dark:text-white/50">{s.role}</div>
                          </div>
                        </div>
                      );
                    })}
                    {attendees.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No one else invited.</p>}
                  </div>

                  <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                    Discussion
                  </div>
                  <div className="mb-3 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-black/5 p-3 dark:border-white/10">
                    {messages?.map((m) => (
                      <div key={m.id} className="text-sm">
                        <span className="font-medium">{m.fromStakeholder?.name ?? 'You'}</span>{' '}
                        <span className="text-xs text-black/40 dark:text-white/40">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <p className="text-black/80 dark:text-white/80">{m.body}</p>
                      </div>
                    ))}
                    {!messages?.length && <p className="text-sm text-black/50 dark:text-white/50">The discussion is just getting started…</p>}
                  </div>

                  {e.notesGeneratedAt ? (
                    <div className="rounded-lg border border-brand-500/20 bg-brand-500/5 p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                        Meeting notes
                      </div>
                      <p className="text-sm text-black/80 dark:text-white/80">{e.notes}</p>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
                        placeholder="Say something in the meeting…"
                        value={draft}
                        onChange={(ev) => setDraft(ev.target.value)}
                        onKeyDown={(ev) => ev.key === 'Enter' && speak()}
                      />
                      <button className="btn-primary" disabled={sending} onClick={speak}>
                        Send
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!events?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing scheduled.</p>}
      </div>
    </DashboardShell>
  );
}
