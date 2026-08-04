'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { useHyrteStore } from '@/store/hyrte';
import { deriveStakeholderStatus, STATUS_DOT, STATUS_LABEL } from '@/lib/hyrte-status';
import { HyrteCalendarEvent, HyrteInboxMessage, HyrteStakeholder } from '@/lib/hyrte-types';

/** Part E2 — "Meetings: join screen + attendee rail with presence/mood as subtle avatar treatment (never numeric labels)." */
export default function HyrteMeetings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { inboxVersion } = useHyrteStore();
  const queryClient = useQueryClient();
  const [joinedId, setJoinedId] = useState<string | null>(null);

  const { data: events } = useQuery({
    queryKey: ['hyrte', 'calendar', id],
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

  const byId = new Map((stakeholders ?? []).map((s) => [s.id, s]));

  async function join(eventId: string) {
    setJoinedId(eventId);
    await api.post(`/hyrte/sessions/${id}/calendar/${eventId}/attend`);
    queryClient.invalidateQueries({ queryKey: ['hyrte', 'decision-log', id] });
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
                    Join
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
