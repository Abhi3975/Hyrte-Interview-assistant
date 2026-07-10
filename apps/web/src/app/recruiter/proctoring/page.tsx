'use client';

import { useQuery } from '@tanstack/react-query';
import { DashboardShell } from '@/components/dashboard-shell';
import { RiskMeter } from '@/components/risk-meter';
import { api } from '@/lib/api';

interface LiveSession {
  id: string;
  riskScore: number;
  warningCount: number;
  examState: string;
  candidate: { id: string; fullName: string };
  interview: { title: string; jobRole: string };
}

export default function LiveProctoringPage() {
  // Polls the API; in production this upgrades to a WebSocket subscription on
  // the `proctoring:*` Redis channel for sub-second updates.
  const { data } = useQuery({
    queryKey: ['live-proctoring'],
    queryFn: () => api.get<LiveSession[]>('/proctoring/live'),
    refetchInterval: 5000,
  });

  return (
    <DashboardShell area="recruiter" title="Live Proctoring" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <p className="mb-4 text-sm text-black/60 dark:text-white/60">
        Live sessions ranked by risk. Scores reflect weighted, decaying evidence — review the
        timeline before acting. The platform never auto-accuses.
      </p>

      {!data?.length ? (
        <div className="card text-sm text-black/60 dark:text-white/60">No active sessions right now.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((s) => (
            <div key={s.id} className="card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{s.candidate.fullName}</div>
                  <div className="text-xs text-black/50 dark:text-white/50">
                    {s.interview.title} · {s.interview.jobRole}
                  </div>
                </div>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs dark:border-white/10">
                  {s.examState} · {s.warningCount}/3 warnings
                </span>
              </div>
              <RiskMeter score={s.riskScore} />
              <a href={`/recruiter/proctoring/${s.id}`} className="btn-ghost mt-3 inline-flex text-sm">
                View timeline & evidence
              </a>
            </div>
          ))}
        </div>
      )}
    </DashboardShell>
  );
}
