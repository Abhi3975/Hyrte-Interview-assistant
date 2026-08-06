'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardShell } from '@/components/dashboard-shell';
import { api } from '@/lib/api';
import { ReportView, type ReportEvaluation, type ReportSession } from '@/components/report-view';

interface ReportResponse { evaluation: ReportEvaluation; session: ReportSession }

export default function CandidateReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['evaluation-report', sessionId],
    queryFn: () => api.get<ReportResponse>(`/evaluation/sessions/${sessionId}/report`),
  });

  return (
    <DashboardShell area="candidate" title="Evaluation Report" requiredRoles={['CANDIDATE']}>
      <Link href="/candidate/reports" className="no-print text-sm text-brand-500">← Back to reports</Link>
      {isLoading ? (
        <p className="mt-4 text-sm text-black/50">Loading report…</p>
      ) : error || !data ? (
        <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">This report isn&apos;t ready yet.</p>
      ) : (
        <div className="mt-4">
          <ReportView evaluation={data.evaluation} session={data.session} mode="candidate" />
        </div>
      )}
    </DashboardShell>
  );
}
