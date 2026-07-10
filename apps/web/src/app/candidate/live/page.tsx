'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { MicIcon, VideoIcon, CodeIcon, ShieldIcon } from '@/components/icons';
import { api } from '@/lib/api';

interface Session {
  id: string;
  examState: string;
  identityVerified: boolean;
  interview: { title: string; jobRole: string; category: string; durationMins: number };
}

const READY_STATES = ['SCHEDULED', 'WAITING_APPROVAL', 'ACTIVE', 'WARNING_ISSUED'];

export default function LiveInterview() {
  const { data } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<Session[]>('/interviews/my-sessions'),
  });

  const live = (data ?? []).filter((s) => READY_STATES.includes(s.examState));

  return (
    <DashboardShell area="candidate" title="Live Interview" requiredRoles={['CANDIDATE']}>
      {/* Mode explainer */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ModeCard Icon={MicIcon} title="AI Voice" body="Spoken interview with adaptive follow-ups." />
        <ModeCard Icon={VideoIcon} title="AI Video" body="Webcam on, presence & confidence analysis." />
        <ModeCard Icon={CodeIcon} title="Live Coding" body="Editor + execution against test cases." />
        <ModeCard Icon={ShieldIcon} title="Proctored" body="Real-time integrity monitoring." />
      </div>

      <h3 className="mb-3 text-sm font-semibold text-black/60 dark:text-white/60">Available now</h3>
      {live.length === 0 ? (
        <div className="card text-sm text-black/60 dark:text-white/60">
          No live interviews available yet. Once a recruiter unlocks an assessment for you, it will
          appear here to join instantly.
        </div>
      ) : (
        <div className="space-y-3">
          {live.map((s) => (
            <div key={s.id} className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{s.interview.title}</div>
                <div className="text-xs text-black/50 dark:text-white/50">
                  {s.interview.jobRole} · {s.interview.category} · {s.interview.durationMins} min ·{' '}
                  <span className="text-brand-500">{s.examState}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href={`/candidate/voice/${s.id}`} className="btn-ghost text-sm">
                  <span className="mr-1 inline-flex"><MicIcon className="h-4 w-4" /></span> Voice
                </Link>
                <Link href={`/candidate/room/${s.id}`} className="btn-primary text-sm">
                  Enter interview room
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}

function ModeCard({
  Icon,
  title,
  body,
}: {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
}) {
  return (
    <div className="card">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-brand-500/20 bg-brand-500/10 text-brand-500">
        <Icon className="h-5 w-5" />
      </div>
      <div className="mt-2 text-sm font-semibold">{title}</div>
      <div className="mt-0.5 text-xs text-black/55 dark:text-white/55">{body}</div>
    </div>
  );
}
