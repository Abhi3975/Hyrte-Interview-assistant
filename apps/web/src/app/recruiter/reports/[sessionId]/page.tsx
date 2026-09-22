'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { ReportView, type ReportEvaluation, type ReportSession } from '@/components/report-view';
import { LiveDeliberationPanel } from '@/components/recruiter/live-deliberation';

interface ReportResponse { evaluation: ReportEvaluation; session: ReportSession }
interface Timeline { recordingUrl: string | null }

export default function RecruiterReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['evaluation-report', sessionId],
    queryFn: () => api.get<ReportResponse>(`/evaluation/sessions/${sessionId}/report`),
  });
  // Best-effort: recording may not exist / may not have been configured — a
  // failed fetch here shouldn't block the rest of the report from rendering.
  const { data: timeline } = useQuery({
    queryKey: ['proctoring-timeline-for-report', sessionId],
    queryFn: () => api.get<Timeline>(`/proctoring/sessions/${sessionId}/timeline`),
    retry: false,
  });

  return (
    <DashboardShell area="recruiter" title="Evaluation Report" requiredRoles={['RECRUITER', 'ORG_ADMIN']}>
      <Link href="/recruiter/interviews" className="no-print text-sm text-brand-500">← Back to assessments</Link>
      {isLoading ? (
        <p className="mt-4 text-sm text-black/50">Loading report…</p>
      ) : error || !data ? (
        <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">Evaluation isn&apos;t ready for this session yet.</p>
      ) : (
        <div className="mt-4">
          <ReportView evaluation={data.evaluation} session={data.session} mode="recruiter" sessionId={sessionId} recordingUrl={timeline?.recordingUrl} />
        </div>
      )}

      {/* The live committee's reasoning during the interview — rendered
          regardless of whether the evaluation above is ready, since the
          committee records from the first question onward. `no-print`: this is
          internal reasoning, not part of the candidate-shareable report. */}
      <div className="no-print mx-auto mt-8 max-w-4xl">
        <LiveDeliberationPanel
          endpoint={`/practice/session/${sessionId}/live-deliberation`}
          queryKey={['ally-live-deliberation', sessionId]}
        />
      </div>
    </DashboardShell>
  );
}
