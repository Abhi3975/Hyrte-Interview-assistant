'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';

interface Session {
  id: string;
  examState: string;
  warningCount: number;
  identityVerified: boolean;
  interview: { title: string; jobRole: string; category: string; durationMins: number };
  evaluation?: { overallScore: number; recommendation: string };
}

const STATE_COLOR: Record<string, string> = {
  WAITING_APPROVAL: 'text-amber-500',
  SCHEDULED: 'text-brand-500',
  ACTIVE: 'text-emerald-500',
  COMPLETED: 'text-black/50 dark:text-white/50',
  TERMINATED: 'text-red-500',
};

export default function CandidateInterviews() {
  const { data } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => api.get<Session[]>('/interviews/my-sessions'),
  });

  return (
    <DashboardShell area="candidate" title="My Interviews" requiredRoles={['CANDIDATE']}>
      {!data?.length ? (
        <div className="card text-sm text-black/60 dark:text-white/60">
          No interviews assigned yet. A recruiter will invite you and unlock the assessment.
        </div>
      ) : (
        <div className="space-y-3">
          {data.map((s) => (
            <div key={s.id} className="card flex items-center justify-between">
              <div>
                <div className="font-medium">{s.interview.title}</div>
                <div className="text-xs text-black/50 dark:text-white/50">
                  {s.interview.jobRole} · {s.interview.category} · {s.interview.durationMins} min
                </div>
              </div>
              <div className="flex items-center gap-4">
                {s.evaluation && (
                  <span className="text-sm">
                    Score <b>{s.evaluation.overallScore}</b> · {s.evaluation.recommendation}
                  </span>
                )}
                <span className={`text-sm font-medium ${STATE_COLOR[s.examState] ?? ''}`}>{s.examState}</span>
                {s.examState === 'SCHEDULED' && (
                  <Link href={`/candidate/room/${s.id}`} className="btn-primary text-sm">Enter</Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
