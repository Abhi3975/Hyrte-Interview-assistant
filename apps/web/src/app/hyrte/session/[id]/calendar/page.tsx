'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { HyrteSessionInfoCard } from '@/components/hyrte/session-info-card';
import { hyrteNav } from '@/lib/hyrte-nav';
import { api } from '@/lib/api';
import { HyrteCalendarEvent } from '@/lib/hyrte-types';

export default function HyrteCalendar({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: events } = useQuery({
    queryKey: ['hyrte', 'calendar', id],
    queryFn: () => api.get<HyrteCalendarEvent[]>(`/hyrte/sessions/${id}/calendar`),
  });

  return (
    <DashboardShell
      area="hyrte"
      variant="hyrte-os"
      title="Calendar"
      requiredRoles={['CANDIDATE']}
      navOverride={hyrteNav(id)}
      sidebarExtra={<HyrteSessionInfoCard sessionId={id} />}
      backHref="/candidate"
      backLabel="Exit"
    >
      <div className="space-y-2">
        {events?.map((e) => (
          <div key={e.id} className="card flex items-center justify-between">
            <span className="font-medium">{e.title}</span>
            <span className="text-sm text-black/50 dark:text-white/50">
              {new Date(e.startAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} –{' '}
              {new Date(e.endAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
        {!events?.length && <p className="text-sm text-black/50 dark:text-white/50">Nothing on the calendar.</p>}
      </div>
    </DashboardShell>
  );
}
